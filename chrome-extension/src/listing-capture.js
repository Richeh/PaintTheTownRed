    let activeRightmoveProperty = null;
    let propertyCaptureGeneration = 0;
    let propertyCaptureTimers = [];

    function canonicalPropertyUrl(href) {
      if (!href) return null;
      try {
        const url = new URL(href, location.origin);
        const match = url.pathname.match(/^\/properties\/(\d+)/);
        if (!match || url.hostname !== location.hostname) return null;
        return `${location.origin}/properties/${match[1]}`;
      } catch { return null; }
    }

    function cleanPropertyLabel(value) {
      let text = String(value || '').replace(/\s+/g, ' ').trim();
      text = text
        .replace(/^view property details(?:\s+for)?\s*[:\-–—]?\s*/i, '')
        .replace(/^property details(?:\s+for)?\s*[:\-–—]?\s*/i, '')
        .replace(/^view details(?:\s+for)?\s*[:\-–—]?\s*/i, '')
        .trim();
      return text;
    }

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

    function canRemoveMarker(row) {
      return selectedRole === 'owner' || row?.created_by === userId;
    }

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

    function mergeMarker(row) {
      if (!row || row.map_id !== selectedMapId) return;
      const index = markers.findIndex(item => item.id === row.id);
      if (index >= 0) markers[index] = row; else markers.push(row);
      updateCount();
      renderTownRedMarkers();
      refreshRightmovePopupControl();
    }

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

    function inspectRightmovePropertyPopup(clientX, clientY, target, point, generation) {
      // Multiple delayed inspections are used because Rightmove creates the
      // property popup asynchronously. Never let an older click overwrite the
      // state belonging to a newer click.
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

      // This is deliberately the original capture method. Before the popup
      // button existed, the property was inserted immediately using this exact
      // point and it proved stable. The button should delay the decision to add,
      // not recalculate the property's geography from mutable Rightmove DOM.
      const point = screenToLatLng(event.clientX, event.clientY);
      if (!point) return;

      const clientX = event.clientX, clientY = event.clientY, target = event.target;
      const generation = ++propertyCaptureGeneration;

      for (const timer of propertyCaptureTimers) clearTimeout(timer);
      propertyCaptureTimers = [];
      activeRightmoveProperty = null;
      removeExistingPopupControls();

      console.debug('[Town Red] captured property click coordinate', {
        generation,
        click: [clientX, clientY],
        point
      });

      for (const delay of [80, 180, 350, 650]) {
        const timer = setTimeout(() => {
          if (generation !== propertyCaptureGeneration) return;
          try { inspectRightmovePropertyPopup(clientX, clientY, target, point, generation); }
          catch (error) { console.warn('[Town Red] property popup decoration failed', error); }
        }, delay);
        propertyCaptureTimers.push(timer);
      }
    }

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
          if (session.access_token) await sb.realtime.setAuth(session.access_token);
          updateControls();
        }
      } catch (error) {
        console.warn('[Town Red] auth keepalive failed', error);
      }
    }

    setInterval(keepAuthAlive, 45000);
