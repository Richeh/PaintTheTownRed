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
const listingCapturePath = path.join(extensionRoot, 'src', 'listing-capture.js');
const manifestPath = path.join(extensionRoot, 'manifest.json');
const sourceIconPath = path.join(repoRoot, 'assets', 'logo', 'townred.png');
const distDir = path.join(extensionRoot, 'dist');
const releaseDir = path.join(extensionRoot, 'release');

const storageShim = String.raw`
import { createClient } from '@supabase/supabase-js';
const supabase = { createClient };
const STORAGE_PREFIX = 'town-red-extension:';
function GM_getValue(key, fallback) { try { const raw = window.localStorage.getItem(STORAGE_PREFIX + key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } }
function GM_setValue(key, value) { try { window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch {} }
function GM_deleteValue(key) { try { window.localStorage.removeItem(STORAGE_PREFIX + key); } catch {} }
`;

const earlyMapHook = String.raw`(() => {
  'use strict';
  window.__townRedMaps ||= [];
  function rememberMap(map) { if (map && !window.__townRedMaps.includes(map)) window.__townRedMaps.push(map); return map; }
  function wrapMap(holder, key = 'Map') {
    if (!holder) return false; let Original; try { Original = holder[key]; } catch { return false; }
    if (typeof Original !== 'function' || Original.__townRedWrapped) return false;
    function WrappedMap(...args) { return rememberMap(Reflect.construct(Original, args, Original)); }
    try { Object.setPrototypeOf(WrappedMap, Original); } catch {}
    try { WrappedMap.prototype = Original.prototype; } catch {}
    try { Object.defineProperty(WrappedMap, '__townRedWrapped', { value: true }); } catch {}
    try { holder[key] = WrappedMap; return true; } catch { return false; }
  }
  let importLibraryHooked = false;
  const timer = setInterval(() => {
    const maps = window.google?.maps; if (!maps) return;
    if (!importLibraryHooked && typeof maps.importLibrary === 'function') {
      const originalImport = maps.importLibrary.bind(maps);
      maps.importLibrary = async (...args) => { const library = await originalImport(...args); if (library && typeof library.Map === 'function') wrapMap(library, 'Map'); return library; };
      importLibraryHooked = true;
    }
    if (typeof maps.Map === 'function') wrapMap(maps, 'Map');
  }, 1);
  setTimeout(() => clearInterval(timer), 30000);
})();`;

const listingMarkerState = String.raw`
    let markers = [];
    const markerLayer = document.createElement('div');
    markerLayer.id = 'town-red-listing-markers';
    Object.assign(markerLayer.style, { position: 'fixed', inset: '0', zIndex: '2147483100', pointerEvents: 'none' });
    document.documentElement.appendChild(markerLayer);
`;

function transformUserscript(source, version, listingMarkerFunctions) {
  const withoutHeader = source.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
  let transformed = storageShim + '\n' + withoutHeader
    .replace('const PAGE = unsafeWindow;', 'const PAGE = window;')
    .replace("const sbLibrary = typeof supabase !== 'undefined' ? supabase : null;", 'const sbLibrary = supabase;')
    .replace(/Rightmove shared geographic client v[\d.]+ loaded/, `Rightmove Chrome extension client v${version} loaded`);

  transformed = transformed
    .replace('    let spaceHeld = false;\n', `    let spaceHeld = false;\n${listingMarkerState}`)
    .replace('    function updateCount() { countEl.textContent = `${strokes.length} ${strokes.length === 1 ? \'stroke\' : \'strokes\'}`; }', '    function updateCount() { countEl.textContent = `${strokes.length} ${strokes.length === 1 ? \'stroke\' : \'strokes\'} · ${markers.length} ${markers.length === 1 ? \'point\' : \'points\'}`; }')
    .replace('    function sortStrokes() {', `${listingMarkerFunctions}\n    function sortStrokes() {`)
    .replace('      strokes = [];\n      currentStroke = null;\n', '      strokes = [];\n      markers = [];\n      currentStroke = null;\n      renderTownRedMarkers();\n')
    .replace('      await loadRemoteStrokes();\n      await subscribeRealtime();', '      await loadRemoteStrokes();\n      await loadRemoteMarkers();\n      await subscribeRealtime();')
    .replace("        }, payload => {\n          console.info('[Town Red] realtime INSERT', payload);\n          if (selectedMapId === subscribedMapId) mergeStroke(payload.new);\n        })\n        .subscribe((status, error) => {", "        }, payload => {\n          console.info('[Town Red] realtime INSERT', payload);\n          if (selectedMapId === subscribedMapId) mergeStroke(payload.new);\n        })\n        .on('postgres_changes', { event: '*', schema: 'public', table: 'markers', filter: `map_id=eq.${subscribedMapId}` }, payload => {\n          if (selectedMapId !== subscribedMapId) return;\n          if (payload.eventType === 'DELETE') { markers = markers.filter(item => item.id !== payload.old?.id); updateCount(); renderTownRedMarkers(); } else mergeMarker(payload.new);\n        })\n        .subscribe((status, error) => {")
    .replace('      if (currentStroke) drawStroke(currentStroke);\n    }', '      if (currentStroke) drawStroke(currentStroke);\n      renderTownRedMarkers();\n    }')
    .replace("    $('#tr-refresh').addEventListener('click', () => loadRemoteStrokes().catch(reportError));", "    $('#tr-refresh').addEventListener('click', () => Promise.all([loadRemoteStrokes(), loadRemoteMarkers()]).catch(reportError));")
    .replace("    document.addEventListener('keydown', event => {", "    document.addEventListener('click', event => captureRightmoveProperty(event), true);\n\n    document.addEventListener('keydown', event => {")
    .replace("        await loadRemoteStrokes();\n        console.info('[Town Red] periodic sync complete:', strokes.length, 'strokes');", "        await Promise.all([loadRemoteStrokes(), loadRemoteMarkers()]);\n        console.info('[Town Red] periodic sync complete:', strokes.length, 'strokes', markers.length, 'points');");

  return transformed;
}

