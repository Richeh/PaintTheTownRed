import { build } from 'esbuild';
import sharp from 'sharp';
import yazl from 'yazl';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const userscriptPath = path.join(repoRoot, 'tampermonkey', 'town-red-rightmove.user.js');
const manifestPath = path.join(extensionRoot, 'manifest.json');
const sourceIconPath = path.join(repoRoot, 'assets', 'logo', 'townred.png');
const distDir = path.join(extensionRoot, 'dist');
const releaseDir = path.join(extensionRoot, 'release');

const storageShim = String.raw`
import { createClient } from '@supabase/supabase-js';

const supabase = { createClient };
const STORAGE_PREFIX = 'town-red-extension:';
function GM_getValue(key, fallback) {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function GM_setValue(key, value) {
  try { window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch {}
}
function GM_deleteValue(key) {
  try { window.localStorage.removeItem(STORAGE_PREFIX + key); } catch {}
}
`;

const earlyMapHook = String.raw`(() => {
  'use strict';
  window.__townRedMaps ||= [];

  function rememberMap(map) {
    if (map && !window.__townRedMaps.includes(map)) {
      window.__townRedMaps.push(map);
      console.info('[Town Red] early-captured Google Map', map);
    }
    return map;
  }

  function wrapMap(holder, key = 'Map') {
    if (!holder) return false;
    let Original;
    try { Original = holder[key]; } catch { return false; }
    if (typeof Original !== 'function' || Original.__townRedWrapped) return false;

    function WrappedMap(...args) {
      return rememberMap(Reflect.construct(Original, args, Original));
    }
    try { Object.setPrototypeOf(WrappedMap, Original); } catch {}
    try { WrappedMap.prototype = Original.prototype; } catch {}
    try { Object.defineProperty(WrappedMap, '__townRedWrapped', { value: true }); } catch {}
    try { holder[key] = WrappedMap; return true; } catch { return false; }
  }

  let importLibraryHooked = false;
  const timer = setInterval(() => {
    const maps = window.google?.maps;
    if (!maps) return;
    if (!importLibraryHooked && typeof maps.importLibrary === 'function') {
      const originalImport = maps.importLibrary.bind(maps);
      maps.importLibrary = async (...args) => {
        const library = await originalImport(...args);
        if (library && typeof library.Map === 'function') wrapMap(library, 'Map');
        return library;
      };
      importLibraryHooked = true;
    }
    if (typeof maps.Map === 'function') wrapMap(maps, 'Map');
  }, 1);

  setTimeout(() => clearInterval(timer), 30000);
})();
`;

const listingMarkerState = String.raw`
    let markers = [];
    const markerLayer = document.createElement('div');
    markerLayer.id = 'town-red-listing-markers';
    Object.assign(markerLayer.style, {
      position: 'fixed', inset: '0', zIndex: '2147483100', pointerEvents: 'none'
    });
    document.documentElement.appendChild(markerLayer);
`;

