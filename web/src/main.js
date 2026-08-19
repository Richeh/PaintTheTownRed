import './styles.css';
import { ensureAnonymousSession } from './supabase.js';
import {
  createMapInvite,
  createSharedMap,
  createStroke,
  joinSharedMap,
  listSharedMaps,
  loadStrokes,
  subscribeToStrokeInserts,
} from './data.js';
import { createTownRedMap } from './map.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="grid min-h-screen grid-rows-[auto_1fr_auto] bg-stone-50 text-stone-900">
    <header class="flex flex-col gap-3 border-b border-stone-200 bg-white/90 px-4 py-4 backdrop-blur sm:px-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

          <button id="create-map" type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50" disabled>
            New map
          </button>

          <button id="join-map" type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50" disabled>
            Join
          </button>

          <button id="invite-map" type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50" disabled>
            Invite
          </button>

          <button id="fit-overlay" type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50" disabled>
            Fit overlay
          </button>

          <span id="connection-status" class="shrink-0 rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-600">Starting…</span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
        <div class="flex flex-wrap gap-1" role="group" aria-label="Painting mode">
          <button data-mode="navigate" type="button" class="paint-mode rounded-lg border px-3 py-2 text-sm font-semibold">Navigate</button>
          <button data-mode="red" type="button" class="paint-mode rounded-lg border px-3 py-2 text-sm font-semibold">Red</button>
          <button data-mode="blue" type="button" class="paint-mode rounded-lg border px-3 py-2 text-sm font-semibold">Blue</button>
          <button data-mode="erase" type="button" class="paint-mode rounded-lg border px-3 py-2 text-sm font-semibold">Erase</button>
        </div>

        <label class="ml-1 flex items-center gap-2 text-sm font-medium text-stone-700" for="brush-size">
          Brush
          <input id="brush-size" type="range" min="8" max="140" step="2" value="42" class="w-28 accent-red-800" />
          <span id="brush-size-value" class="w-10 text-right text-xs text-stone-500">42px</span>
        </label>

        <label class="flex items-center gap-2 text-sm font-medium text-stone-700" for="paint-opacity">
          Opacity
          <input id="paint-opacity" type="range" min="0.05" max="0.6" step="0.05" value="0.2" class="w-24 accent-red-800" />
          <span id="opacity-value" class="w-10 text-right text-xs text-stone-500">20%</span>
        </label>

        <span id="edit-status" class="text-xs text-stone-500">Choose a shared map to paint</span>
      </div>
    </header>

    <section class="min-h-0 p-3 sm:p-4" aria-label="Town Red map">
      <div id="map-container" class="h-[calc(100vh-13rem)] min-h-[32rem] overflow-hidden rounded-2xl border border-stone-200 bg-stone-200 shadow-sm"></div>
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
const editStatus = document.querySelector('#edit-status');
const mapSelect = document.querySelector('#shared-map-select');
const createMapButton = document.querySelector('#create-map');
const joinMapButton = document.querySelector('#join-map');
const inviteMapButton = document.querySelector('#invite-map');
const fitButton = document.querySelector('#fit-overlay');
const mapContainer = document.querySelector('#map-container');
const brushSize = document.querySelector('#brush-size');
const brushSizeValue = document.querySelector('#brush-size-value');
const opacityInput = document.querySelector('#paint-opacity');
const opacityValue = document.querySelector('#opacity-value');
const modeButtons = [...document.querySelectorAll('.paint-mode')];

let userId = null;
let sharedMaps = [];
let selectedMapId = null;
let strokes = [];
let unsubscribeRealtime = null;
let refreshTimer = null;
let cleanedUp = false;
let mode = 'navigate';

const renderer = createTownRedMap(mapContainer, {
  onReady: () => setConnectionStatus('Map ready', 'connected'),
  onError: (error) => {
    console.error('[Town Red] MapLibre error', error);
    setConnectionStatus('Map error', 'error');
  },
  onStrokeComplete: (stroke) => saveDrawnStroke(stroke),
});

function selectedMap() {
  return sharedMaps.find((map) => map.id === selectedMapId) || null;
}

function canEdit() {
  return ['owner', 'editor'].includes(selectedMap()?.role);
}

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

