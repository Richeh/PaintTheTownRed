import { build } from 'esbuild';
import sharp from 'sharp';
import yazl from 'yazl';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Build inputs / outputs
// ---------------------------------------------------------------------------
// The Chrome extension deliberately reuses the Tampermonkey userscript as its
// main source of Rightmove/map behaviour. This build script converts the few
// userscript-only APIs (unsafeWindow/GM_*), injects extension-only property
// capture features, bundles Supabase locally, and produces Chrome-ready assets.
const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const userscriptPath = path.join(repoRoot, 'tampermonkey', 'town-red-rightmove.user.js');
const listingCapturePath = path.join(extensionRoot, 'src', 'listing-capture.js');
const manifestPath = path.join(extensionRoot, 'manifest.json');
const sourceIconPath = path.join(repoRoot, 'assets', 'logo', 'townred.png');
const distDir = path.join(extensionRoot, 'dist');
const releaseDir = path.join(extensionRoot, 'release');

// ---------------------------------------------------------------------------
// Userscript compatibility shims
// ---------------------------------------------------------------------------
// Tampermonkey supplies GM_* storage and a global Supabase library. Chrome does
// not, so the bundled extension replaces those APIs with localStorage and an
// npm-bundled @supabase/supabase-js client. The prefix keeps Town Red values
// isolated from Rightmove's own localStorage keys.
const storageShim = String.raw`
import { createClient } from '@supabase/supabase-js';
const supabase = { createClient };
const STORAGE_PREFIX = 'town-red-extension:';
function GM_getValue(key, fallback) { try { const raw = window.localStorage.getItem(STORAGE_PREFIX + key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } }
function GM_setValue(key, value) { try { window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch {} }
function GM_deleteValue(key) { try { window.localStorage.removeItem(STORAGE_PREFIX + key); } catch {} }
`;

// Rightmove constructs Google Maps very early. This tiny document-start script
// wraps the constructor before the main content script runs and remembers map
// instances on window.__townRedMaps. The main userscript can then attach its
// OverlayView to the real Rightmove map instead of trying to locate it in DOM.
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

// The extension adds persisted point markers/property links on top of the
// userscript's original stroke state. This small state block is inserted next
// to `let strokes = []`, while the feature functions themselves come from
// src/listing-capture.js below.
const listingMarkerState = String.raw`
    let markers = [];
    const markerLayer = document.createElement('div');
    markerLayer.id = 'town-red-listing-markers';
    Object.assign(markerLayer.style, { position: 'fixed', inset: '0', zIndex: '2147483100', pointerEvents: 'none' });
    document.documentElement.appendChild(markerLayer);
`;

// ---------------------------------------------------------------------------
// Source-transform helpers
// ---------------------------------------------------------------------------
function normalizeNewlines(value) {
  return String(value).replace(/\r\n/g, '\n');
}

// These transforms intentionally fail loudly when an expected userscript anchor
// disappears. A silent partial build would be much worse: Chrome could package
// an extension that loads successfully but has missing marker/auth behaviour.
function replaceRequired(source, needle, replacement, label) {
  // Git may check files out with CRLF on Windows. Normalizing here keeps the
  // source transforms deterministic across Windows/Linux/macOS instead of
  // making every multiline anchor carry its own \r?\n handling.
  const normalizedSource = normalizeNewlines(source);
  const normalizedNeedle = normalizeNewlines(needle);
  const normalizedReplacement = normalizeNewlines(replacement);
  if (!normalizedSource.includes(normalizedNeedle)) {
    throw new Error(`[Town Red] Extension build transform failed: missing ${label}`);
  }
  return normalizedSource.replace(normalizedNeedle, normalizedReplacement);
}

function replaceRegexRequired(source, regex, replacement, label) {
  const normalizedSource = normalizeNewlines(source);
  if (!regex.test(normalizedSource)) {
    throw new Error(`[Town Red] Extension build transform failed: missing ${label}`);
  }
  regex.lastIndex = 0;
  return normalizedSource.replace(regex, normalizeNewlines(replacement));
}

