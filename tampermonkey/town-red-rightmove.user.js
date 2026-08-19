// ==UserScript==
// @name         Town Red - Rightmove
// @namespace    https://github.com/Richeh/PaintTheTownRed
// @version      0.3.1
// @description  Paint and share geographically anchored preference areas on Rightmove maps.
// @match        https://www.rightmove.co.uk/property-for-sale/map.html*
// @match        https://www.rightmove.co.uk/properties/map.html*
// @require      https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const SUPABASE_URL = 'https://oikkiayjonjouernvjhw.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_LDxOd-ZDNBGVQBl9JzB1lQ_39TYzOwk';
  const PAGE = unsafeWindow;
  const SETTINGS_KEY = 'town-red-rightmove-v03-settings';
  const AUTH_PREFIX = 'town-red-rightmove-v03-sb-auth:';
  const CACHE_PREFIX = 'town-red-rightmove-v03-cache:';
  const DEFAULTS = { mode: 'navigate', brushSize: 42, opacity: 0.20 };

  // Capture the Google Map instance Rightmove creates.
  PAGE.__townRedMaps ||= [];

  function rememberMap(map) {
    if (map && !PAGE.__townRedMaps.includes(map)) {
      PAGE.__townRedMaps.push(map);
      console.info('[Town Red] captured Google Map', map);
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

    try {
      holder[key] = WrappedMap;
      console.info('[Town Red] hooked Google Map constructor');
      return true;
    } catch {
      return false;
    }
  }

  let importLibraryHooked = false;
  const captureTimer = setInterval(() => {
    const maps = PAGE.google?.maps;
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
  }, 10);

  setTimeout(() => clearInterval(captureTimer), 30000);

  function startWhenReady() {
    if (document.documentElement && document.body && document.head) start();
    else requestAnimationFrame(startWhenReady);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWhenReady, { once: true });
  } else {
    startWhenReady();
  }

  function start() {
    if (document.querySelector('#town-red-toolbar')) return;

    const sbLibrary = typeof supabase !== 'undefined' ? supabase : null;
    if (!sbLibrary?.createClient) {
      console.error('[Town Red] Supabase JS library did not load');
      return;
    }

    const authStorage = {
      getItem: key => GM_getValue(AUTH_PREFIX + key, null),
      setItem: (key, value) => GM_setValue(AUTH_PREFIX + key, value),
      removeItem: key => GM_deleteValue(AUTH_PREFIX + key)
    };

    const sb = sbLibrary.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: authStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });

    let settings = { ...DEFAULTS, ...(GM_getValue(SETTINGS_KEY, {}) || {}) };
    let userId = null;
    let availableMaps = [];
    let selectedMapId = null;
    let selectedRole = null;
    let strokes = [];
    let currentStroke = null;
    let realtimeChannel = null;
    let map = null;
    let overlay = null;
    let projection = null;
    let mapRect = null;
    let mapListeners = [];
    let spaceHeld = false;

    const canvas = document.createElement('canvas');
    canvas.id = 'town-red-canvas';
    Object.assign(canvas.style, {
      position: 'fixed', left: '0', top: '0', width: '0', height: '0',
      zIndex: '2147483000', pointerEvents: 'none', touchAction: 'none', cursor: 'crosshair'
    });
    document.documentElement.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const toolbar = document.createElement('div');
    toolbar.id = 'town-red-toolbar';
    toolbar.innerHTML = `
      <div class="tr-title"><strong>Town Red</strong><span id="tr-geo">Geo: waiting…</span></div>
      <div class="tr-sync"><span id="tr-sync">Sync: starting…</span><span id="tr-user"></span></div>
      <label class="tr-map-label">Shared map
        <select id="tr-map"><option value="">— none —</option></select>
      </label>
      <div class="tr-three">
        <button id="tr-new" type="button">New map</button>
        <button id="tr-join" type="button">Join</button>
        <button id="tr-invite" type="button">Invite</button>
      </div>
      <div class="tr-modes">
        <button type="button" data-mode="navigate">Navigate</button>
        <button type="button" data-mode="red">Red</button>
        <button type="button" data-mode="blue">Blue</button>
        <button type="button" data-mode="erase">Erase</button>
      </div>
      <label class="tr-slider">Brush
        <input id="tr-brush" type="range" min="8" max="140" step="2"><span id="tr-brush-value"></span>
      </label>
      <label class="tr-slider">Opacity
        <input id="tr-opacity" type="range" min="0.05" max="0.60" step="0.05"><span id="tr-opacity-value"></span>
      </label>
      <div class="tr-two">
        <button id="tr-undo" type="button">Undo mine</button>
        <button id="tr-refresh" type="button">Refresh</button>
      </div>
      <div class="tr-info"><span id="tr-count">0 strokes</span><br>Hold <kbd>Space</kbd> to navigate temporarily.<br>Paint is shared geographically.</div>
    `;

    Object.assign(toolbar.style, {
      position: 'fixed', zIndex: '2147483646', top: '90px', right: '18px', width: '245px', padding: '12px',
      background: 'rgba(255,255,255,.97)', color: '#222', border: '1px solid rgba(0,0,0,.18)',
      borderRadius: '10px', boxShadow: '0 4px 18px rgba(0,0,0,.22)',
      font: '13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', userSelect: 'none'
    });

    const style = document.createElement('style');
    style.textContent = `
      #town-red-toolbar .tr-title,#town-red-toolbar .tr-sync{display:flex;justify-content:space-between;gap:8px;align-items:center}
      #town-red-toolbar .tr-title{margin-bottom:3px}
      #town-red-toolbar .tr-sync{margin-bottom:10px;font-size:11px;color:#666}
      #town-red-toolbar #tr-geo{font-size:11px;color:#666}
      #town-red-toolbar button,#town-red-toolbar select{border:1px solid #bbb;background:#f7f7f7;color:#222;border-radius:6px;padding:6px 7px}
      #town-red-toolbar button{cursor:pointer} #town-red-toolbar button:hover{background:#eee}
      #town-red-toolbar button:disabled{cursor:not-allowed;opacity:.45}
      #town-red-toolbar button[data-active="true"]{outline:2px solid #333;outline-offset:1px;font-weight:700}
      #town-red-toolbar button[data-mode="red"][data-active="true"]{background:rgba(220,30,30,.16)}
      #town-red-toolbar button[data-mode="blue"][data-active="true"]{background:rgba(30,90,220,.16)}
      #town-red-toolbar .tr-map-label{display:block;margin-bottom:7px;font-size:11px;color:#555}
      #town-red-toolbar .tr-map-label select{display:block;width:100%;margin-top:3px;box-sizing:border-box}
      #town-red-toolbar .tr-three{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-bottom:10px}
      #town-red-toolbar .tr-modes{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}
      #town-red-toolbar .tr-slider{display:grid;grid-template-columns:52px 1fr 42px;gap:6px;align-items:center;margin:7px 0}
      #town-red-toolbar input[type="range"]{width:100%}
      #town-red-toolbar .tr-two{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
      #town-red-toolbar .tr-info{margin-top:9px;font-size:11px;color:#666}
      #town-red-toolbar kbd{border:1px solid #aaa;border-bottom-width:2px;border-radius:4px;padding:0 4px;background:#fafafa}
    `;
    document.head.appendChild(style);
    document.documentElement.appendChild(toolbar);

    const $ = selector => toolbar.querySelector(selector);
    const geoStatus = $('#tr-geo');
    const syncStatus = $('#tr-sync');
    const userStatus = $('#tr-user');
    const mapSelect = $('#tr-map');
    const brushEl = $('#tr-brush');
    const brushValue = $('#tr-brush-value');
    const opacityEl = $('#tr-opacity');
    const opacityValue = $('#tr-opacity-value');
    const countEl = $('#tr-count');
    brushEl.value = settings.brushSize;
    opacityEl.value = settings.opacity;

    function setSync(text, bad = false) {
      syncStatus.textContent = `Sync: ${text}`;
      syncStatus.style.color = bad ? '#a00000' : '#666';
    }

    function saveSettings() { GM_setValue(SETTINGS_KEY, settings); }
    function cacheKey(mapId) { return CACHE_PREFIX + mapId; }
    function cacheStrokes() {
      if (selectedMapId) GM_setValue(cacheKey(selectedMapId), strokes);
      updateCount();
    }
    function updateCount() { countEl.textContent = `${strokes.length} ${strokes.length === 1 ? 'stroke' : 'strokes'}`; }
    function canEdit() { return selectedRole === 'owner' || selectedRole === 'editor'; }

    function updateControls() {
      toolbar.querySelectorAll('[data-mode]').forEach(button => {
        button.dataset.active = String(button.dataset.mode === settings.mode);
      });
      brushValue.textContent = `${settings.brushSize}px`;
      opacityValue.textContent = `${Math.round(settings.opacity * 100)}%`;

      const painting = !!selectedMapId && canEdit() && !!projection && settings.mode !== 'navigate' && !spaceHeld;
      canvas.style.pointerEvents = painting ? 'auto' : 'none';
      canvas.style.cursor = settings.mode === 'erase' ? 'cell' : 'crosshair';

      $('#tr-invite').disabled = !selectedMapId || selectedRole !== 'owner';
      $('#tr-undo').disabled = !selectedMapId || !canEdit();
      $('#tr-refresh').disabled = !selectedMapId;
      toolbar.querySelectorAll('[data-mode="red"],[data-mode="blue"],[data-mode="erase"]').forEach(button => {
        button.disabled = !selectedMapId || !canEdit();
      });

      if (userId) {
        const roleText = selectedRole ? ` · ${selectedRole}` : '';
        userStatus.textContent = `anon ${userId.slice(0, 6)}${roleText}`;
      }
    }

    async function ensureAuth() {
      setSync('authenticating…');
      const sessionResult = await sb.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;

      let session = sessionResult.data.session;
      if (!session) {
        const signed = await sb.auth.signInAnonymously();
        if (signed.error) throw signed.error;
        session = signed.data.session;
      }

      userId = session?.user?.id || null;
      if (!userId) throw new Error('Supabase returned no authenticated user ID.');

      if (session?.access_token) await sb.realtime.setAuth(session.access_token);
      updateControls();
      setSync('connected');
    }

    sb.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        sb.realtime.setAuth(session.access_token).catch(error => {
          console.warn('[Town Red] could not refresh Realtime auth', error);
        });
      }
    });

    async function refreshMaps(preferId = selectedMapId) {
      setSync('loading maps…');
      const result = await sb.from('maps').select('id,name,owner_id,created_at').order('created_at', { ascending: true });
      if (result.error) throw result.error;

      availableMaps = result.data || [];
      mapSelect.innerHTML = '<option value="">— none —</option>';
      for (const sharedMap of availableMaps) {
        const option = document.createElement('option');
        option.value = sharedMap.id;
        option.textContent = `${sharedMap.name}${sharedMap.owner_id === userId ? ' ★' : ''}`;
        mapSelect.appendChild(option);
      }

      const target = preferId && availableMaps.some(item => item.id === preferId) ? preferId : (availableMaps[0]?.id || '');
      mapSelect.value = target;
      await selectSharedMap(target);
      setSync('connected');
    }

    async function determineRole(mapId) {
      selectedRole = null;
      if (!mapId) { updateControls(); return; }
      const mapRecord = availableMaps.find(item => item.id === mapId);
      if (mapRecord?.owner_id === userId) {
        selectedRole = 'owner';
        updateControls();
        return;
      }

      const result = await sb.from('map_members').select('role').eq('map_id', mapId).eq('user_id', userId).maybeSingle();
      if (result.error) throw result.error;
      selectedRole = result.data?.role || 'viewer';
      updateControls();
    }

    async function createSharedMap() {
      const name = window.prompt('Name for the shared overlay:', 'House Search');
      if (!name?.trim()) return;
      setSync('creating map…');
      const result = await sb.from('maps').insert({ name: name.trim(), owner_id: userId }).select('id,name,owner_id,created_at').single();
      if (result.error) throw result.error;
      await refreshMaps(result.data.id);
    }

    async function joinSharedMap() {
      const token = window.prompt('Paste the invite token:');
      if (!token?.trim()) return;
      setSync('joining…');
      const result = await sb.rpc('join_map_with_invite', { p_token: token.trim() });
      if (result.error) throw result.error;
      const joinedId = result.data?.[0]?.map_id;
      await refreshMaps(joinedId);
    }

    async function createInvite() {
      if (!selectedMapId || selectedRole !== 'owner') return;
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

      setSync('creating invite…');
      const result = await sb.rpc('create_map_invite', {
        p_map_id: selectedMapId,
        p_role: role,
        p_expires_at: null,
        p_max_uses: maxUses
      });
      if (result.error) throw result.error;

      // Supports both the original deployed RPC (table result) and the repo migration (text result).
      const token = typeof result.data === 'string' ? result.data : result.data?.[0]?.invite_token;
      if (!token) throw new Error('Supabase returned no invite token.');
      setSync('connected');
      window.prompt(`Copy this ${role} invite token and send it to your friend.\n\nIt is shown only now:`, token);
    }

    async function selectSharedMap(mapId) {
      unsubscribeRealtime();
      selectedMapId = mapId || null;
      selectedRole = null;
      strokes = [];
      currentStroke = null;

      if (!selectedMapId) {
        updateCount(); redraw(); updateControls(); return;
      }

      await determineRole(selectedMapId);
      strokes = GM_getValue(cacheKey(selectedMapId), []) || [];
      sortStrokes(); updateCount(); redraw();
      await loadRemoteStrokes();
      await subscribeRealtime();
      updateControls();
    }

    async function loadRemoteStrokes() {
      if (!selectedMapId) return;
      setSync('loading strokes…');
      const mapIdAtStart = selectedMapId;
      const result = await sb.from('strokes')
        .select('id,sequence,map_id,created_by,mode,brush_metres,opacity,points,created_at')
        .eq('map_id', mapIdAtStart).order('sequence', { ascending: true });
      if (result.error) throw result.error;
      if (selectedMapId !== mapIdAtStart) return;
      strokes = result.data || [];
      cacheStrokes(); redraw();
      setSync(realtimeChannel ? 'live' : 'connected');
    }

    function sortStrokes() {
      strokes.sort((a, b) => {
        const aa = Number.isFinite(Number(a.sequence)) ? Number(a.sequence) : Number.MAX_SAFE_INTEGER;
        const bb = Number.isFinite(Number(b.sequence)) ? Number(b.sequence) : Number.MAX_SAFE_INTEGER;
        return aa - bb;
      });
    }

    function mergeStroke(row) {
      if (!row || row.map_id !== selectedMapId) return;
      const index = strokes.findIndex(item => item.id === row.id);
      if (index >= 0) strokes[index] = row; else strokes.push(row);
      sortStrokes(); cacheStrokes(); redraw();
    }

    async function subscribeRealtime() {
      if (!selectedMapId) return;
      unsubscribeRealtime();

      const sessionResult = await sb.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      const session = sessionResult.data.session;
      if (session?.access_token) await sb.realtime.setAuth(session.access_token);

      const subscribedMapId = selectedMapId;
      realtimeChannel = sb.channel(`town-red-strokes-${subscribedMapId}-${Date.now()}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'strokes', filter: `map_id=eq.${subscribedMapId}`
        }, payload => {
          console.info('[Town Red] realtime INSERT', payload);
          if (selectedMapId === subscribedMapId) mergeStroke(payload.new);
        })
        .subscribe((status, error) => {
          console.info('[Town Red] realtime status:', status, error || '');
          if (status === 'SUBSCRIBED') setSync('live');
          if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
            console.warn('[Town Red] realtime problem:', status, error);
            setSync(`realtime ${status.toLowerCase()}`, true);
          }
        });
    }

    function unsubscribeRealtime() {
      if (!realtimeChannel) return;
      try { sb.removeChannel(realtimeChannel); } catch {}
      realtimeChannel = null;
    }

    async function uploadStroke(stroke) {
      if (!selectedMapId || !userId || !canEdit()) return;
      const id = crypto.randomUUID();
      const row = {
        id, map_id: selectedMapId, created_by: userId, mode: stroke.mode,
        brush_metres: stroke.brushMetres, opacity: stroke.opacity, points: stroke.points
      };
      const optimistic = { ...row, sequence: Number.MAX_SAFE_INTEGER, created_at: new Date().toISOString(), _pending: true };
      strokes.push(optimistic); cacheStrokes(); redraw(); setSync('saving…');

      const result = await sb.from('strokes').insert(row)
        .select('id,sequence,map_id,created_by,mode,brush_metres,opacity,points,created_at').single();
      if (result.error) {
        strokes = strokes.filter(item => item.id !== id);
        cacheStrokes(); redraw(); throw result.error;
      }
      mergeStroke(result.data); setSync('live');
    }

    async function undoMine() {
      if (!selectedMapId || !userId || !canEdit()) return;
      const mine = strokes.filter(item => item.created_by === userId && !item._pending)
        .sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0));
      if (!mine.length) {
        window.alert('There are no saved strokes from this browser identity to undo.');
        return;
      }
      const victim = mine[0];
      setSync('undoing…');
      const result = await sb.from('strokes').delete().eq('id', victim.id);
      if (result.error) throw result.error;
      strokes = strokes.filter(item => item.id !== victim.id);
      cacheStrokes(); redraw(); setSync('live');
    }

    function reportError(error) {
      console.error('[Town Red]', error);
      const message = error?.message || String(error);
      setSync(message.slice(0, 40), true);
      window.alert(`Town Red:\n${message}`);
    }

    function mapUsable(candidate) {
      if (!candidate || typeof candidate.getDiv !== 'function') return false;
      try {
        const div = candidate.getDiv();
        const rect = div?.getBoundingClientRect();
        return !!div && document.contains(div) && rect.width > 500 && rect.height > 300;
      } catch { return false; }
    }

    function findMap() {
      const maps = PAGE.__townRedMaps || [];
      for (let i = maps.length - 1; i >= 0; i--) if (mapUsable(maps[i])) return maps[i];
      return null;
    }

    function clearMapListeners() {
      const gm = PAGE.google?.maps;
      if (!gm) return;
      for (const listener of mapListeners) {
        try { gm.event.removeListener(listener); } catch {}
      }
      mapListeners = [];
    }

    function connectMap(candidate) {
      if (!candidate || candidate === map) return;
      clearMapListeners();
      map = candidate;
      projection = null;
      try { overlay?.setMap(null); } catch {}
      const gm = PAGE.google?.maps;
      if (!gm?.OverlayView) return;

      overlay = new gm.OverlayView();
      overlay.onAdd = () => {};
      overlay.onRemove = () => { projection = null; };
      overlay.draw = () => {
        try { projection = overlay.getProjection(); } catch { projection = null; }
        updateCanvasBounds(); redraw(); updateGeoStatus();
      };
      overlay.setMap(map);

      for (const eventName of ['bounds_changed', 'center_changed', 'zoom_changed', 'idle']) {
        mapListeners.push(gm.event.addListener(map, eventName, () => {
          updateCanvasBounds(); redraw(); updateGeoStatus();
        }));
      }
      updateCanvasBounds();
    }

    function updateGeoStatus() {
      if (!map) geoStatus.textContent = 'Geo: map not captured';
      else if (!projection) geoStatus.textContent = 'Geo: connecting…';
      else {
        let zoom = '?';
        try { zoom = map.getZoom(); } catch {}
        geoStatus.textContent = `Geo: connected · z${zoom}`;
      }
      updateControls();
    }

    function lookForMap() {
      const found = findMap();
      if (found) connectMap(found);
      updateGeoStatus();
    }

    function updateCanvasBounds() {
      if (!map) return;
      let rect;
      try { rect = map.getDiv().getBoundingClientRect(); } catch { return; }
      if (rect.width < 250 || rect.height < 180) { mapRect = null; return; }

      mapRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      canvas.style.left = `${rect.left}px`;
      canvas.style.top = `${rect.top}px`;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width; canvas.height = height;
      }
      updateControls();
    }

    function screenToLatLng(clientX, clientY) {
      if (!projection || !mapRect) return null;
      const gm = PAGE.google?.maps;
      try {
        const ll = projection.fromContainerPixelToLatLng(new gm.Point(clientX - mapRect.left, clientY - mapRect.top));
        return ll ? { lat: ll.lat(), lng: ll.lng() } : null;
      } catch { return null; }
    }

    function latLngToCanvas(point) {
      if (!projection || !point) return null;
      const gm = PAGE.google?.maps;
      try {
        const pixel = projection.fromLatLngToContainerPixel(new gm.LatLng(point.lat, point.lng));
        if (!pixel) return null;
        const dpr = window.devicePixelRatio || 1;
        return { x: pixel.x * dpr, y: pixel.y * dpr };
      } catch { return null; }
    }

    function distanceMetres(a, b) {
      const gm = PAGE.google?.maps;
      try {
        if (gm?.geometry?.spherical?.computeDistanceBetween) {
          return gm.geometry.spherical.computeDistanceBetween(new gm.LatLng(a.lat, a.lng), new gm.LatLng(b.lat, b.lng));
        }
      } catch {}

      const R = 6371008.8;
      const radians = degrees => degrees * Math.PI / 180;
      const lat1 = radians(a.lat), lat2 = radians(b.lat);
      const dLat = radians(b.lat - a.lat), dLng = radians(b.lng - a.lng);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    }

    function brushPixelsToMetres(clientX, clientY, pixels) {
      const a = screenToLatLng(clientX, clientY);
      const b = screenToLatLng(clientX + pixels, clientY);
      return a && b ? distanceMetres(a, b) : null;
    }

    function metresToPixels(point, metres) {
      const gm = PAGE.google?.maps;
      if (!gm || !projection) return 1;
      const origin = new gm.LatLng(point.lat, point.lng);
      let east = null;
      try { east = gm.geometry?.spherical?.computeOffset?.(origin, metres, 90); } catch {}
      if (!east) {
        const cosine = Math.max(0.01, Math.cos(point.lat * Math.PI / 180));
        east = new gm.LatLng(point.lat, point.lng + metres / (111320 * cosine));
      }
      try {
        const p1 = projection.fromLatLngToContainerPixel(origin);
        const p2 = projection.fromLatLngToContainerPixel(east);
        return Math.max(1, Math.abs(p2.x - p1.x));
      } catch { return 1; }
    }

    function normalizeStroke(row) {
      return { ...row, brushMetres: row.brushMetres ?? row.brush_metres, points: Array.isArray(row.points) ? row.points : [] };
    }

    function drawStroke(raw) {
      const stroke = normalizeStroke(raw);
      if (!stroke.points.length || !projection) return;
      const dpr = window.devicePixelRatio || 1;
      const width = metresToPixels(stroke.points[0], stroke.brushMetres) * dpr;
      const pixels = stroke.points.map(latLngToCanvas).filter(Boolean);
      if (!pixels.length) return;

      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = width;
      if (stroke.mode === 'erase') {
        ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(0,0,0,1)'; ctx.fillStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = stroke.opacity ?? settings.opacity;
        const colour = stroke.mode === 'red' ? 'rgb(220,35,45)' : 'rgb(35,95,220)';
        ctx.strokeStyle = colour; ctx.fillStyle = colour;
      }

      if (pixels.length === 1) {
        ctx.beginPath(); ctx.arc(pixels[0].x, pixels[0].y, width / 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(pixels[0].x, pixels[0].y);
        for (let i = 1; i < pixels.length; i++) ctx.lineTo(pixels[i].x, pixels[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    function redraw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!projection) return;
      for (const stroke of strokes) drawStroke(stroke);
      if (currentStroke) drawStroke(currentStroke);
    }

    canvas.addEventListener('pointerdown', event => {
      if (!selectedMapId || !canEdit() || settings.mode === 'navigate' || spaceHeld || !projection) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      const point = screenToLatLng(event.clientX, event.clientY);
      const brushMetres = brushPixelsToMetres(event.clientX, event.clientY, settings.brushSize);
      if (!point || !brushMetres) return;
      currentStroke = { mode: settings.mode, brushMetres, opacity: settings.opacity, points: [point] };
      redraw();
    });

    canvas.addEventListener('pointermove', event => {
      if (!currentStroke || !projection) return;
      event.preventDefault();
      const point = screenToLatLng(event.clientX, event.clientY);
      if (!point) return;
      const previous = currentStroke.points[currentStroke.points.length - 1];
      const minimumSpacing = Math.max(0.5, currentStroke.brushMetres / 15);
      if (distanceMetres(previous, point) > minimumSpacing) {
        currentStroke.points.push(point); redraw();
      }
    });

    async function finishStroke(event) {
      if (!currentStroke) return;
      if (event?.pointerId != null && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const finished = currentStroke;
      currentStroke = null;
      redraw();
      try { await uploadStroke(finished); } catch (error) { reportError(error); }
    }

    canvas.addEventListener('pointerup', finishStroke);
    canvas.addEventListener('pointercancel', finishStroke);

    toolbar.querySelectorAll('[data-mode]').forEach(button => {
      button.addEventListener('click', () => {
        settings.mode = button.dataset.mode; saveSettings(); updateControls();
      });
    });
    brushEl.addEventListener('input', () => {
      settings.brushSize = Number(brushEl.value); saveSettings(); updateControls();
    });
    opacityEl.addEventListener('input', () => {
      settings.opacity = Number(opacityEl.value); saveSettings(); updateControls();
    });
    mapSelect.addEventListener('change', () => selectSharedMap(mapSelect.value).catch(reportError));
    $('#tr-new').addEventListener('click', () => createSharedMap().catch(reportError));
    $('#tr-join').addEventListener('click', () => joinSharedMap().catch(reportError));
    $('#tr-invite').addEventListener('click', () => createInvite().catch(reportError));
    $('#tr-undo').addEventListener('click', () => undoMine().catch(reportError));
    $('#tr-refresh').addEventListener('click', () => loadRemoteStrokes().catch(reportError));

    document.addEventListener('keydown', event => {
      const inputActive = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (event.code === 'Space' && !event.repeat && !inputActive) {
        spaceHeld = true; updateControls();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !inputActive) {
        event.preventDefault(); undoMine().catch(reportError);
      }
    });
    document.addEventListener('keyup', event => {
      if (event.code === 'Space') { spaceHeld = false; updateControls(); }
    });
    window.addEventListener('blur', () => { spaceHeld = false; updateControls(); });
    window.addEventListener('resize', () => { updateCanvasBounds(); redraw(); });
    window.addEventListener('scroll', () => { updateCanvasBounds(); redraw(); }, true);

    // Reconcile deletes / missed events periodically. Inserts arrive through Realtime.
    setInterval(async () => {
      if (!selectedMapId) return;
      try {
        await loadRemoteStrokes();
        console.info('[Town Red] periodic sync complete:', strokes.length, 'strokes');
      } catch (error) {
        console.warn('[Town Red] periodic refresh failed', error);
      }
    }, 10000);

    updateCount(); updateControls();
    setInterval(lookForMap, 250);

    (async () => {
      try {
        await ensureAuth();
        await refreshMaps();
      } catch (error) {
        reportError(error);
      }
    })();

    console.info('[Town Red] Rightmove shared geographic client v0.3.1 loaded');
  }
})();