const listingMarkerFunctions = String.raw`
    function canonicalPropertyUrl(href) {
      if (!href) return null;
      try {
        const url = new URL(href, location.origin);
        const match = url.pathname.match(/^\/properties\/(\d+)/);
        if (!match || url.hostname !== location.hostname) return null;
        return `${location.origin}/properties/${match[1]}`;
      } catch { return null; }
    }

    function markerLabelFromLink(link, sourceUrl) {
      const raw = [link?.getAttribute?.('aria-label'), link?.textContent]
        .map(value => String(value || '').replace(/\s+/g, ' ').trim())
        .find(Boolean);
      if (raw) return raw.slice(0, 160);
      const id = sourceUrl?.match(/\/properties\/(\d+)/)?.[1];
      return id ? `Rightmove property ${id}` : 'Rightmove property';
    }

    function renderTownRedMarkers() {
      markerLayer.replaceChildren();
      if (!projection || !mapRect || !selectedMapId) return;
      const gm = PAGE.google?.maps;
      if (!gm) return;

      for (const row of markers) {
        try {
          const pixel = projection.fromLatLngToContainerPixel(new gm.LatLng(Number(row.latitude), Number(row.longitude)));
          if (!pixel) continue;
          if (pixel.x < -40 || pixel.y < -40 || pixel.x > mapRect.width + 40 || pixel.y > mapRect.height + 40) continue;

          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = '⌂';
          button.title = row.source_url ? `${row.label} — open Rightmove listing` : row.label;
          Object.assign(button.style, {
            position: 'fixed',
            left: `${mapRect.left + pixel.x}px`,
            top: `${mapRect.top + pixel.y}px`,
            transform: 'translate(-50%, -100%)',
            width: '30px', height: '30px', borderRadius: '50% 50% 50% 8px',
            border: '2px solid white', background: '#9c1616', color: 'white',
            boxShadow: '0 2px 6px rgba(0,0,0,.35)', cursor: row.source_url ? 'pointer' : 'default',
            pointerEvents: 'auto', font: 'bold 18px/24px system-ui', zIndex: '2147483101'
          });
          button.dataset.townRedMarker = row.id;
          button.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation();
            if (row.source_url) window.open(row.source_url, '_blank', 'noopener,noreferrer');
          });
          markerLayer.appendChild(button);
        } catch {}
      }
    }

    function mergeMarker(row) {
      if (!row || row.map_id !== selectedMapId) return;
      const index = markers.findIndex(item => item.id === row.id);
      if (index >= 0) markers[index] = row; else markers.push(row);
      updateCount();
      renderTownRedMarkers();
    }

    async function loadRemoteMarkers() {
      if (!selectedMapId) { markers = []; renderTownRedMarkers(); return; }
      const mapIdAtStart = selectedMapId;
      const result = await sb.from('markers')
        .select('id,map_id,created_by,kind,label,longitude,latitude,source_url,created_at,updated_at')
        .eq('map_id', mapIdAtStart)
        .order('created_at', { ascending: true });
      if (result.error) throw result.error;
      if (selectedMapId !== mapIdAtStart) return;
      markers = result.data || [];
      updateCount();
      renderTownRedMarkers();
    }

    function nearestPropertyLink(clientX, clientY, eventTarget) {
      const path = typeof eventTarget?.composedPath === 'function' ? eventTarget.composedPath() : [];
      for (const node of [eventTarget, ...path]) {
        if (!(node instanceof Element)) continue;
        const direct = node.closest?.('a[href*="/properties/"]');
        if (direct && canonicalPropertyUrl(direct.href)) return direct;
      }

      let best = null;
      let bestDistance = Infinity;
      for (const link of document.querySelectorAll('a[href*="/properties/"]')) {
        if (!canonicalPropertyUrl(link.href)) continue;
        const rect = link.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > innerHeight) continue;
        const x = Math.max(rect.left, Math.min(clientX, rect.right));
        const y = Math.max(rect.top, Math.min(clientY, rect.bottom));
        const distance = Math.hypot(clientX - x, clientY - y);
        if (distance < bestDistance) { bestDistance = distance; best = link; }
      }
      return bestDistance <= 420 ? best : null;
    }

    async function captureRightmoveProperty(event) {
      if (!selectedMapId || !canEdit() || !projection || !mapRect) return;
      if (settings.mode !== 'navigate' || spaceHeld) return;
      if (event.button !== 0) return;
      if (event.target?.closest?.('#town-red-toolbar,#town-red-listing-markers')) return;

      let mapDiv;
      try { mapDiv = map?.getDiv?.(); } catch { return; }
      if (!mapDiv || !mapDiv.contains(event.target)) return;

      const point = screenToLatLng(event.clientX, event.clientY);
      if (!point) return;
      const clientX = event.clientX, clientY = event.clientY, target = event.target;

      setTimeout(async () => {
        try {
          const link = nearestPropertyLink(clientX, clientY, target);
          const sourceUrl = canonicalPropertyUrl(link?.href);
          if (!sourceUrl) return;
          if (markers.some(item => item.source_url === sourceUrl)) {
            setSync('house already saved');
            setTimeout(() => setSync('live'), 900);
            return;
          }

          const row = {
            map_id: selectedMapId,
            created_by: userId,
            kind: 'house',
            label: markerLabelFromLink(link, sourceUrl),
            longitude: point.lng,
            latitude: point.lat,
            source_url: sourceUrl
          };
          setSync('saving house…');
          const result = await sb.from('markers').insert(row)
            .select('id,map_id,created_by,kind,label,longitude,latitude,source_url,created_at,updated_at')
            .single();
          if (result.error) {
            if (result.error.code === '23505') { await loadRemoteMarkers(); setSync('live'); return; }
            throw result.error;
          }
          mergeMarker(result.data);
          setSync('live');
        } catch (error) {
          console.warn('[Town Red] property capture failed', error);
          setSync('house save failed', true);
        }
      }, 180);
    }
`;

