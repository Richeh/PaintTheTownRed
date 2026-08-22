<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  createMapInvite,
  createSharedMap,
  createStroke,
  getProfile,
  joinSharedMap,
  listSharedMaps,
  loadStrokes,
  saveProfile,
  subscribeToStrokeInserts,
} from './data.js';
import { createTownRedMap } from './map.js';
import { ensureAnonymousSession } from './supabase.js';
import CreateMapDialog from './components/CreateMapDialog.vue';
import InviteMapDialog from './components/InviteMapDialog.vue';
import JoinMapDialog from './components/JoinMapDialog.vue';
import MessageDialog from './components/MessageDialog.vue';
import ProfileDialog from './components/ProfileDialog.vue';

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------
// Vue is the single source of truth for web-client collaboration/UI state. The
// MapLibre renderer remains deliberately framework-agnostic and is controlled
// through its small public API below. Email/account controls live in AuthDock,
// a separate Vue tree, so this component only needs to know the current uid.
const mapContainer = ref(null);
let renderer = null;
let unsubscribeRealtime = null;
let refreshTimer = null;
let profileResolve = null;

const userId = ref(null);
const profile = ref(null);
const sharedMaps = ref([]);
const selectedMapId = ref(null);
const strokes = ref([]);

const mode = ref('navigate');
const brushSize = ref(42);
const opacity = ref(0.2);

const connectionLabel = ref('Starting…');
const connectionState = ref('idle');

const profileOpen = ref(false);
const profileBusy = ref(false);
const profileError = ref('');

const createOpen = ref(false);
const createBusy = ref(false);
const createError = ref('');

const joinOpen = ref(false);
const joinBusy = ref(false);
const joinError = ref('');
const joinInitial = ref('');

const inviteOpen = ref(false);
const inviteBusy = ref(false);
const inviteError = ref('');
const inviteUrl = ref('');
const inviteToken = ref('');

const messageOpen = ref(false);
const messageTitle = ref('Town Red');
const messageBody = ref('');

const selectedMap = computed(() => sharedMaps.value.find((map) => map.id === selectedMapId.value) || null);
const canEdit = computed(() => ['owner', 'editor'].includes(selectedMap.value?.role));
const isOwner = computed(() => selectedMap.value?.role === 'owner');

const identityStatus = computed(() => {
  if (!userId.value) return 'Connecting to Supabase…';
  if (profile.value?.display_name) return `${profile.value.display_name} · temporary identity`;
  return `Anonymous session ${userId.value.slice(0, 8)}…`;
});

const overlayStatus = computed(() => {
  if (!selectedMapId.value) return 'No overlay loaded';
  const count = strokes.value.length;
  return `${selectedMap.value?.name || 'Shared map'} · ${count} ${count === 1 ? 'stroke' : 'strokes'}`;
});

const editStatus = computed(() => {
  if (!selectedMapId.value) return 'Choose a shared map to paint';
  if (!canEdit.value) return 'Viewer access · painting disabled';
  return `${selectedMap.value?.role} access · ${mode.value === 'navigate' ? 'navigation mode' : `${mode.value} brush active`}`;
});

const connectionClass = computed(() => ({
  connected: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  idle: 'border-stone-300 bg-stone-100 text-stone-600',
}[connectionState.value] || 'border-stone-300 bg-stone-100 text-stone-600'));

const modeButtonClass = (buttonMode) => {
  const active = buttonMode === mode.value;
  return active
    ? 'border-stone-800 bg-stone-900 text-white'
    : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40';
};

function setConnection(label, state = 'idle') {
  connectionLabel.value = label;
  connectionState.value = state;
}

