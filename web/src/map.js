import { Map, NavigationControl, ScaleControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_CENTER = [-1.4701, 53.3811];
const DEFAULT_ZOOM = 11;

export function createTownRedMap(container, { onReady, onError } = {}) {
  const shell = document.createElement('div');
  shell.className = 'relative h-full min-h-[32rem] overflow-hidden rounded-2xl bg-stone-200';

  const mapElement = document.createElement('div');
  mapElement.className = 'absolute inset-0';

  const canvas = document.createElement('canvas');
  canvas.className = 'pointer-events-none absolute inset-0 h-full w-full';
  canvas.setAttribute('aria-hidden', 'true');

  shell.append(mapElement, canvas);
  container.replaceChildren(shell);

  const map = new Map({
    container: mapElement,
    style: DEFAULT_STYLE,
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    attributionControl: true,
  });

  map.addControl(new NavigationControl(), 'top-right');
  map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

  const ctx = canvas.getContext('2d');
  let strokes = [];
  let destroyed = false;

  function resizeCanvas() {
    if (destroyed) return;

    const rect = shell.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }

  function metresToCssPixels(point, metres) {
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    const cosine = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
    const eastLng = lng + metres / (111320 * cosine);

    const start = map.project([lng, lat]);
    const east = map.project([eastLng, lat]);

    return Math.max(1, Math.abs(east.x - start.x));
  }

  function projectPoint(point, dpr) {
    const projected = map.project([Number(point.lng), Number(point.lat)]);
    return {
      x: projected.x * dpr,
      y: projected.y * dpr,
    };
  }

  function drawStroke(rawStroke) {
    const points = Array.isArray(rawStroke?.points) ? rawStroke.points : [];
    if (!points.length) return;

    const brushMetres = Number(rawStroke.brush_metres ?? rawStroke.brushMetres);
    if (!Number.isFinite(brushMetres) || brushMetres <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = metresToCssPixels(points[0], brushMetres) * dpr;
    const pixels = points.map((point) => projectPoint(point, dpr));

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;

    if (rawStroke.mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Number.isFinite(Number(rawStroke.opacity)) ? Number(rawStroke.opacity) : 0.2;
      const colour = rawStroke.mode === 'blue' ? 'rgb(35,95,220)' : 'rgb(220,35,45)';
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
    }

    if (pixels.length === 1) {
      ctx.beginPath();
      ctx.arc(pixels[0].x, pixels[0].y, width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(pixels[0].x, pixels[0].y);
      for (let i = 1; i < pixels.length; i += 1) {
        ctx.lineTo(pixels[i].x, pixels[i].y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  function redraw() {
    if (destroyed) return;

    resizeCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const ordered = [...strokes].sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
    for (const stroke of ordered) drawStroke(stroke);
  }

  function setStrokes(nextStrokes) {
    strokes = Array.isArray(nextStrokes) ? nextStrokes : [];
    redraw();
  }

  function upsertStroke(stroke) {
    if (!stroke?.id) return;
    const index = strokes.findIndex((item) => item.id === stroke.id);

    if (index >= 0) {
      strokes[index] = stroke;
    } else {
      strokes.push(stroke);
    }

    redraw();
  }

  function fitToStrokes() {
    const points = strokes.flatMap((stroke) => (Array.isArray(stroke.points) ? stroke.points : []));
    if (!points.length) return false;

    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    for (const point of points) {
      const lng = Number(point.lng);
      const lat = Number(point.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    if (!Number.isFinite(minLng)) return false;

    if (minLng === maxLng && minLat === maxLat) {
      map.easeTo({ center: [minLng, minLat], zoom: 15 });
    } else {
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 80, maxZoom: 16, duration: 500 },
      );
    }

    return true;
  }

  map.on('load', () => {
    redraw();
    onReady?.(map);
  });

  map.on('move', redraw);
  map.on('resize', redraw);
  map.on('error', (event) => {
    console.error('[Town Red] MapLibre error', event?.error || event);
    onError?.(event?.error || event);
  });

  const resizeObserver = new ResizeObserver(() => {
    map.resize();
    redraw();
  });
  resizeObserver.observe(shell);

  return {
    map,
    setStrokes,
    upsertStroke,
    fitToStrokes,
    redraw,
    destroy() {
      destroyed = true;
      resizeObserver.disconnect();
      map.remove();
    },
  };
}