function updateEditor() {
  const editable = Boolean(selectedMapId && canEdit());
  const owner = selectedMap()?.role === 'owner';

  if (!editable && mode !== 'navigate') mode = 'navigate';

  renderer.setEditor({
    enabled: editable,
    mode,
    brushPixels: Number(brushSize.value),
    opacity: Number(opacityInput.value),
  });

  for (const button of modeButtons) {
    const buttonMode = button.dataset.mode;
    const active = buttonMode === mode;
    const paintingMode = buttonMode !== 'navigate';
    button.disabled = paintingMode && !editable;
    button.className = `paint-mode rounded-lg border px-3 py-2 text-sm font-semibold ${
      active
        ? 'border-stone-800 bg-stone-900 text-white'
        : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40'
    }`;
  }

  inviteMapButton.disabled = !userId || !owner;

  if (!selectedMapId) editStatus.textContent = 'Choose a shared map to paint';
  else if (!editable) editStatus.textContent = 'Viewer access · painting disabled';
  else editStatus.textContent = `${selectedMap()?.role} access · ${mode === 'navigate' ? 'navigation mode' : `${mode} brush active`}`;
}

function renderMapOptions() {
  if (!sharedMaps.length) {
    mapSelect.innerHTML = '<option value="">No shared maps yet</option>';
    mapSelect.disabled = true;
    return;
  }

  mapSelect.innerHTML = sharedMaps
    .map((map) => `<option value="${map.id}">${escapeHtml(map.name)} · ${map.role}</option>`)
    .join('');
  mapSelect.disabled = false;
}

async function refreshMapList(preferMapId = selectedMapId) {
  sharedMaps = await listSharedMaps(userId);
  renderMapOptions();

  const target = preferMapId && sharedMaps.some((map) => map.id === preferMapId)
    ? preferMapId
    : sharedMaps[0]?.id || null;

  await selectMap(target);
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
  if (index >= 0) strokes[index] = stroke;
  else strokes.push(stroke);

  strokes.sort(
    (a, b) => Number(a.sequence ?? Number.MAX_SAFE_INTEGER) - Number(b.sequence ?? Number.MAX_SAFE_INTEGER),
  );
  renderer.setStrokes(strokes);
  updateOverlayStatus();
}

function updateOverlayStatus() {
  if (!selectedMapId) {
    overlayStatus.textContent = 'No overlay loaded';
    fitButton.disabled = true;
    return;
  }

  const selected = selectedMap();
  overlayStatus.textContent = `${selected?.name || 'Shared map'} · ${strokes.length} ${strokes.length === 1 ? 'stroke' : 'strokes'}`;
  fitButton.disabled = strokes.length === 0;
}

async function saveDrawnStroke(stroke) {
  if (!selectedMapId || !userId || !canEdit()) return;

  const id = crypto.randomUUID();
  const optimistic = {
    id,
    sequence: Number.MAX_SAFE_INTEGER,
    map_id: selectedMapId,
    created_by: userId,
    created_at: new Date().toISOString(),
    mode: stroke.mode,
    brush_metres: stroke.brush_metres,
    opacity: stroke.opacity,
    points: stroke.points,
    _pending: true,
  };

  strokes.push(optimistic);
  renderer.setStrokes(strokes);
  updateOverlayStatus();
  setConnectionStatus('Saving…');

  try {
    const saved = await createStroke({
      id,
      mapId: selectedMapId,
      userId,
      mode: stroke.mode,
      brushMetres: stroke.brush_metres,
      opacity: stroke.opacity,
      points: stroke.points,
    });
    mergeStroke(saved);
    setConnectionStatus('Live', 'connected');
  } catch (error) {
    strokes = strokes.filter((item) => item.id !== id);
    renderer.setStrokes(strokes);
    updateOverlayStatus();
    console.error('[Town Red] could not save stroke', error);
    setConnectionStatus('Save failed', 'error');
  }
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
  updateEditor();

  if (!selectedMapId) return;

  mapSelect.value = selectedMapId;
  await refreshStrokes();

  if (fit && strokes.length) renderer.fitToStrokes();

  unsubscribeRealtime = await subscribeToStrokeInserts(
    selectedMapId,
    (stroke) => mergeStroke(stroke),
    (status, error) => {
      if (status === 'SUBSCRIBED') setConnectionStatus('Live', 'connected');
      else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        console.warn('[Town Red] Realtime status', status, error);
        setConnectionStatus('Sync degraded', 'error');
      }
    },
  );
}

