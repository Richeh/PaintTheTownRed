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

const buttonClass = 'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = 'rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50';
const inputClass = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100';

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
            <select id="shared-map-select" class="max-w-64 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100" disabled>
              <option>Loading…</option>
            </select>
          </label>

          <button id="create-map" type="button" class="${buttonClass}" disabled>New map</button>
          <button id="join-map" type="button" class="${buttonClass}" disabled>Join</button>
          <button id="invite-map" type="button" class="${buttonClass}" disabled>Invite</button>
          <button id="fit-overlay" type="button" class="${buttonClass}" disabled>Fit overlay</button>
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

  <dialog id="create-map-dialog" class="m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/40">
    <form id="create-map-form" class="p-5">
      <h2 class="m-0 text-lg font-semibold">Create a map</h2>
      <p class="mt-1 text-sm text-stone-600">Create a new shared Town Red overlay.</p>
      <label class="mt-4 block text-sm font-medium text-stone-700" for="create-map-name">
        Map name
        <input id="create-map-name" class="${inputClass}" type="text" value="House Search" maxlength="120" required />
      </label>
      <p id="create-map-error" class="mt-3 hidden text-sm text-red-700" aria-live="polite"></p>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" data-close-dialog="create-map-dialog" class="${buttonClass}">Cancel</button>
        <button id="create-map-submit" type="submit" class="${primaryButtonClass}">Create map</button>
      </div>
    </form>
  </dialog>

  <dialog id="join-map-dialog" class="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/40">
    <form id="join-map-form" class="p-5">
      <h2 class="m-0 text-lg font-semibold">Join a map</h2>
      <p class="mt-1 text-sm text-stone-600">Paste either a Town Red invite token or a full invite link.</p>
      <label class="mt-4 block text-sm font-medium text-stone-700" for="join-map-token">
        Invite
        <input id="join-map-token" class="${inputClass}" type="text" autocomplete="off" required />
      </label>
      <p id="join-map-error" class="mt-3 hidden text-sm text-red-700" aria-live="polite"></p>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" data-close-dialog="join-map-dialog" class="${buttonClass}">Cancel</button>
        <button id="join-map-submit" type="submit" class="${primaryButtonClass}">Join map</button>
      </div>
    </form>
  </dialog>

  <dialog id="invite-map-dialog" class="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/40">
    <form id="invite-map-form" class="p-5">
      <h2 class="m-0 text-lg font-semibold">Invite collaborators</h2>
      <p id="invite-map-description" class="mt-1 text-sm text-stone-600">Create a share link for this map.</p>

      <div id="invite-settings">
        <label class="mt-4 block text-sm font-medium text-stone-700" for="invite-role">
          Access
          <select id="invite-role" class="${inputClass}">
            <option value="editor">Editor — can paint</option>
            <option value="viewer">Viewer — view only</option>
          </select>
        </label>

        <label class="mt-4 block text-sm font-medium text-stone-700" for="invite-max-uses">
          Maximum uses
          <input id="invite-max-uses" class="${inputClass}" type="number" min="1" step="1" value="1" placeholder="Leave blank for unlimited" />
          <span class="mt-1 block text-xs font-normal text-stone-500">Leave blank for an unlimited-use link.</span>
        </label>
      </div>

      <div id="invite-result" class="mt-4 hidden">
        <label class="block text-sm font-medium text-stone-700" for="invite-link">Invite link</label>
        <div class="mt-1 flex gap-2">
          <input id="invite-link" class="min-w-0 flex-1 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-700" type="text" readonly />
          <button id="copy-invite-link" type="button" class="${buttonClass}">Copy</button>
        </div>
        <details class="mt-3 text-sm text-stone-600">
          <summary class="cursor-pointer select-none">Show raw token</summary>
          <code id="invite-token" class="mt-2 block break-all rounded-lg bg-stone-100 p-3 text-xs text-stone-700"></code>
        </details>
      </div>

      <p id="invite-map-error" class="mt-3 hidden text-sm text-red-700" aria-live="polite"></p>
      <p id="invite-copy-status" class="mt-3 hidden text-sm text-emerald-700" aria-live="polite"></p>

      <div class="mt-5 flex justify-end gap-2">
        <button type="button" data-close-dialog="invite-map-dialog" class="${buttonClass}">Close</button>
        <button id="invite-map-submit" type="submit" class="${primaryButtonClass}">Create invite</button>
      </div>
    </form>
  </dialog>

  <dialog id="message-dialog" class="m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/40">
    <div class="p-5">
      <h2 id="message-dialog-title" class="m-0 text-lg font-semibold">Town Red</h2>
      <p id="message-dialog-body" class="mt-3 whitespace-pre-wrap text-sm text-stone-600"></p>
      <div class="mt-5 flex justify-end">
        <button type="button" data-close-dialog="message-dialog" class="${primaryButtonClass}">OK</button>
      </div>
    </div>
  </dialog>
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

