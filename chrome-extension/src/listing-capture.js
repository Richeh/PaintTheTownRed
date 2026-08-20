    function canonicalPropertyUrl(href) {
      if (!href) return null;
      try {
        const url = new URL(href, location.origin);
        const match = url.pathname.match(/^\/properties\/(\d+)/);
        if (!match || url.hostname !== location.hostname) return null;
        return `${location.origin}/properties/${match[1]}`;
      } catch { return null; }
    }

    function markerLabelFromLink(link, sourceUrl) {
      const raw = [link?.getAttribute?.('aria-label'), link?.textContent]
        .map(value => String(value || '').replace(/\s+/g, ' ').trim())
        .find(Boolean);
      if (raw) return raw.slice(0, 160);
      const id = sourceUrl?.match(/\/properties\/(\d+)/)?.[1];
      return id ? `Rightmove property ${id}` : 'Rightmove property';
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

    async function captureRightmoveProperty(event) {
      if (!selectedMapId || !canEdit() || !projection || !mapRect) return;
      if (settings.mode !== 'navigate' || spaceHeld) return;
      if (event.button !== 0) return;
      if (event.target?.closest?.('#town-red-toolbar,#town-red-listing-markers')) return;

      let mapDiv;
      try { mapDiv = map?.getDiv?.(); } catch { return; }
      if (!mapDiv || !mapDiv.contains(event.target)) return;

      const point = screenToLatLng(event.clientX, event.clientY);
      if (!point) return;
      const clientX = event.clientX, clientY = event.clientY, target = event.target;

      setTimeout(async () => {
        try {
          await ensureAuth();
          const link = nearestPropertyLink(clientX, clientY, target);
          const sourceUrl = canonicalPropertyUrl(link?.href);
          if (!sourceUrl) return;
          if (markers.some(item => item.source_url === sourceUrl)) {
            setSync('house already saved');
            setTimeout(() => setSync('live'), 900);
            return;
          }

          const row = {
            map_id: selectedMapId,
            created_by: userId,
            kind: 'house',
            label: markerLabelFromLink(link, sourceUrl),
            longitude: point.lng,
            latitude: point.lat,
            source_url: sourceUrl
          };
          setSync('saving house…');
          const result = await sb.from('markers').insert(row)
            .select('id,map_id,created_by,kind,label,longitude,latitude,source_url,created_at,updated_at')
            .single();
          if (result.error) {
            if (result.error.code === '23505') { await loadRemoteMarkers(); setSync('live'); return; }
            throw result.error;
          }
          mergeMarker(result.data);
          setSync('live');
        } catch (error) {
          console.warn('[Town Red] property capture failed', error);
          setSync('house save failed', true);
        }
      }, 180);
    }
