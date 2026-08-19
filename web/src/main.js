import './styles.css';
import { ensureAnonymousSession } from './supabase.js';
import { listSharedMaps, loadStrokes, subscribeToStrokeInserts } from './data.js';
import { createTownRedMap } from './map.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="grid min-h-screen grid-rows-[auto_1fr_auto] bg-stone-50 text-stone-900">
    <header class="flex flex-col gap-3 border-b border-stone-200 bg-white/90 px-4 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div>
        <p class="mb-0.5 text-xs font-bold uppercase tracking-[0.08em] text-red-800">Collaborative map</p>
        <h1 class="m-0 text-2xl font-bold tracking-tight sm:text-3xl">Town Red</h1>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-2 text-sm font-medium text-stone-700" for="shared-map-select">
          Map
          <select
            id="shared-map-select"
            class="max-w-64 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
            disabled
          >
            <option>Loading…</option>
          </select>
        </label>

        <button
          id="fit-overlay"
          type="button"
          class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled
        >
          Fit overlay
        </button>

        <span
          id="connection-status"
          class="shrink-0 rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-600"
        >Starting…</span>
      </div>
    </header>

    <section class="min-h-0 p-3 sm:p-4" aria-label="Town Red map">
      <div id="map-container" class="h-[calc(100vh-9.5rem)] min-h-[32rem] overflow-hidden rounded-2xl border border-stone-200 bg-stone-200 shadow-sm"></div>
    </section>

    <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-white/90 px-5 py-3 text-sm text-stone-600">
      <span id="identity-status">Connecting to Supabase…</span>
      <span id="overlay-status">No overlay loaded</span>
    </footer>
  </main>
`;

const connectionStatus = document.querySelector('#connection-status');
const identityStatus = document.querySelector('#identity-status');
const overlayStatus = document.querySelector('#overlay-status');
const mapSelect = document.querySelector('#shared-map-select');
const fitButton = document.querySelector('#fit-overlay');
const mapContainer = document.querySelector('#map-container');

const renderer = createTownRedMap(mapContainer, {
  onReady: () => setConnectionStatus('Map ready', 'connected'),
  onError: (error) => {
    console.error('[Town Red] MapLibre error', error);
    setConnectionStatus('Map error', 'error');
  },
});

let userId = null;
let sharedMaps = [];
let selectedMapId = null;
let strokes = [];
let unsubscribeRealtime = null;
let refreshTimer = null;

function setConnectionStatus(label, state = 'idle') {
  connectionStatus.textContent = label;

  const common = 'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold';
  const stateClasses = {
    connected: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    error: 'border-red-200 bg-red-50 text-red-800',
    idle: 'border-stone-300 bg-stone-100 text-stone-600',
  };

  connectionStatus.className = `${common} ${stateClasses[state] || stateClasses.idle}`;
}

function renderMapOptions() {
  if (!sharedMaps.length) {
    mapSelect.innerHTML = '<option value="">No shared maps yet</option>';
    mapSelect.disabled = true;
    return;
  }

  mapSelect.innerHTML = sharedMaps
    .map(
      (map) =>
        `<option value="${map.id}">${escapeHtml(map.name)} · ${map.role}</option>`,
    )
    .join('');
  mapSelect.disabled = false;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function mergeStroke(stroke) {
  const index = strokes.findIndex((item) => item.id === stroke.id);

  if (index >= 0) {
    strokes[index] = stroke;
  } else {
    strokes.push(stroke);
  }

  strokes.sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  renderer.setStrokes(strokes);
  updateOverlayStatus();
}

function updateOverlayStatus() {
  if (!selectedMapId) {
    overlayStatus.textContent = 'No overlay loaded';
    fitButton.disabled = true;
    return;
  }

  const selected = sharedMaps.find((map) => map.id === selectedMapId);
  overlayStatus.textContent = `${selected?.name || 'Shared map'} · ${strokes.length} ${strokes.length === 1 ? 'stroke' : 'strokes'}`;
  fitButton.disabled = strokes.length === 0;
}

async function refreshStrokes({ quiet = false } = {}) {
  if (!selectedMapId) return;

  const mapIdAtStart = selectedMapId;
  if (!quiet) setConnectionStatus('Loading overlay…');

  const next = await loadStrokes(mapIdAtStart);

  if (selectedMapId !== mapIdAtStart) return;

  strokes = next;
  renderer.setStrokes(strokes);
  updateOverlayStatus();

  if (!quiet) setConnectionStatus('Live', 'connected');
}

async function selectMap(mapId, { fit = true } = {}) {
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;

  selectedMapId = mapId || null;
  strokes = [];
  renderer.setStrokes([]);
  updateOverlayStatus();

  if (!selectedMapId) return;

  mapSelect.value = selectedMapId;
  await refreshStrokes();

  if (fit && strokes.length) {
    renderer.fitToStrokes();
  }

  unsubscribeRealtime = await subscribeToStrokeInserts(
    selectedMapId,
    (stroke) => mergeStroke(stroke),
    (status, error) => {
      if (status === 'SUBSCRIBED') {
        setConnectionStatus('Live', 'connected');
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        console.warn('[Town Red] Realtime status', status, error);
        setConnectionStatus('Sync degraded', 'error');
      }
    },
  );
}

async function bootstrap() {
  try {
    setConnectionStatus('Authenticating…');

    const session = await ensureAnonymousSession();
    userId = session?.user?.id;

    identityStatus.textContent = userId
      ? `Anonymous session ${userId.slice(0, 8)}…`
      : 'Anonymous session established';

    setConnectionStatus('Loading maps…');
    sharedMaps = await listSharedMaps(userId);
    renderMapOptions();

    if (sharedMaps.length) {
      await selectMap(sharedMaps[0].id);
    } else {
      setConnectionStatus('Connected', 'connected');
      overlayStatus.textContent = 'No shared maps are available to this identity';
    }

    refreshTimer = window.setInterval(() => {
      refreshStrokes({ quiet: true }).catch((error) => {
        console.warn('[Town Red] background overlay refresh failed', error);
      });
    }, 15000);
  } catch (error) {
    console.error('[Town Red] bootstrap failed', error);
    setConnectionStatus('Connection error', 'error');
    identityStatus.textContent = error instanceof Error ? error.message : String(error);
  }
}

mapSelect.addEventListener('change', () => {
  selectMap(mapSelect.value).catch((error) => {
    console.error('[Town Red] could not switch map', error);
    setConnectionStatus('Map load error', 'error');
  });
});

fitButton.addEventListener('click', () => renderer.fitToStrokes());

window.addEventListener('beforeunload', () => {
  unsubscribeRealtime?.();
  if (refreshTimer) window.clearInterval(refreshTimer);
  renderer.destroy();
});

bootstrap();