// ---------------------------------------------------------------------------
// Tampermonkey -> Chrome transformation
// ---------------------------------------------------------------------------
function transformUserscript(source, version, listingMarkerFunctions) {
  // Chrome does not need the Tampermonkey metadata block; manifest.json carries
  // the equivalent match/permission/version information.
  const withoutHeader = source.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
  let transformed = storageShim + '\n' + withoutHeader;

  // The Chrome content script already runs in the page's MAIN world, so normal
  // `window` replaces Tampermonkey's unsafeWindow bridge.
  transformed = replaceRequired(transformed, 'const PAGE = unsafeWindow;', 'const PAGE = window;', 'unsafeWindow bridge');
  transformed = replaceRequired(transformed, "const sbLibrary = typeof supabase !== 'undefined' ? supabase : null;", 'const sbLibrary = supabase;', 'Supabase bridge');
  transformed = transformed.replace(/Rightmove shared geographic client v[\d.]+ loaded/, `Rightmove Chrome extension client v${version} loaded`);

  // Older userscript revisions need the extension-specific session rebind
  // injected here. Newer revisions already contain the same logic directly,
  // so accept either form rather than failing the build on a missing old anchor.
  const authAnchor = `        let sessionResult = await sb.auth.getSession();\n        if (sessionResult.error) throw sessionResult.error;\n        let session = sessionResult.data.session;`;
  const authRehydrationMarker = "stored auth session could not be rebound";
  if (!transformed.includes(authRehydrationMarker)) {
    transformed = replaceRequired(
      transformed,
      authAnchor,
      `${authAnchor}\n\n        if (session?.access_token && session?.refresh_token) {\n          const rebound = await sb.auth.setSession({\n            access_token: session.access_token,\n            refresh_token: session.refresh_token\n          });\n          if (rebound.error) {\n            console.warn('[Town Red] stored auth session could not be rebound', rebound.error);\n            session = null;\n          } else {\n            session = rebound.data.session;\n          }\n        }\n\n        if (session?.access_token) {\n          const verified = await sb.auth.getUser(session.access_token);\n          if (verified.error || !verified.data.user?.id) {\n            console.warn('[Town Red] stored auth session is no longer valid', verified.error || 'missing user');\n            session = null;\n          } else if (verified.data.user.id !== session.user?.id) {\n            throw new Error('Town Red authentication identity changed unexpectedly. Reload the page before editing.');\n          }\n        }`,
      'auth session rehydration'
    );
  }

  // From this point on, each transform connects the extension-only marker
  // feature to one existing userscript lifecycle hook. listing-capture.js owns
  // the feature logic; build.mjs only supplies the integration seams.
  transformed = replaceRegexRequired(
    transformed,
    /(^[ \t]*let strokes = \[\];[ \t]*)(\r?\n)/m,
    `$1$2${listingMarkerState}`,
    'marker state anchor'
  );
  transformed = replaceRequired(
    transformed,
    '    function updateCount() { countEl.textContent = `${strokes.length} ${strokes.length === 1 ? \'stroke\' : \'strokes\'}`; }',
    '    function updateCount() { countEl.textContent = `${strokes.length} ${strokes.length === 1 ? \'stroke\' : \'strokes\'} · ${markers.length} ${markers.length === 1 ? \'point\' : \'points\'}`; }',
    'marker count'
  );
  transformed = replaceRequired(
    transformed,
    '    function sortStrokes() {',
    `${listingMarkerFunctions}\n    function sortStrokes() {`,
    'listing marker functions'
  );
  transformed = replaceRegexRequired(
    transformed,
    /(^[ \t]*strokes = \[\];[ \t]*\r?\n)([ \t]*currentStroke = null;)/m,
    `$1      markers = [];\n      renderTownRedMarkers();\n$2`,
    'map selection marker reset'
  );
  transformed = replaceRegexRequired(
    transformed,
    /(^[ \t]*await loadRemoteStrokes\(\);[ \t]*\r?\n)([ \t]*await subscribeRealtime\(\);)/m,
    `$1      await loadRemoteMarkers();\n$2`,
    'marker initial load'
  );
  transformed = replaceRegexRequired(
    transformed,
    /(\.on\('postgres_changes', \{\s*event: 'INSERT', schema: 'public', table: 'strokes', filter: `map_id=eq\.\$\{subscribedMapId\}`\s*\}, payload => \{[\s\S]*?if \(selectedMapId === subscribedMapId\) mergeStroke\(payload\.new\);\s*\}\)\s*)(\.subscribe\(\(status, error\) => \{)/m,
    `$1.on('postgres_changes', { event: '*', schema: 'public', table: 'markers', filter: \`map_id=eq.\${subscribedMapId}\` }, payload => {\n          if (selectedMapId !== subscribedMapId) return;\n          if (payload.eventType === 'DELETE') { markers = markers.filter(item => item.id !== payload.old?.id); updateCount(); renderTownRedMarkers(); } else mergeMarker(payload.new);\n        })\n        $2`,
    'marker realtime subscription'
  );
  transformed = replaceRegexRequired(
    transformed,
    /(^[ \t]*if \(currentStroke\) drawStroke\(currentStroke\);[ \t]*\r?\n)([ \t]*\})/m,
    `$1      renderTownRedMarkers();\n$2`,
    'marker redraw hook'
  );
  transformed = replaceRequired(
    transformed,
    "    $('#tr-refresh').addEventListener('click', () => loadRemoteStrokes().catch(reportError));",
    "    $('#tr-refresh').addEventListener('click', () => Promise.all([loadRemoteStrokes(), loadRemoteMarkers()]).catch(reportError));",
    'marker refresh button'
  );
  transformed = replaceRequired(
    transformed,
    "    document.addEventListener('keydown', event => {",
    "    document.addEventListener('click', event => captureRightmoveProperty(event), true);\n\n    document.addEventListener('keydown', event => {",
    'property capture listener'
  );
  transformed = replaceRegexRequired(
    transformed,
    /(^[ \t]*await loadRemoteStrokes\(\);[ \t]*\r?\n)([ \t]*console\.info\('\[Town Red\] periodic sync complete:', strokes\.length, 'strokes'\);)/m,
    `        await Promise.all([loadRemoteStrokes(), loadRemoteMarkers()]);\n        console.info('[Town Red] periodic sync complete:', strokes.length, 'strokes', markers.length, 'points');`,
    'marker periodic sync'
  );

  // Final verification catches an accidental no-op transform even if individual
  // anchors happened to match. Both core marker state and click capture must be
  // present in the code handed to esbuild.
  if (!transformed.includes('let markers = [];') || !transformed.includes('async function captureRightmoveProperty')) {
    throw new Error('[Town Red] Extension build verification failed: listing capture feature is incomplete');
  }
  return transformed;
}

// ---------------------------------------------------------------------------
// Asset generation and bundling
// ---------------------------------------------------------------------------
async function buildIcons() {
  const iconDir = path.join(distDir, 'icons');
  await mkdir(iconDir, { recursive: true });

  // Keep one source artwork in the repo; Sharp creates the exact PNG sizes the
  // Chrome manifest expects so icon variants cannot drift apart manually.
  for (const size of [16, 32, 48, 128]) {
    await sharp(sourceIconPath)
      .resize(size, size, { fit: 'contain' })
      .png()
      .toFile(path.join(iconDir, `icon-${size}.png`));
  }
}

async function buildOnce({ production = false } = {}) {
  // Read all mutable inputs together so one build uses a coherent snapshot.
  const [source, listingMarkerFunctions, manifestText] = await Promise.all([
    readFile(userscriptPath, 'utf8'),
    readFile(listingCapturePath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  const entry = transformUserscript(source, manifest.version, listingMarkerFunctions);

  // dist/ is disposable. Recreate it on every build so deleted/renamed source
  // assets cannot linger in a package by accident.
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, 'map-hook.js'), earlyMapHook);

  // esbuild bundles Supabase and the transformed content script into a single
  // IIFE suitable for a Manifest V3 MAIN-world content script.
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

// ---------------------------------------------------------------------------
// Chrome Web Store package creation
// ---------------------------------------------------------------------------
async function addDirectoryToZip(zipFile, directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await addDirectoryToZip(zipFile, absolutePath, root);
    } else if (entry.isFile()) {
      // ZIP paths always use forward slashes, even when packaging on Windows.
      zipFile.addFile(absolutePath, path.relative(root, absolutePath).split(path.sep).join('/'), { compress: true });
    }
  }
}

async function packageRelease() {
  // Packaging always performs a fresh production build first; release ZIPs are
  // never assembled from whatever happens to be in an old dist/ directory.
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

// ---------------------------------------------------------------------------
// CLI modes
// ---------------------------------------------------------------------------
const packageMode = process.argv.includes('--package');
const watchMode = process.argv.includes('--watch');

if (packageMode) await packageRelease();
else await buildOnce();

// Watch source files rather than dist/. The short debounce collapses editors
// that emit several filesystem events for one save into a single rebuild.
if (watchMode) {
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildOnce().catch(console.error), 100);
  };
  watch(userscriptPath, rebuild);
  watch(listingCapturePath, rebuild);
  watch(manifestPath, rebuild);
  watch(sourceIconPath, rebuild);
  console.log('[Town Red] Watching extension sources...');
}