function showMessage(title, body) {
  messageTitle.value = title;
  messageBody.value = body;
  messageOpen.value = true;
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Profile onboarding
// ---------------------------------------------------------------------------
// Every auth identity needs a collaborative display name. A new anonymous user
// is held at this dialog until a profile exists; a returning user can instead
// switch identities through ProfileDialog's OTP sign-in path before continuing.
async function ensureDisplayName(id) {
  const existing = await getProfile(id);
  if (existing) {
    profile.value = existing;
    return existing;
  }

  profileError.value = '';
  profileOpen.value = true;
  return new Promise((resolve) => {
    profileResolve = resolve;
  });
}

async function submitProfile(displayName) {
  profileBusy.value = true;
  profileError.value = '';
  try {
    const saved = await saveProfile({ userId: userId.value, displayName });
    profile.value = saved;
    profileOpen.value = false;
    profileResolve?.(saved);
    profileResolve = null;
  } catch (error) {
    profileError.value = errorText(error);
  } finally {
    profileBusy.value = false;
  }
}

// ---------------------------------------------------------------------------
// Map renderer bridge
// ---------------------------------------------------------------------------
function updateRendererEditor() {
  if (!renderer) return;
  if (!canEdit.value && mode.value !== 'navigate') mode.value = 'navigate';
  renderer.setEditor({
    enabled: Boolean(selectedMapId.value && canEdit.value),
    role: selectedMap.value?.role || 'viewer',
    mode: mode.value,
    brushPixels: Number(brushSize.value),
    opacity: Number(opacity.value),
  });
}

watch([selectedMapId, mode, brushSize, opacity, canEdit], updateRendererEditor);

function mergeStroke(stroke) {
  const next = [...strokes.value];
  const index = next.findIndex((item) => item.id === stroke.id);
  if (index >= 0) next[index] = stroke;
  else next.push(stroke);
  next.sort((a, b) => Number(a.sequence ?? Number.MAX_SAFE_INTEGER) - Number(b.sequence ?? Number.MAX_SAFE_INTEGER));
  strokes.value = next;
  renderer?.setStrokes(next);
}

async function saveDrawnStroke(stroke) {
  if (!selectedMapId.value || !userId.value || !canEdit.value) return;

  const id = crypto.randomUUID();
  const optimistic = {
    id,
    sequence: Number.MAX_SAFE_INTEGER,
    map_id: selectedMapId.value,
    created_by: userId.value,
    created_at: new Date().toISOString(),
    mode: stroke.mode,
    brush_metres: stroke.brush_metres,
    opacity: stroke.opacity,
    points: stroke.points,
    _pending: true,
  };

  strokes.value = [...strokes.value, optimistic];
  renderer?.setStrokes(strokes.value);
  setConnection('Saving…');

  try {
    const saved = await createStroke({
      id,
      mapId: selectedMapId.value,
      userId: userId.value,
      mode: stroke.mode,
      brushMetres: stroke.brush_metres,
      opacity: stroke.opacity,
      points: stroke.points,
    });
    mergeStroke(saved);
    setConnection('Live', 'connected');
  } catch (error) {
    strokes.value = strokes.value.filter((item) => item.id !== id);
    renderer?.setStrokes(strokes.value);
    setConnection('Save failed', 'error');
    showMessage('Could not save stroke', errorText(error));
  }
}

async function refreshStrokes({ quiet = false } = {}) {
  if (!selectedMapId.value) return;
  const requestedMapId = selectedMapId.value;
  if (!quiet) setConnection('Loading overlay…');

  const loaded = await loadStrokes(requestedMapId);
  if (selectedMapId.value !== requestedMapId) return;
  strokes.value = loaded;
  renderer?.setStrokes(loaded);
  if (!quiet) setConnection('Live', 'connected');
}

async function selectMap(mapId, { fit = true } = {}) {
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;
  selectedMapId.value = mapId || null;
  strokes.value = [];

  // Wait for Vue to update #shared-map-select. The existing map renderer uses
  // that element as a compatibility hint for its marker subsystem.
  await nextTick();
  renderer?.setStrokes([]);
  updateRendererEditor();

  if (!selectedMapId.value) return;

  await refreshStrokes();
  if (fit && strokes.value.length) renderer?.fitToStrokes();

  unsubscribeRealtime = await subscribeToStrokeInserts(
    selectedMapId.value,
    mergeStroke,
    (status, error) => {
      if (status === 'SUBSCRIBED') setConnection('Live', 'connected');
      else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        console.warn('[Town Red] Realtime status', status, error);
        setConnection('Sync degraded', 'error');
      }
    },
  );
}

