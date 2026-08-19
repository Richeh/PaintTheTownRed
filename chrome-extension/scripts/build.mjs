import { build } from 'esbuild';
import archiver from 'archiver';
import sharp from 'sharp';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

function transformUserscript(source, version) {
  const withoutHeader = source.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
  return storageShim + '\n' + withoutHeader
    .replace('const PAGE = unsafeWindow;', 'const PAGE = window;')
    .replace("const sbLibrary = typeof supabase !== 'undefined' ? supabase : null;", 'const sbLibrary = supabase;')
    .replace(/Rightmove shared geographic client v[\d.]+ loaded/, `Rightmove Chrome extension client v${version} loaded`);
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

async function packageRelease() {
  const manifest = await buildOnce({ production: true });
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });
  const zipPath = path.join(releaseDir, `town-red-rightmove-${manifest.version}.zip`);

  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(distDir, false);
    archive.finalize();
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