async function handleCreateMap() {
  const name = window.prompt('Name for the shared map:', 'House Search');
  if (!name?.trim()) return;

  createMapButton.disabled = true;
  joinMapButton.disabled = true;
  setConnectionStatus('Creating map…');

  try {
    const created = await createSharedMap({ name, userId });
    await refreshMapList(created.id);
    setConnectionStatus('Live', 'connected');
  } catch (error) {
    console.error('[Town Red] could not create map', error);
    setConnectionStatus('Create failed', 'error');
    window.alert(`Could not create map:\n${error instanceof Error ? error.message : String(error)}`);
  } finally {
    createMapButton.disabled = !userId;
    joinMapButton.disabled = !userId;
    updateEditor();
  }
}

async function handleJoinMap() {
  const token = window.prompt('Paste the invite token:');
  if (!token?.trim()) return;

  createMapButton.disabled = true;
  joinMapButton.disabled = true;
  setConnectionStatus('Joining map…');

  try {
    const joinedMapId = await joinSharedMap(token);
    await refreshMapList(joinedMapId);
    setConnectionStatus('Live', 'connected');
  } catch (error) {
    console.error('[Town Red] could not join map', error);
    setConnectionStatus('Join failed', 'error');
    window.alert(`Could not join map:\n${error instanceof Error ? error.message : String(error)}`);
  } finally {
    createMapButton.disabled = !userId;
    joinMapButton.disabled = !userId;
    updateEditor();
  }
}

async function handleCreateInvite() {
  if (!selectedMapId || selectedMap()?.role !== 'owner') return;

  const role = (window.prompt('Invite role: editor or viewer', 'editor') || '').trim().toLowerCase();
  if (!role) return;
  if (!['editor', 'viewer'].includes(role)) {
    window.alert('Role must be "editor" or "viewer".');
    return;
  }

  const usesText = window.prompt('Maximum uses? Leave blank for unlimited.', '1');
  if (usesText === null) return;

  const maxUses = usesText.trim() ? Number(usesText.trim()) : null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
    window.alert('Maximum uses must be a positive whole number.');
    return;
  }

  inviteMapButton.disabled = true;
  setConnectionStatus('Creating invite…');

  try {
    const token = await createMapInvite({ mapId: selectedMapId, role, maxUses });
    if (!token) throw new Error('Supabase returned no invite token.');

    setConnectionStatus('Live', 'connected');
    window.prompt(`Copy this ${role} invite token. It is shown only now:`, token);
  } catch (error) {
    console.error('[Town Red] could not create invite', error);
    setConnectionStatus('Invite failed', 'error');
    window.alert(`Could not create invite:\n${error instanceof Error ? error.message : String(error)}`);
  } finally {
    updateEditor();
  }
}

async function bootstrap() {
  try {
    setConnectionStatus('Authenticating…');

    const session = await ensureAnonymousSession();
    userId = session?.user?.id;
    createMapButton.disabled = !userId;
    joinMapButton.disabled = !userId;

    identityStatus.textContent = userId
      ? `Anonymous session ${userId.slice(0, 8)}…`
      : 'Anonymous session established';

    setConnectionStatus('Loading maps…');
    sharedMaps = await listSharedMaps(userId);
    renderMapOptions();

    if (sharedMaps.length) await selectMap(sharedMaps[0].id);
    else {
      setConnectionStatus('Connected', 'connected');
      overlayStatus.textContent = 'No shared maps are available to this identity';
      updateEditor();
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

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    updateEditor();
  });
});

brushSize.addEventListener('input', () => {
  brushSizeValue.textContent = `${brushSize.value}px`;
  updateEditor();
});

opacityInput.addEventListener('input', () => {
  opacityValue.textContent = `${Math.round(Number(opacityInput.value) * 100)}%`;
  updateEditor();
});

mapSelect.addEventListener('change', () => {
  selectMap(mapSelect.value).catch((error) => {
    console.error('[Town Red] could not switch map', error);
    setConnectionStatus('Map load error', 'error');
  });
});

createMapButton.addEventListener('click', handleCreateMap);
joinMapButton.addEventListener('click', handleJoinMap);
inviteMapButton.addEventListener('click', handleCreateInvite);
fitButton.addEventListener('click', () => renderer.fitToStrokes());

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  renderer.destroy();
}

window.addEventListener('pagehide', cleanup, { once: true });
if (import.meta.hot) import.meta.hot.dispose(cleanup);

updateEditor();
bootstrap();