const createMapDialog = document.querySelector('#create-map-dialog');
const createMapForm = document.querySelector('#create-map-form');
const createMapName = document.querySelector('#create-map-name');
const createMapError = document.querySelector('#create-map-error');
const createMapSubmit = document.querySelector('#create-map-submit');

const joinMapDialog = document.querySelector('#join-map-dialog');
const joinMapForm = document.querySelector('#join-map-form');
const joinMapToken = document.querySelector('#join-map-token');
const joinMapError = document.querySelector('#join-map-error');
const joinMapSubmit = document.querySelector('#join-map-submit');

const inviteMapDialog = document.querySelector('#invite-map-dialog');
const inviteMapForm = document.querySelector('#invite-map-form');
const inviteMapDescription = document.querySelector('#invite-map-description');
const inviteSettings = document.querySelector('#invite-settings');
const inviteRole = document.querySelector('#invite-role');
const inviteMaxUses = document.querySelector('#invite-max-uses');
const inviteResult = document.querySelector('#invite-result');
const inviteLink = document.querySelector('#invite-link');
const inviteToken = document.querySelector('#invite-token');
const copyInviteLinkButton = document.querySelector('#copy-invite-link');
const inviteMapError = document.querySelector('#invite-map-error');
const inviteCopyStatus = document.querySelector('#invite-copy-status');
const inviteMapSubmit = document.querySelector('#invite-map-submit');

const messageDialog = document.querySelector('#message-dialog');
const messageDialogTitle = document.querySelector('#message-dialog-title');
const messageDialogBody = document.querySelector('#message-dialog-body');

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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function showInlineError(element, error) {
  element.textContent = errorMessage(error);
  element.classList.remove('hidden');
}

function clearInlineMessage(element) {
  element.textContent = '';
  element.classList.add('hidden');
}

function showMessage(title, body) {
  messageDialogTitle.textContent = title;
  messageDialogBody.textContent = body;
  if (!messageDialog.open) messageDialog.showModal();
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
    showMessage('Could not save stroke', errorMessage(error));
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

function extractInviteToken(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    return url.searchParams.get('invite')?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

function inviteUrlForToken(token) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('invite', token);
  return url.toString();
}

function inviteTokenFromCurrentUrl() {
  return new URL(window.location.href).searchParams.get('invite')?.trim() || '';
}

function clearInviteFromCurrentUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('invite')) return;
  url.searchParams.delete('invite');
  window.history.replaceState({}, '', url);
}

async function redeemInvite(token, { automatic = false } = {}) {
  const cleanToken = extractInviteToken(token);
  if (!cleanToken) throw new Error('No invite token was supplied.');

  setConnectionStatus('Joining map…');
  const joinedMapId = await joinSharedMap(cleanToken);
  await refreshMapList(joinedMapId);
  setConnectionStatus('Live', 'connected');

  if (automatic) clearInviteFromCurrentUrl();
  return joinedMapId;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('The browser could not copy the invite link.');
}

function openCreateMapDialog() {
  clearInlineMessage(createMapError);
  createMapName.value = 'House Search';
  createMapDialog.showModal();
  requestAnimationFrame(() => createMapName.select());
}

function openJoinMapDialog(initialValue = '') {
  clearInlineMessage(joinMapError);
  joinMapToken.value = initialValue;
  joinMapDialog.showModal();
  requestAnimationFrame(() => joinMapToken.focus());
}

function openInviteDialog() {
  if (!selectedMapId || selectedMap()?.role !== 'owner') return;

  clearInlineMessage(inviteMapError);
  clearInlineMessage(inviteCopyStatus);
  inviteSettings.classList.remove('hidden');
  inviteResult.classList.add('hidden');
  inviteMapSubmit.classList.remove('hidden');
  inviteMapSubmit.disabled = false;
  inviteRole.value = 'editor';
  inviteMaxUses.value = '1';
  inviteLink.value = '';
  inviteToken.textContent = '';
  inviteMapDescription.textContent = `Create a share link for “${selectedMap()?.name || 'this map'}”.`;
  inviteMapDialog.showModal();
}

createMapForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearInlineMessage(createMapError);
  const name = createMapName.value.trim();
  if (!name) return;

  createMapSubmit.disabled = true;
  setConnectionStatus('Creating map…');

  try {
    const created = await createSharedMap({ name, userId });
    await refreshMapList(created.id);
    setConnectionStatus('Live', 'connected');
    createMapDialog.close();
  } catch (error) {
    console.error('[Town Red] could not create map', error);
    setConnectionStatus('Create failed', 'error');
    showInlineError(createMapError, error);
  } finally {
    createMapSubmit.disabled = false;
    updateEditor();
  }
});

joinMapForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearInlineMessage(joinMapError);

  joinMapSubmit.disabled = true;
  try {
    await redeemInvite(joinMapToken.value);
    joinMapDialog.close();
  } catch (error) {
    console.error('[Town Red] could not join map', error);
    setConnectionStatus('Join failed', 'error');
    showInlineError(joinMapError, error);
  } finally {
    joinMapSubmit.disabled = false;
    updateEditor();
  }
});

inviteMapForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedMapId || selectedMap()?.role !== 'owner') return;

  clearInlineMessage(inviteMapError);
  clearInlineMessage(inviteCopyStatus);

  const usesText = inviteMaxUses.value.trim();
  const maxUses = usesText ? Number(usesText) : null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
    showInlineError(inviteMapError, 'Maximum uses must be a positive whole number, or left blank.');
    return;
  }

  inviteMapSubmit.disabled = true;
  setConnectionStatus('Creating invite…');

  try {
    const token = await createMapInvite({
      mapId: selectedMapId,
      role: inviteRole.value,
      maxUses,
    });

    if (!token) throw new Error('Supabase created the invite but did not return a token.');

    const link = inviteUrlForToken(token);
    inviteLink.value = link;
    inviteToken.textContent = token;
    inviteSettings.classList.add('hidden');
    inviteResult.classList.remove('hidden');
    inviteMapSubmit.classList.add('hidden');
    setConnectionStatus('Live', 'connected');
  } catch (error) {
    console.error('[Town Red] could not create invite', error);
    setConnectionStatus('Invite failed', 'error');
    showInlineError(inviteMapError, error);
    inviteMapSubmit.disabled = false;
  }
});

copyInviteLinkButton.addEventListener('click', async () => {
  clearInlineMessage(inviteMapError);
  clearInlineMessage(inviteCopyStatus);

  try {
    await copyText(inviteLink.value);
    inviteCopyStatus.textContent = 'Invite link copied.';
    inviteCopyStatus.classList.remove('hidden');
    copyInviteLinkButton.textContent = 'Copied';
    window.setTimeout(() => {
      copyInviteLinkButton.textContent = 'Copy';
    }, 1400);
  } catch (error) {
    showInlineError(inviteMapError, error);
  }
});

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

    const startupInvite = inviteTokenFromCurrentUrl();
    if (startupInvite) {
      try {
        await redeemInvite(startupInvite, { automatic: true });
      } catch (error) {
        console.error('[Town Red] automatic invite redemption failed', error);
        clearInviteFromCurrentUrl();
        showMessage('Could not join map', errorMessage(error));
      }
    }

    if (!sharedMaps.length) {
      setConnectionStatus('Loading maps…');
      sharedMaps = await listSharedMaps(userId);
      renderMapOptions();

      if (sharedMaps.length) {
        await selectMap(sharedMaps[0].id);
      } else {
        setConnectionStatus('Connected', 'connected');
        overlayStatus.textContent = 'No shared maps are available to this identity';
        updateEditor();
      }
    }

    refreshTimer = window.setInterval(() => {
      refreshStrokes({ quiet: true }).catch((error) => {
        console.warn('[Town Red] background overlay refresh failed', error);
      });
    }, 15000);
  } catch (error) {
    console.error('[Town Red] bootstrap failed', error);
    setConnectionStatus('Connection error', 'error');
    identityStatus.textContent = errorMessage(error);
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
    showMessage('Could not load map', errorMessage(error));
  });
});

createMapButton.addEventListener('click', openCreateMapDialog);
joinMapButton.addEventListener('click', () => openJoinMapDialog());
inviteMapButton.addEventListener('click', openInviteDialog);
fitButton.addEventListener('click', () => renderer.fitToStrokes());

document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => {
    document.getElementById(button.dataset.closeDialog)?.close();
  });
});

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

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