async function refreshMapList(preferMapId = selectedMapId.value) {
  sharedMaps.value = await listSharedMaps(userId.value);
  const target = preferMapId && sharedMaps.value.some((map) => map.id === preferMapId)
    ? preferMapId
    : sharedMaps.value[0]?.id || null;
  await selectMap(target);
}

// ---------------------------------------------------------------------------
// Sharing / invite helpers
// ---------------------------------------------------------------------------
function extractInviteToken(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.searchParams.get('invite')?.trim() || text;
  } catch {
    return text;
  }
}

function currentInviteToken() {
  return new URL(location.href).searchParams.get('invite')?.trim() || '';
}

function clearInviteFromUrl() {
  const url = new URL(location.href);
  if (!url.searchParams.has('invite')) return;
  url.searchParams.delete('invite');
  history.replaceState({}, '', url);
}

function makeInviteUrl(token) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('invite', token);
  return url.toString();
}

async function redeemInvite(value, { automatic = false } = {}) {
  const token = extractInviteToken(value);
  if (!token) throw new Error('No invite token was supplied.');
  setConnection('Joining map…');
  const mapId = await joinSharedMap(token);
  await refreshMapList(mapId);
  setConnection('Live', 'connected');
  if (automatic) clearInviteFromUrl();
}

async function createMap(name) {
  if (!name) return;
  createBusy.value = true;
  createError.value = '';
  setConnection('Creating map…');
  try {
    const created = await createSharedMap({ name, userId: userId.value });
    await refreshMapList(created.id);
    createOpen.value = false;
    setConnection('Live', 'connected');
  } catch (error) {
    createError.value = errorText(error);
    setConnection('Create failed', 'error');
  } finally {
    createBusy.value = false;
  }
}

async function joinMap(invite) {
  joinBusy.value = true;
  joinError.value = '';
  try {
    await redeemInvite(invite);
    joinOpen.value = false;
  } catch (error) {
    joinError.value = errorText(error);
    setConnection('Join failed', 'error');
  } finally {
    joinBusy.value = false;
  }
}

function openInvite() {
  inviteError.value = '';
  inviteUrl.value = '';
  inviteToken.value = '';
  inviteOpen.value = true;
}

async function createInvite({ role, maxUses }) {
  if (!selectedMapId.value || !isOwner.value) return;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
    inviteError.value = 'Maximum uses must be a positive whole number, or left blank.';
    return;
  }

  inviteBusy.value = true;
  inviteError.value = '';
  try {
    const token = await createMapInvite({ mapId: selectedMapId.value, role, maxUses });
    if (!token) throw new Error('Supabase created the invite but did not return a token.');
    inviteToken.value = token;
    inviteUrl.value = makeInviteUrl(token);
  } catch (error) {
    inviteError.value = errorText(error);
  } finally {
    inviteBusy.value = false;
  }
}

// ---------------------------------------------------------------------------
// Startup / teardown
// ---------------------------------------------------------------------------
async function bootstrap() {
  try {
    setConnection('Authenticating…');
    const session = await ensureAnonymousSession();
    userId.value = session?.user?.id || null;
    if (!userId.value) throw new Error('Supabase did not return an anonymous user.');

    await ensureDisplayName(userId.value);

    const startupInvite = currentInviteToken();
    if (startupInvite) {
      try {
        await redeemInvite(startupInvite, { automatic: true });
      } catch (error) {
        clearInviteFromUrl();
        showMessage('Could not join map', errorText(error));
      }
    }

    if (!sharedMaps.value.length) {
      setConnection('Loading maps…');
      await refreshMapList();
    }

    if (!sharedMaps.value.length) setConnection('Connected', 'connected');

    refreshTimer = setInterval(() => {
      refreshStrokes({ quiet: true }).catch((error) => {
        console.warn('[Town Red] background overlay refresh failed', error);
      });
    }, 15000);
  } catch (error) {
    console.error('[Town Red] bootstrap failed', error);
    setConnection('Connection error', 'error');
    showMessage('Town Red could not start', errorText(error));
  }
}