async function buildIcons() {
  const iconDir = path.join(distDir, 'icons');
  await mkdir(iconDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) await sharp(sourceIconPath).resize(size, size, { fit: 'contain' }).png().toFile(path.join(iconDir, `icon-${size}.png`));
}

async function buildOnce({ production = false } = {}) {
  const [source, listingMarkerFunctions, manifestText] = await Promise.all([
    readFile(userscriptPath, 'utf8'), readFile(listingCapturePath, 'utf8'), readFile(manifestPath, 'utf8')
  ]);
  const manifest = JSON.parse(manifestText);
  const entry = transformUserscript(source, manifest.version, listingMarkerFunctions);
  await rm(distDir, { recursive: true, force: true }); await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, 'map-hook.js'), earlyMapHook);
  await build({ stdin: { contents: entry, loader: 'js', resolveDir: extensionRoot, sourcefile: 'town-red-rightmove-extension.js' }, bundle: true, format: 'iife', platform: 'browser', target: ['chrome120'], minify: production, sourcemap: production ? false : 'inline', legalComments: production ? 'none' : 'inline', outfile: path.join(distDir, 'content.js'), logLevel: 'info' });
  await buildIcons(); await writeFile(path.join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[Town Red] Chrome extension ${production ? 'production ' : ''}build complete`); return manifest;
}

async function addDirectoryToZip(zipFile, directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) { const absolutePath = path.join(directory, entry.name); if (entry.isDirectory()) await addDirectoryToZip(zipFile, absolutePath, root); else if (entry.isFile()) zipFile.addFile(absolutePath, path.relative(root, absolutePath).split(path.sep).join('/'), { compress: true }); }
}

async function packageRelease() {
  const manifest = await buildOnce({ production: true }); await rm(releaseDir, { recursive: true, force: true }); await mkdir(releaseDir, { recursive: true });
  const zipPath = path.join(releaseDir, `town-red-rightmove-${manifest.version}.zip`);
  await new Promise(async (resolve, reject) => { const zipFile = new yazl.ZipFile(); const output = createWriteStream(zipPath); output.on('close', resolve); output.on('error', reject); zipFile.outputStream.on('error', reject); zipFile.outputStream.pipe(output); try { await addDirectoryToZip(zipFile, distDir); zipFile.end(); } catch (error) { reject(error); } });
  console.log(`[Town Red] Web Store package: ${zipPath}`);
}

const packageMode = process.argv.includes('--package'); const watchMode = process.argv.includes('--watch');
if (packageMode) await packageRelease(); else await buildOnce();
if (watchMode) { let timer = null; const rebuild = () => { clearTimeout(timer); timer = setTimeout(() => buildOnce().catch(console.error), 100); }; watch(userscriptPath, rebuild); watch(listingCapturePath, rebuild); watch(manifestPath, rebuild); watch(sourceIconPath, rebuild); console.log('[Town Red] Watching extension sources...'); }
