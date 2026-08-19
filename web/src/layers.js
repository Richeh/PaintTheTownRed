import { loadProfiles } from './data.js';

function storageKey(mapId) {
  return `town-red:hidden-layers:${mapId}`;
}

function loadHidden(mapId) {
  if (!mapId) return new Set();

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(mapId)) || '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveHidden(mapId, hidden) {
  if (!mapId) return;
  window.localStorage.setItem(storageKey(mapId), JSON.stringify([...hidden]));
}

function fallbackName(userId, currentUserId) {
  if (userId === currentUserId) return 'You';
  return `Collaborator ${String(userId || '').slice(0, 6)}`;
}

export function createLayerController({ container, currentUserId, onVisibilityChange } = {}) {
  container.classList.add('relative');

  const panel = document.createElement('div');
  panel.className = 'absolute left-3 top-3 z-30 hidden w-64 max-w-[calc(100%-1.5rem)] rounded-xl border border-stone-200 bg-white/95 shadow-lg backdrop-blur';
  panel.innerHTML = `
    <div class="flex items-center justify-between gap-2 border-b border-stone-200 px-3 py-2">
      <div>
        <div class="text-sm font-semibold text-stone-900">Layers</div>
        <div class="text-xs text-stone-500">Show or hide collaborators</div>
      </div>
      <button type="button" class="rounded-md px-2 py-1 text-xs font-semibold text-stone-600 hover:bg-stone-100">Hide all</button>
    </div>
    <div class="max-h-64 overflow-auto p-2" data-layer-list></div>
  `;
  container.append(panel);

  const list = panel.querySelector('[data-layer-list]');
  const toggleAllButton = panel.querySelector('button');

  let mapId = null;
  let contributors = [];
  let hidden = new Set();
  let names = new Map();
  let updateGeneration = 0;

  function labelFor(userId) {
    const profileName = names.get(userId);
    if (userId === currentUserId) {
      return profileName ? `${profileName} (You)` : 'You';
    }
    return profileName || fallbackName(userId, currentUserId);
  }

  function render() {
    panel.classList.toggle('hidden', !mapId || contributors.length === 0);
    if (!mapId || contributors.length === 0) return;

    list.replaceChildren();

    for (const userId of contributors) {
      const row = document.createElement('label');
      row.className = 'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-stone-700 hover:bg-stone-50';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !hidden.has(userId);
      checkbox.className = 'h-4 w-4 accent-red-800';
      checkbox.dataset.userId = userId;

      const text = document.createElement('span');
      text.className = 'min-w-0 flex-1 truncate';
      text.textContent = labelFor(userId);

      row.append(checkbox, text);
      list.append(row);
    }

    toggleAllButton.textContent = hidden.size >= contributors.length ? 'Show all' : 'Hide all';
  }

  function notify() {
    saveHidden(mapId, hidden);
    render();
    onVisibilityChange?.();
  }

  list.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[type="checkbox"][data-user-id]');
    if (!checkbox) return;

    const userId = checkbox.dataset.userId;
    if (checkbox.checked) hidden.delete(userId);
    else hidden.add(userId);
    notify();
  });

  toggleAllButton.addEventListener('click', () => {
    if (hidden.size >= contributors.length) hidden.clear();
    else hidden = new Set(contributors);
    notify();
  });

  async function update(nextMapId, strokes) {
    const generation = ++updateGeneration;
    const mapChanged = nextMapId !== mapId;
    mapId = nextMapId || null;

    if (mapChanged) {
      hidden = loadHidden(mapId);
      names = new Map();
    }

    contributors = [...new Set((strokes || []).map((stroke) => stroke.created_by).filter(Boolean))];
    render();

    if (!contributors.length) return;

    try {
      const profiles = await loadProfiles(contributors);
      if (generation !== updateGeneration || nextMapId !== mapId) return;
      names = new Map((profiles || []).map((profile) => [profile.user_id, profile.display_name]));
      render();
    } catch (error) {
      console.warn('[Town Red] could not load collaborator names', error);
    }
  }

  function visibleStrokes(strokes) {
    return (strokes || []).filter((stroke) => !hidden.has(stroke.created_by));
  }

  function destroy() {
    updateGeneration += 1;
    panel.remove();
  }

  return {
    update,
    visibleStrokes,
    destroy,
  };
}
