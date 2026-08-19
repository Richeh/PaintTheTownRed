import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const userscriptPath = path.join(repoRoot, 'tampermonkey', 'town-red-rightmove.user.js');
const manifestPath = path.join(extensionRoot, 'manifest.json');
const distDir = path.join(extensionRoot, 'dist');

const storageShim = String.raw`
import { createClient } from '@supabase/supabase-js';

// The Tampermonkey prototype uses synchronous GM_* storage. MAIN-world content
// scripts cannot call extension APIs directly, so the first Chrome build keeps
// those semantics using namespaced Rightmove localStorage. This preserves the
// existing anonymous Supabase identity and cached/settings behaviour cleanly.
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

function transformUserscript(source) {
  const withoutHeader = source.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
  return storageShim + '\n' + withoutHeader
    .replace('const PAGE = unsafeWindow;', 'const PAGE = window;')
    .replace("const sbLibrary = typeof supabase !== 'undefined' ? supabase : null;", 'const sbLibrary = supabase;')
    .replace('Rightmove shared geographic client v0.3.1 loaded', 'Rightmove Chrome extension client v0.1.0 loaded');
}

async function buildOnce() {
  const source = await readFile(userscriptPath, 'utf8');
  const manifest = await readFile(manifestPath, 'utf8');
  const entry = transformUserscript(source);

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

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
    minify: false,
    sourcemap: 'inline',
    outfile: path.join(distDir, 'content.js'),
    logLevel: 'info',
  });

  await writeFile(path.join(distDir, 'manifest.json'), manifest);
  console.log('[Town Red] Chrome extension built in chrome-extension/dist');
}

await buildOnce();

if (process.argv.includes('--watch')) {
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildOnce().catch((error) => console.error(error)), 100);
  };
  watch(userscriptPath, rebuild);
  watch(manifestPath, rebuild);
  console.log('[Town Red] Watching userscript and manifest for changes...');
}
