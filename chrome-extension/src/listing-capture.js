    // -----------------------------------------------------------------------
    // Extension identity guard
    // -----------------------------------------------------------------------
    // This file is injected into the shared Rightmove userscript by build.mjs.
    // It runs inside the same closure, so it intentionally refers to variables
    // such as sb, selectedMapId, projection and userId defined by that script.
    //
    // Town Red's extension identity is anonymous Supabase Auth. Map membership
    // is tied to that auth.uid(), so silently creating a replacement anonymous
    // user after a session failure would make joined maps appear to disappear.
    const ESTABLISHED_USER_KEY = 'town-red-established-user-id';
    const originalAnonymousSignIn = sb.auth.signInAnonymously.bind(sb.auth);

    // Keep a durable record of the Town Red identity used by this browser. If
    // Supabase session restoration ever fails, do not silently mint a new
    // anonymous user: that would make all existing map memberships appear to
    // vanish even though they still belong to the previous auth user.
    sb.auth.onAuthStateChange((_event, session) => {
      const sessionUserId = session?.user?.id;
      if (!sessionUserId) return;
      const establishedUserId = GM_getValue(ESTABLISHED_USER_KEY, null);
      if (!establishedUserId) GM_setValue(ESTABLISHED_USER_KEY, sessionUserId);
    });

    // Wrap anonymous sign-in rather than changing the shared userscript's auth
    // API. The first-ever sign-in is allowed and recorded; subsequent attempts
    // are blocked if the persisted session has vanished unexpectedly.
    sb.auth.signInAnonymously = async (...args) => {
      const establishedUserId = GM_getValue(ESTABLISHED_USER_KEY, null);
      if (establishedUserId) {
        throw new Error(
          `Town Red could not restore browser identity ${establishedUserId.slice(0, 8)}. ` +
          'It will not create a replacement identity because that would lose access to joined maps. Reload once; if this persists, clear Town Red extension storage and rejoin deliberately.'
        );
      }
      const result = await originalAnonymousSignIn(...args);
      const newUserId = result?.data?.user?.id || result?.data?.session?.user?.id;
      if (newUserId) GM_setValue(ESTABLISHED_USER_KEY, newUserId);
      return result;
    };

    // -----------------------------------------------------------------------
    // Rightmove property capture state
    // -----------------------------------------------------------------------
    // A property click opens Rightmove's popup asynchronously. We keep the
    // geographic point from the original click (the approach that proved most
    // reliable) while waiting for the popup DOM to appear so we can add our
    // Add/Remove button to the correct listing.
    let activeRightmoveProperty = null;

    // Each click gets a generation number. Old delayed callbacks are ignored,
    // preventing a popup from an earlier click/pan from overwriting the current
    // property's coordinates.
    let propertyCaptureGeneration = 0;
    let propertyCaptureTimers = [];

    // Reduce any Rightmove property link to a stable canonical URL. Query-string
    // tracking parameters are deliberately discarded so source_url can be used
    // as a unique property identity in Town Red.
    function canonicalPropertyUrl(href) {
      if (!href) return null;
      try {
        const url = new URL(href, location.origin);
        const match = url.pathname.match(/^\/properties\/(\d+)/);
        if (!match || url.hostname !== location.hostname) return null;
        return `${location.origin}/properties/${match[1]}`;
      } catch { return null; }
    }

    // Rightmove uses several accessibility/link phrases around addresses. Strip
    // those prefixes so Town Red labels show the useful address rather than UI
    // copy such as "View property details for …".
    function cleanPropertyLabel(value) {
      let text = String(value || '').replace(/\s+/g, ' ').trim();
      text = text
        .replace(/^view property details(?:\s+for)?\s*[:\-–—]?\s*/i, '')
        .replace(/^property details(?:\s+for)?\s*[:\-–—]?\s*/i, '')
        .replace(/^view details(?:\s+for)?\s*[:\-–—]?\s*/i, '')
        .trim();
      return text;
    }

    // Prefer address-looking text inside the popup, with progressively broader
    // fallbacks. A property id is always available from the canonical URL if
    // Rightmove changes its popup markup and no readable address is found.
    function markerLabelFromLink(link, sourceUrl) {
      const popup = findPropertyPopup(link);
      const candidates = [
        popup?.querySelector?.('[data-testid*="address" i]')?.textContent,
        popup?.querySelector?.('h1,h2,h3')?.textContent,
        link?.getAttribute?.('aria-label'),
        link?.textContent
      ];
      const raw = candidates.map(cleanPropertyLabel).find(value => value && !/^view property details$/i.test(value));
      if (raw) return raw.slice(0, 160);
      const id = sourceUrl?.match(/\/properties\/(\d+)/)?.[1];
      return id ? `Rightmove property ${id}` : 'Rightmove property';
    }

    // Owners can remove any property marker. Editors can remove only markers
    // they originally created; RLS remains the server-side enforcement layer.
    function canRemoveMarker(row) {
      return selectedRole === 'owner' || row?.created_by === userId;
    }

    // -----------------------------------------------------------------------
    // Town Red markers drawn over Google Maps
    // -----------------------------------------------------------------------
    // Stored coordinates are the source of truth. Google Maps OverlayView turns
    // them into container pixels each time the map pans/zooms, then we add the
    // map element's page offset because our marker layer uses position:fixed.
    function renderTownRedMarkers() {
      markerLayer.replaceChildren();
      if (!projection || !mapRect || !selectedMapId) return;
      const gm = PAGE.google?.maps;
      if (!gm) return;

      for (const row of markers) {
        try {
          const pixel = projection.fromLatLngToContainerPixel(new gm.LatLng(Number(row.latitude), Number(row.longitude)));
          if (!pixel) continue;
          if (pixel.x < -40 || pixel.y < -40 || pixel.x > mapRect.width + 40 || pixel.y > mapRect.height + 40) continue;

          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = '⌂';
          button.title = row.source_url ? `${row.label} — open Rightmove listing` : row.label;
          Object.assign(button.style, {
            position: 'fixed',
            left: `${mapRect.left + pixel.x}px`,
            top: `${mapRect.top + pixel.y}px`,
            transform: 'translate(-50%, -100%)',
            width: '30px', height: '30px', borderRadius: '50% 50% 50% 8px',
            border: '2px solid white', background: '#9c1616', color: 'white',
            boxShadow: '0 2px 6px rgba(0,0,0,.35)', cursor: row.source_url ? 'pointer' : 'default',
            pointerEvents: 'auto', font: 'bold 18px/24px system-ui', zIndex: '2147483101'
          });
          button.dataset.townRedMarker = row.id;
          button.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation();
            if (row.source_url) window.open(row.source_url, '_blank', 'noopener,noreferrer');
          });
          markerLayer.appendChild(button);
        } catch {}
      }
    }

    // Merge a realtime/database row into the local marker snapshot and refresh
    // both the overlay and the currently-open Rightmove popup control.
    function mergeMarker(row) {
      if (!row || row.map_id !== selectedMapId) return;
      const index = markers.findIndex(item => item.id === row.id);
      if (index >= 0) markers[index] = row; else markers.push(row);
      updateCount();
      renderTownRedMarkers();
      refreshRightmovePopupControl();
    }

    // Load all points for the selected Town Red map. Capture the map id before
    // awaiting so a slow response cannot populate a map the user has since left.
    async function loadRemoteMarkers() {
      if (!selectedMapId) { markers = []; renderTownRedMarkers(); return; }
      await ensureAuth();
      const mapIdAtStart = selectedMapId;
      const result = await sb.from('markers')
        .select('id,map_id,created_by,kind,label,longitude,latitude,source_url,created_at,updated_at')
        .eq('map_id', mapIdAtStart)
        .order('created_at', { ascending: true });
      if (result.error) throw result.error;
      if (selectedMapId !== mapIdAtStart) return;
      markers = result.data || [];
      updateCount();
      renderTownRedMarkers();
      refreshRightmovePopupControl();
    }

    // -----------------------------------------------------------------------
    // Finding the Rightmove listing popup
    // -----------------------------------------------------------------------
    // First try the actual event path; if Rightmove has moved the property link
    // into a newly-created popup, fall back to the nearest visible property link
    // to the original click position.
    function nearestPropertyLink(clientX, clientY, eventTarget) {
      const path = typeof eventTarget?.composedPath === 'function' ? eventTarget.composedPath() : [];
      for (const node of [eventTarget, ...path]) {
        if (!(node instanceof Element)) continue;
        const direct = node.closest?.('a[href*="/properties/"]');
        if (direct && canonicalPropertyUrl(direct.href)) return direct;
      }

      let best = null;
      let bestDistance = Infinity;
      for (const link of document.querySelectorAll('a[href*="/properties/"]')) {
        if (!canonicalPropertyUrl(link.href)) continue;
        const rect = link.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > innerHeight) continue;
        const x = Math.max(rect.left, Math.min(clientX, rect.right));
        const y = Math.max(rect.top, Math.min(clientY, rect.bottom));
        const distance = Math.hypot(clientX - x, clientY - y);
        if (distance < bestDistance) { bestDistance = distance; best = link; }
      }
      return bestDistance <= 420 ? best : null;
    }

    // Rightmove has changed popup wrappers over time, so prefer semantic/common
    // containers and then walk upward looking for a sensibly-sized card.
    function findPropertyPopup(link) {
      if (!(link instanceof Element)) return null;
      const preferred = link.closest('[role="dialog"],article,[class*="popup" i],[class*="card" i],[class*="property" i]');
      if (preferred) return preferred;

      let node = link.parentElement;
      while (node && node !== document.body) {
        const rect = node.getBoundingClientRect();
        if (rect.width >= 180 && rect.width <= 700 && rect.height >= 80 && rect.height <= 700) return node;
        node = node.parentElement;
      }
      return link.parentElement;
    }

    // Popup controls are ephemeral decorations of Rightmove-owned DOM. Remove
    // the previous one before decorating a newly opened/recycled popup.
    function removeExistingPopupControls() {
      for (const control of document.querySelectorAll('[data-town-red-popup-control]')) control.remove();
    }

    function popupButtonStyle(button, destructive = false) {
      Object.assign(button.style, {
        display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '10px',
        padding: '9px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: '700',
        fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontSize: '13px',
        border: '1px solid #9c1616',
        background: destructive ? '#fff' : '#9c1616', color: destructive ? '#9c1616' : '#fff'
      });
    }

    // -----------------------------------------------------------------------
    // Add/remove property actions
    // -----------------------------------------------------------------------
    async function addActivePropertyToTownRed(control) {
      const active = activeRightmoveProperty;
      if (!active || !selectedMapId || !canEdit()) return;
      try {
        control.disabled = true;
        control.textContent = 'Adding…';
        await ensureAuth();
        const existing = markers.find(item => item.source_url === active.sourceUrl);
        if (existing) { refreshRightmovePopupControl(); return; }

        const row = {
          map_id: selectedMapId,
          created_by: userId,
          kind: 'house',
          label: active.label,
          longitude: active.point.lng,
          latitude: active.point.lat,
          source_url: active.sourceUrl
        };
        const result = await sb.from('markers').insert(row)
          .select('id,map_id,created_by,kind,label,longitude,latitude,source_url,created_at,updated_at')
          .single();
        if (result.error) {
          // source_url is unique per map. If another client beat us to the row,
          // just reload rather than treating the duplicate as a user-visible error.
          if (result.error.code === '23505') { await loadRemoteMarkers(); return; }
          throw result.error;
        }
        mergeMarker(result.data);
        setSync('live');
      } catch (error) {
        console.warn('[Town Red] property add failed', error);
        setSync('house add failed', true);
        control.disabled = false;
        control.textContent = 'Add to Town Red';
      }
    }

    async function removeActivePropertyFromTownRed(control, marker) {
      if (!marker || !canRemoveMarker(marker)) return;
      try {
        control.disabled = true;
        control.textContent = 'Removing…';
        await ensureAuth();
        const result = await sb.from('markers').delete().eq('id', marker.id);
        if (result.error) throw result.error;
        markers = markers.filter(item => item.id !== marker.id);
        updateCount();
        renderTownRedMarkers();
        setSync('live');
        refreshRightmovePopupControl();
      } catch (error) {
        console.warn('[Town Red] property remove failed', error);
        setSync('house remove failed', true);
        control.disabled = false;
        control.textContent = 'Remove from Town Red';
      }
    }

    // Rebuild the button based on whether this canonical listing already exists
    // in the selected Town Red map and whether the current user may remove it.
    function refreshRightmovePopupControl() {
      removeExistingPopupControls();
      const active = activeRightmoveProperty;
      if (!active || !active.popup?.isConnected || !selectedMapId || !canEdit()) return;

      const marker = markers.find(item => item.source_url === active.sourceUrl);
      const wrapper = document.createElement('div');
      wrapper.dataset.townRedPopupControl = 'true';
      wrapper.style.margin = '0 12px 12px';

      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.townRedPopupControl = 'true';

      if (!marker) {
        button.textContent = 'Add to Town Red';
        popupButtonStyle(button, false);
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          addActivePropertyToTownRed(button);
        });
      } else if (canRemoveMarker(marker)) {
        button.textContent = 'Remove from Town Red';
        popupButtonStyle(button, true);
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          removeActivePropertyFromTownRed(button, marker);
        });
      } else {
        button.textContent = 'Added to Town Red';
        popupButtonStyle(button, false);
        button.disabled = true;
        button.style.opacity = '.65';
        button.style.cursor = 'default';
      }

      wrapper.appendChild(button);
      active.popup.appendChild(wrapper);
    }

    // -----------------------------------------------------------------------
    // Click -> popup association
    // -----------------------------------------------------------------------
    // Rightmove creates the popup after the click event. Delayed inspections
    // find that popup, but the point is deliberately the original geographic
    // click coordinate; recalculating from mutable popup/price-bubble DOM proved
    // unreliable after pans and DOM recycling.
    function inspectRightmovePropertyPopup(clientX, clientY, target, point, generation) {
      if (generation !== propertyCaptureGeneration) return false;

      const link = nearestPropertyLink(clientX, clientY, target);
      const sourceUrl = canonicalPropertyUrl(link?.href);
      if (!sourceUrl) return false;
      const popup = findPropertyPopup(link);
      if (!popup) return false;
      if (generation !== propertyCaptureGeneration) return false;

      activeRightmoveProperty = {
        sourceUrl,
        point,
        label: markerLabelFromLink(link, sourceUrl),
        popup,
        generation
      };
      refreshRightmovePopupControl();
      return true;
    }

    async function captureRightmoveProperty(event) {
      if (!selectedMapId || !canEdit() || !projection || !mapRect) return;
      if (settings.mode !== 'navigate' || spaceHeld) return;
      if (event.button !== 0) return;
      if (event.target?.closest?.('#town-red-toolbar,#town-red-listing-markers,[data-town-red-popup-control]')) return;

      let mapDiv;
      try { mapDiv = map?.getDiv?.(); } catch { return; }
      if (!mapDiv || !mapDiv.contains(event.target)) return;

      // This conversion is performed synchronously while the click and current
      // Google Maps projection unquestionably refer to the same camera state.
      const point = screenToLatLng(event.clientX, event.clientY);
      if (!point) return;

      const clientX = event.clientX, clientY = event.clientY, target = event.target;
      const generation = ++propertyCaptureGeneration;

      // Cancel all pending inspections from the previous property click. This
      // is essential after panning/re-clicking because Rightmove reuses DOM.
      for (const timer of propertyCaptureTimers) clearTimeout(timer);
      propertyCaptureTimers = [];
      activeRightmoveProperty = null;
      removeExistingPopupControls();

      console.debug('[Town Red] captured property click coordinate', {
        generation,
        click: [clientX, clientY],
        point
      });

      // Several attempts cover Rightmove's variable popup-rendering latency. The
      // generation check above ensures only the most recent click can win.
      for (const delay of [80, 180, 350, 650]) {
        const timer = setTimeout(() => {
          if (generation !== propertyCaptureGeneration) return;
          try { inspectRightmovePropertyPopup(clientX, clientY, target, point, generation); }
          catch (error) { console.warn('[Town Red] property popup decoration failed', error); }
        }, delay);
        propertyCaptureTimers.push(timer);
      }
    }

    // -----------------------------------------------------------------------
    // Auth keepalive
    // -----------------------------------------------------------------------
    // Rightmove pages may remain open for a long house-hunting session. Periodic
    // validation/rebinding keeps PostgREST and Realtime on the same anonymous
    // identity without ever creating a replacement user.
    async function keepAuthAlive() {
      if (!activeSession?.user?.id || !activeSession?.access_token || !activeSession?.refresh_token) return;
      try {
        const current = await sb.auth.getSession();
        if (current.error) throw current.error;
        let session = current.data.session;

        if (!session || session.user?.id !== activeSession.user.id) {
          const restored = await sb.auth.setSession({
            access_token: activeSession.access_token,
            refresh_token: activeSession.refresh_token
          });
          if (restored.error) throw restored.error;
          session = restored.data.session;
        }

        if (session?.user?.id === activeSession.user.id) {
          activeSession = session;
          userId = session.user.id;
          GM_setValue(ESTABLISHED_USER_KEY, session.user.id);
          if (session.access_token) await sb.realtime.setAuth(session.access_token);
          updateControls();
        }
      } catch (error) {
        console.warn('[Town Red] auth keepalive failed', error);
      }
    }

    setInterval(keepAuthAlive, 45000);