onMounted(() => {
  renderer = createTownRedMap(mapContainer.value, {
    onReady: () => setConnection('Map ready', 'connected'),
    onError: (error) => {
      console.error('[Town Red] MapLibre error', error);
      setConnection('Map error', 'error');
    },
    onStrokeComplete: saveDrawnStroke,
  });
  updateRendererEditor();
  bootstrap();
});

onUnmounted(() => {
  unsubscribeRealtime?.();
  if (refreshTimer) clearInterval(refreshTimer);
  renderer?.destroy();
  renderer = null;
});
</script>

<template>
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
              :value="selectedMapId || ''"
              class="max-w-64 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
              :disabled="!sharedMaps.length"
              @change="selectMap($event.target.value)"
            >
              <option v-if="!sharedMaps.length" value="">No shared maps yet</option>
              <option v-for="map in sharedMaps" :key="map.id" :value="map.id">{{ map.name }} · {{ map.role }}</option>
            </select>
          </label>

          <button class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-50" :disabled="!userId" @click="createError = ''; createOpen = true">New map</button>
          <button class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-50" :disabled="!userId" @click="joinInitial = ''; joinError = ''; joinOpen = true">Join</button>
          <button class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-50" :disabled="!isOwner" @click="openInvite">Invite</button>
          <button class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 disabled:opacity-50" :disabled="!strokes.length" @click="renderer?.fitToStrokes()">Fit overlay</button>

          <span class="shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold" :class="connectionClass">{{ connectionLabel }}</span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
        <div class="flex flex-wrap gap-1" role="group" aria-label="Painting mode">
          <button
            v-for="buttonMode in ['navigate', 'red', 'blue', 'erase']"
            :key="buttonMode"
            type="button"
            class="rounded-lg border px-3 py-2 text-sm font-semibold capitalize"
            :class="modeButtonClass(buttonMode)"
            :disabled="buttonMode !== 'navigate' && !canEdit"
            @click="mode = buttonMode"
          >
            {{ buttonMode }}
          </button>
        </div>

        <label class="ml-1 flex items-center gap-2 text-sm font-medium text-stone-700">
          Brush
          <input v-model.number="brushSize" type="range" min="8" max="140" step="2" class="w-28 accent-red-800" />
          <span class="w-10 text-right text-xs text-stone-500">{{ brushSize }}px</span>
        </label>

        <label class="flex items-center gap-2 text-sm font-medium text-stone-700">
          Opacity
          <input v-model.number="opacity" type="range" min="0.05" max="0.6" step="0.05" class="w-24 accent-red-800" />
          <span class="w-10 text-right text-xs text-stone-500">{{ Math.round(opacity * 100) }}%</span>
        </label>

        <span class="text-xs text-stone-500">{{ editStatus }}</span>
      </div>
    </header>

    <section class="min-h-0 p-3 sm:p-4" aria-label="Town Red map">
      <div ref="mapContainer" class="h-[calc(100vh-13rem)] min-h-[32rem] overflow-hidden rounded-2xl border border-stone-200 bg-stone-200 shadow-sm"></div>
    </section>

    <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-white/90 px-5 py-3 text-sm text-stone-600">
      <span>{{ identityStatus }}</span>
      <span class="flex items-center gap-4">
        <a class="hover:text-red-800" href="/privacy/">Privacy</a>
        <span>{{ overlayStatus }}</span>
      </span>
    </footer>
  </main>

  <ProfileDialog :open="profileOpen" :busy="profileBusy" :error="profileError" @submit="submitProfile" />
  <CreateMapDialog :open="createOpen" :busy="createBusy" :error="createError" @close="createOpen = false" @submit="createMap" />
  <JoinMapDialog :open="joinOpen" :busy="joinBusy" :error="joinError" :initial-value="joinInitial" @close="joinOpen = false" @submit="joinMap" />
  <InviteMapDialog
    :open="inviteOpen"
    :map-name="selectedMap?.name || 'this map'"
    :busy="inviteBusy"
    :error="inviteError"
    :invite-url="inviteUrl"
    :invite-token="inviteToken"
    @close="inviteOpen = false"
    @submit="createInvite"
  />
  <MessageDialog :open="messageOpen" :title="messageTitle" :body="messageBody" @close="messageOpen = false" />
</template>
