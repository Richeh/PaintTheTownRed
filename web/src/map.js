import { Map as MapLibreMap, Marker, NavigationControl, ScaleControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from './supabase.js';
import {
  createMarker,
  loadMarkers,
  loadProfiles,
  subscribeToMarkerChanges,
} from './data.js';

const DEFAULT_STYLE = {
  version: 8,
  id: 'town-red-raster',
  sources: {
    'raster-tiles': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'simple-tiles', type: 'raster', source: 'raster-tiles' }],
};

const DEFAULT_CENTER = [-1.4701, 53.3811];
const DEFAULT_ZOOM = 11;
const LAYER_STORAGE_PREFIX = 'town-red:layers:';
const MARKER_SYMBOLS = {
  house: '⌂',
  viewed: '✓',
  poi: '★',
  note: '✎',
  point: '•',
};

export function createTownRedMap(container, { onReady, onError, onStrokeComplete } = {}) {
  const shell = document.createElement('div');
  shell.className = 'relative h-full min-h-[32rem] overflow-hidden rounded-2xl bg-stone-200';

  const mapElement = document.createElement('div');
  mapElement.className = 'absolute inset-0 z-0';
  mapElement.style.width = '100%';
  mapElement.style.height = '100%';

  const canvas = document.createElement('canvas');
  canvas.className = 'pointer-events-none absolute inset-0 z-10 h-full w-full';
  canvas.style.background = 'transparent';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('aria-hidden', 'true');

  const layerPanel = document.createElement('section');
  layerPanel.className = 'absolute left-3 top-3 z-20 hidden w-56 rounded-xl border border-stone-200 bg-white/95 p-3 text-sm text-stone-800 shadow-lg backdrop-blur';
  layerPanel.setAttribute('aria-label', 'Overlay layers');
  layerPanel.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <strong class="font-semibold">Layers</strong>
      <button type="button" data-layer-show-all class="text-xs font-semibold text-red-800 hover:text-red-950">Show all</button>
    </div>
    <div data-layer-list class="mt-2 space-y-2"></div>
    <p class="mt-2 text-[11px] leading-4 text-stone-500">Visibility is saved only in this browser.</p>
  `;

  const addPointButton = document.createElement('button');
  addPointButton.type = 'button';
  addPointButton.className = 'absolute bottom-10 right-3 z-20 hidden rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 shadow-lg hover:bg-stone-50';
  addPointButton.textContent = 'Add point';

  shell.append(mapElement, canvas, layerPanel, addPointButton);
  container.replaceChildren(shell);

  const markerDialog = document.createElement('dialog');
  markerDialog.className = 'm-auto w-[min(30rem,calc(100%-2rem))] rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/40';
  markerDialog.innerHTML = `
    <form data-marker-form class="p-5">
      <h2 class="m-0 text-lg font-semibold">Add point</h2>
      <p class="mt-1 text-sm text-stone-600">Give this location a type and a short label.</p>
      <label class="mt-4 block text-sm font-medium text-stone-700">
        Type
        <select data-marker-kind class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100">
          <option value="house">House</option>
          <option value="viewed">Viewed</option>
          <option value="poi">Point of interest</option>
          <option value="note">Note</option>
          <option value="point">Point</option>
        </select>
      </label>
      <label class="mt-4 block text-sm font-medium text-stone-700">
        Label
        <input data-marker-label class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100" type="text" maxlength="160" required placeholder="e.g. 14 Church Street" />
      </label>
      <p data-marker-error class="mt-3 hidden text-sm text-red-700"></p>
      <div class="mt-5 flex justify-end gap-2">
        <button data-marker-cancel type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancel</button>
        <button data-marker-save type="submit" class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white hover:bg-red-900">Save point</button>
      </div>
    </form>
  `;
  document.body.append(markerDialog);

  const map = new MapLibreMap({
    container: mapElement,
    style: DEFAULT_STYLE,
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    attributionControl: true,
  });

  map.addControl(new NavigationControl(), 'top-right');
  map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

  const ctx = canvas.getContext('2d');
  const layerList = layerPanel.querySelector('[data-layer-list]');
  const showAllButton = layerPanel.querySelector('[data-layer-show-all]');
  const markerForm = markerDialog.querySelector('[data-marker-form]');
  const markerKind = markerDialog.querySelector('[data-marker-kind]');
  const markerLabel = markerDialog.querySelector('[data-marker-label]');
  const markerError = markerDialog.querySelector('[data-marker-error]');
  const markerSave = markerDialog.querySelector('[data-marker-save]');
  const markerCancel = markerDialog.querySelector('[data-marker-cancel]');

  let strokes = [];
  let draftStroke = null;
  let destroyed = false;
  let currentUserId = null;
  let activeMapId = null;
  let hiddenCreators = new Set();
  let creatorNames = new globalThis.Map();
  let profileGeneration = 0;
  let markers = [];
  let mapMarkers = [];
  let unsubscribeMarkers = null;
  let pendingPoint = null;
  let placingPoint = false;
  let editor = { enabled: false, mode: 'navigate', brushPixels: 42, opacity: 0.2 };

  supabase.auth.getSession()
    .then(({ data }) => {
      currentUserId = data.session?.user?.id || null;
      renderLayerPanel();
    })
    .catch(() => {});

  function currentSelectedMapId() {
    return document.querySelector('#shared-map-select')?.value || activeMapId || null;
  }

  function layerStorageKey(mapId = activeMapId) {
    return mapId ? `${LAYER_STORAGE_PREFIX}${mapId}` : null;
  }

  function loadLayerPreferences(mapId) {
    const key = layerStorageKey(mapId);
    if (!key) {
      hiddenCreators = new Set();
      return;
    }
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) || '[]');
      hiddenCreators = new Set(Array.isArray(stored) ? stored.filter(Boolean) : []);
    } catch {
      hiddenCreators = new Set();
    }
  }

  function saveLayerPreferences() {
    const key = layerStorageKey();
    if (!key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify([...hiddenCreators]));
    } catch {
      // Cosmetic preference only.
    }
  }

  function creatorIds() {
    return [...new Set(strokes.map((stroke) => stroke?.created_by).filter(Boolean))];
  }

  function creatorLabel(creatorId) {
    const displayName = creatorNames.get(creatorId);
    if (creatorId === currentUserId) return displayName ? `${displayName} (You)` : 'You';
    return displayName || `Collaborator ${creatorId.slice(0, 6)}`;
  }

  function renderLayerPanel() {
    const creators = creatorIds();
    layerPanel.classList.toggle('hidden', creators.length === 0);
    layerList.replaceChildren();

    for (const creatorId of creators) {
      const label = document.createElement('label');
      label.className = 'flex cursor-pointer items-center gap-2';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !hiddenCreators.has(creatorId);
      checkbox.className = 'h-4 w-4 accent-red-800';
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) hiddenCreators.delete(creatorId);
        else hiddenCreators.add(creatorId);
        saveLayerPreferences();
        redraw();
      });

      const text = document.createElement('span');
      text.className = 'min-w-0 flex-1 truncate';
      text.textContent = creatorLabel(creatorId);
      text.title = creatorNames.get(creatorId) || creatorId;

      const count = document.createElement('span');
      count.className = 'text-xs tabular-nums text-stone-400';
      count.textContent = String(strokes.filter((stroke) => stroke.created_by === creatorId).length);

      label.append(checkbox, text, count);
      layerList.append(label);
    }
  }

  async function refreshCreatorNames() {
    const generation = ++profileGeneration;
    const creators = creatorIds();
    if (!creators.length) {
      creatorNames = new globalThis.Map();
      renderLayerPanel();
      return;
    }
    try {
      const profiles = await loadProfiles(creators);
      if (destroyed || generation !== profileGeneration) return;
      creatorNames = new globalThis.Map((profiles || []).map((profile) => [profile.user_id, profile.display_name]));
      renderLayerPanel();
    } catch (error) {
      if (!destroyed) console.warn('[Town Red] could not load collaborator names', error);
    }
  }

  showAllButton.addEventListener('click', () => {
    hiddenCreators.clear();
    saveLayerPreferences();
    renderLayerPanel();
    redraw();
  });

  function visibleStrokes() {
    return strokes.filter((stroke) => !stroke?.created_by || !hiddenCreators.has(stroke.created_by));
  }

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

  function cssPixelsToMetres(point, pixels) {
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    const start = map.project([lng, lat]);
    const east = map.unproject([start.x + pixels, start.y]);
    const lat1 = (lat * Math.PI) / 180;
    const lat2 = (east.lat * Math.PI) / 180;
    const dLat = ((east.lat - lat) * Math.PI) / 180;
    const dLng = ((east.lng - lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371008.8 * 2 * Math.asin(Math.sqrt(a));
  }

  function projectPoint(point, dpr) {
    const projected = map.project([Number(point.lng), Number(point.lat)]);
    return { x: projected.x * dpr, y: projected.y * dpr };
  }

  function normalisePoints(rawStroke) {
    return Array.isArray(rawStroke?.points)
      ? rawStroke.points.filter((point) => Number.isFinite(Number(point?.lng)) && Number.isFinite(Number(point?.lat)))
      : [];
  }

  function drawStroke(rawStroke) {
    const points = normalisePoints(rawStroke);
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
      for (let i = 1; i < pixels.length; i += 1) ctx.lineTo(pixels[i].x, pixels[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function redraw() {
    if (destroyed) return;
    resizeCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const ordered = [...visibleStrokes()].sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
    for (const stroke of ordered) drawStroke(stroke);
    if (draftStroke) drawStroke(draftStroke);
  }

  function markerElement(row) {
    const el = document.createElement('div');
    el.className = 'flex max-w-52 items-center gap-1.5 rounded-full border border-stone-300 bg-white/95 px-2 py-1 text-xs font-semibold text-stone-800 shadow-md backdrop-blur';

    const symbol = document.createElement('span');
    symbol.className = 'grid h-5 w-5 shrink-0 place-items-center rounded-full bg-stone-900 text-sm text-white';
    symbol.textContent = MARKER_SYMBOLS[row.kind] || MARKER_SYMBOLS.point;

    const label = document.createElement('span');
    label.className = 'truncate';
    label.textContent = row.label;
    label.title = row.label;

    el.append(symbol, label);
    return el;
  }

  function renderMarkers() {
    for (const marker of mapMarkers) marker.remove();
    mapMarkers = [];

    for (const row of markers) {
      const marker = new Marker({ element: markerElement(row), anchor: 'bottom' })
        .setLngLat([Number(row.longitude), Number(row.latitude)])
        .addTo(map);
      mapMarkers.push(marker);
    }
  }

  async function switchMarkerMap(mapId) {
    if (mapId === activeMapId && unsubscribeMarkers) return;
    activeMapId = mapId || null;
    unsubscribeMarkers?.();
    unsubscribeMarkers = null;
    markers = [];
    renderMarkers();

    if (!activeMapId) return;

    try {
      markers = await loadMarkers(activeMapId);
      if (destroyed) return;
      renderMarkers();
      unsubscribeMarkers = await subscribeToMarkerChanges(
        activeMapId,
        async () => {
          try {
            markers = await loadMarkers(activeMapId);
            renderMarkers();
          } catch (error) {
            console.warn('[Town Red] marker refresh failed', error);
          }
        },
        (status, error) => {
          if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
            console.warn('[Town Red] marker realtime status', status, error);
          }
        },
      );
    } catch (error) {
      console.warn('[Town Red] could not load markers', error);
    }
  }

  function syncSelectedMap() {
    const selected = currentSelectedMapId();
    if (selected && selected !== activeMapId) {
      loadLayerPreferences(selected);
      switchMarkerMap(selected);
    }
  }

  addPointButton.addEventListener('click', () => {
    if (!editor.enabled) return;
    syncSelectedMap();
    if (!activeMapId) return;

    placingPoint = true;
    addPointButton.textContent = 'Click map…';
    addPointButton.classList.add('ring-2', 'ring-red-300');
    canvas.style.pointerEvents = 'none';
    map.getCanvas().style.cursor = 'crosshair';
  });

  map.on('click', (event) => {
    if (!placingPoint || !editor.enabled) return;
    placingPoint = false;
    pendingPoint = { longitude: event.lngLat.lng, latitude: event.lngLat.lat };
    addPointButton.textContent = 'Add point';
    addPointButton.classList.remove('ring-2', 'ring-red-300');
    map.getCanvas().style.cursor = '';
    markerKind.value = 'house';
    markerLabel.value = '';
    markerError.textContent = '';
    markerError.classList.add('hidden');
    markerDialog.showModal();
    requestAnimationFrame(() => markerLabel.focus());
    setEditor(editor);
  });

  markerCancel.addEventListener('click', () => {
    pendingPoint = null;
    markerDialog.close();
  });

  markerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!pendingPoint || !activeMapId || !currentUserId) return;

    const label = markerLabel.value.trim();
    if (!label) return;

    markerSave.disabled = true;
    markerError.classList.add('hidden');
    try {
      const saved = await createMarker({
        mapId: activeMapId,
        userId: currentUserId,
        kind: markerKind.value,
        label,
        longitude: pendingPoint.longitude,
        latitude: pendingPoint.latitude,
      });
      markers.push(saved);
      renderMarkers();
      pendingPoint = null;
      markerDialog.close();
    } catch (error) {
      markerError.textContent = error instanceof Error ? error.message : String(error);
      markerError.classList.remove('hidden');
    } finally {
      markerSave.disabled = false;
    }
  });

  function setStrokes(nextStrokes) {
    strokes = Array.isArray(nextStrokes) ? nextStrokes : [];
    const strokeMapId = strokes.find((stroke) => stroke?.map_id)?.map_id || null;
    const nextMapId = strokeMapId || currentSelectedMapId();

    if (nextMapId && nextMapId !== activeMapId) {
      loadLayerPreferences(nextMapId);
      creatorNames = new globalThis.Map();
      switchMarkerMap(nextMapId);
    }

    const knownCreators = new Set(creatorIds());
    hiddenCreators = new Set([...hiddenCreators].filter((creatorId) => knownCreators.has(creatorId)));
    saveLayerPreferences();
    renderLayerPanel();
    redraw();
    refreshCreatorNames();
  }

  function upsertStroke(stroke) {
    if (!stroke?.id) return;
    const index = strokes.findIndex((item) => item.id === stroke.id);
    if (index >= 0) strokes[index] = stroke;
    else strokes.push(stroke);
    if (stroke.map_id && stroke.map_id !== activeMapId) switchMarkerMap(stroke.map_id);
    renderLayerPanel();
    redraw();
    refreshCreatorNames();
  }

  function removeStroke(id) {
    strokes = strokes.filter((stroke) => stroke.id !== id);
    renderLayerPanel();
    redraw();
    refreshCreatorNames();
  }

  function fitToStrokes() {
    const points = visibleStrokes().flatMap(normalisePoints);
    if (!points.length && markers.length) {
      const first = markers[0];
      map.easeTo({ center: [Number(first.longitude), Number(first.latitude)], zoom: 14 });
      return true;
    }
    if (!points.length) return false;

    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const point of points) {
      const lng = Number(point.lng);
      const lat = Number(point.lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    if (minLng === maxLng && minLat === maxLat) map.easeTo({ center: [minLng, minLat], zoom: 15 });
    else map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 80, maxZoom: 16, duration: 500 });
    return true;
  }

  function setEditor(next) {
    editor = { ...editor, ...next };
    syncSelectedMap();
    const painting = editor.enabled && editor.mode !== 'navigate' && !placingPoint;
    canvas.style.pointerEvents = painting ? 'auto' : 'none';
    canvas.style.cursor = editor.mode === 'erase' ? 'cell' : 'crosshair';
    addPointButton.classList.toggle('hidden', !editor.enabled || !currentSelectedMapId());
    map.dragPan.enable();
  }

  function eventToPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const lngLat = map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
    return { lng: lngLat.lng, lat: lngLat.lat };
  }

  function pointDistanceMetres(a, b) {
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371008.8 * 2 * Math.asin(Math.sqrt(h));
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!editor.enabled || editor.mode === 'navigate' || placingPoint) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const point = eventToPoint(event);
    draftStroke = {
      mode: editor.mode,
      brush_metres: cssPixelsToMetres(point, editor.brushPixels),
      opacity: editor.opacity,
      points: [point],
    };
    redraw();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!draftStroke) return;
    event.preventDefault();
    const point = eventToPoint(event);
    const previous = draftStroke.points[draftStroke.points.length - 1];
    const spacing = Math.max(0.5, draftStroke.brush_metres / 15);
    if (pointDistanceMetres(previous, point) >= spacing) {
      draftStroke.points.push(point);
      redraw();
    }
  });

  function finishDraft(event) {
    if (!draftStroke) return;
    if (event?.pointerId != null && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const finished = draftStroke;
    draftStroke = null;
    redraw();
    onStrokeComplete?.(finished);
  }

  canvas.addEventListener('pointerup', finishDraft);
  canvas.addEventListener('pointercancel', finishDraft);

  const mapSelect = document.querySelector('#shared-map-select');
  const onMapSelectChange = () => {
    const nextMapId = currentSelectedMapId();
    if (nextMapId !== activeMapId) {
      loadLayerPreferences(nextMapId);
      switchMarkerMap(nextMapId);
    }
    setEditor(editor);
  };
  mapSelect?.addEventListener('change', onMapSelectChange);

  map.on('load', () => {
    map.resize();
    syncSelectedMap();
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
    if (destroyed) return;
    map.resize();
    redraw();
  });
  resizeObserver.observe(shell);

  return {
    map,
    setStrokes,
    upsertStroke,
    removeStroke,
    fitToStrokes,
    setEditor,
    redraw,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      profileGeneration += 1;
      resizeObserver.disconnect();
      mapSelect?.removeEventListener('change', onMapSelectChange);
      unsubscribeMarkers?.();
      for (const marker of mapMarkers) marker.remove();
      markerDialog.remove();
      try {
        map.remove();
      } catch (error) {
        console.warn('[Town Red] MapLibre teardown warning', error);
      }
    },
  };
}