function transformUserscript(source, version) {
  const withoutHeader = source.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
  let transformed = storageShim + '\n' + withoutHeader
    .replace('const PAGE = unsafeWindow;', 'const PAGE = window;')
    .replace("const sbLibrary = typeof supabase !== 'undefined' ? supabase : null;", 'const sbLibrary = supabase;')
    .replace(/Rightmove shared geographic client v[\d.]+ loaded/, `Rightmove Chrome extension client v${version} loaded`);

  transformed = transformed
    .replace('    let spaceHeld = false;\n', `    let spaceHeld = false;\n${listingMarkerState}`)
    .replace(
      '    function updateCount() { countEl.textContent = `${strokes.length} ${strokes.length === 1 ? \'stroke\' : \'strokes\'}`; }',
      '    function updateCount() { countEl.textContent = `${strokes.length} ${strokes.length === 1 ? \'stroke\' : \'strokes\'} · ${markers.length} ${markers.length === 1 ? \'point\' : \'points\'}`; }'
    )
    .replace('    function sortStrokes() {', `${listingMarkerFunctions}\n    function sortStrokes() {`)
    .replace(
      '      strokes = [];\n      currentStroke = null;\n',
      '      strokes = [];\n      markers = [];\n      currentStroke = null;\n      renderTownRedMarkers();\n'
    )
    .replace(
      '      await loadRemoteStrokes();\n      await subscribeRealtime();',
      '      await loadRemoteStrokes();\n      await loadRemoteMarkers();\n      await subscribeRealtime();'
    )
    .replace(
      "        }, payload => {\n          console.info('[Town Red] realtime INSERT', payload);\n          if (selectedMapId === subscribedMapId) mergeStroke(payload.new);\n        })\n        .subscribe((status, error) => {",
      "        }, payload => {\n          console.info('[Town Red] realtime INSERT', payload);\n          if (selectedMapId === subscribedMapId) mergeStroke(payload.new);\n        })\n        .on('postgres_changes', {\n          event: '*', schema: 'public', table: 'markers', filter: `map_id=eq.${subscribedMapId}`\n        }, payload => {\n          if (selectedMapId !== subscribedMapId) return;\n          if (payload.eventType === 'DELETE') { markers = markers.filter(item => item.id !== payload.old?.id); updateCount(); renderTownRedMarkers(); }\n          else mergeMarker(payload.new);\n        })\n        .subscribe((status, error) => {"
    )
    .replace(
      '      if (currentStroke) drawStroke(currentStroke);\n    }',
      '      if (currentStroke) drawStroke(currentStroke);\n      renderTownRedMarkers();\n    }'
    )
    .replace(
      "    $('#tr-refresh').addEventListener('click', () => loadRemoteStrokes().catch(reportError));",
      "    $('#tr-refresh').addEventListener('click', () => Promise.all([loadRemoteStrokes(), loadRemoteMarkers()]).catch(reportError));"
    )
    .replace(
      "    document.addEventListener('keydown', event => {",
      "    document.addEventListener('click', event => captureRightmoveProperty(event), true);\n\n    document.addEventListener('keydown', event => {"
    )
    .replace(
      "        await loadRemoteStrokes();\n        console.info('[Town Red] periodic sync complete:', strokes.length, 'strokes');",
      "        await Promise.all([loadRemoteStrokes(), loadRemoteMarkers()]);\n        console.info('[Town Red] periodic sync complete:', strokes.length, 'strokes', markers.length, 'points');"
    );

  return transformed;
}

async function buildIcons() {
  const iconDir = path.join(distDir, 'icons');
  await mkdir(iconDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    await sharp(sourceIconPath)
      .resize(size, size, { fit: 'contain' })
      .png()
      .toFile(path.join(iconDir, `icon-${size}.png`));
  }
}

async function buildOnce({ production = false } = {}) {
  const source = await readFile(userscriptPath, 'utf8');
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  const entry = transformUserscript(source, manifest.version);

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, 'map-hook.js'), earlyMapHook);

  await build({
    stdin: {
      contents: entry,
      loader: 'js',
      resolveDir: extensionRoot,
      sourcefile: 'town-red-rightmove-extension.js',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    minify: production,
    sourcemap: production ? false : 'inline',
    legalComments: production ? 'none' : 'inline',
    outfile: path.join(distDir, 'content.js'),
    logLevel: 'info',
  });

  await buildIcons();
  await writeFile(path.join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[Town Red] Chrome extension ${production ? 'production ' : ''}build complete`);
  return manifest;
}

async function addDirectoryToZip(zipFile, directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await addDirectoryToZip(zipFile, absolutePath, root);
      continue;
    }
    if (!entry.isFile()) continue;
    const archivePath = path.relative(root, absolutePath).split(path.sep).join('/');
    zipFile.addFile(absolutePath, archivePath, { compress: true });
  }
}

async function packageRelease() {
  const manifest = await buildOnce({ production: true });
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });
  const zipPath = path.join(releaseDir, `town-red-rightmove-${manifest.version}.zip`);

  await new Promise(async (resolve, reject) => {
    const zipFile = new yazl.ZipFile();
    const output = createWriteStream(zipPath);

    output.on('close', resolve);
    output.on('error', reject);
    zipFile.outputStream.on('error', reject);
    zipFile.outputStream.pipe(output);

    try {
      await addDirectoryToZip(zipFile, distDir);
      zipFile.end();
    } catch (error) {
      reject(error);
    }
  });

  console.log(`[Town Red] Web Store package: ${zipPath}`);
}

const packageMode = process.argv.includes('--package');
const watchMode = process.argv.includes('--watch');

if (packageMode) {
  await packageRelease();
} else {
  await buildOnce();
}

if (watchMode) {
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildOnce().catch((error) => console.error(error)), 100);
  };
  watch(userscriptPath, rebuild);
  watch(manifestPath, rebuild);
  watch(sourceIconPath, rebuild);
  console.log('[Town Red] Watching userscript, manifest and icon for changes...');
}
