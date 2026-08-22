import { Map as MapLibreMap, Marker, NavigationControl, ScaleControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from './supabase.js';
import {
  createMarker,
  deleteMarker,
  loadMarkers,
  loadProfiles,
  subscribeToMarkerChanges,
  updateMarker,
} from './data.js';

// This module deliberately stays framework-agnostic. Vue owns application and
// dialog state in App.vue, while createTownRedMap() owns the imperative mapping
// concerns that MapLibre and the drawing canvas naturally expose.
//
// There are three visual layers in the renderer:
//   1. MapLibre raster tiles at the bottom;
//   2. a transparent canvas for shared red/blue/erase strokes;
//   3. DOM/MapLibre markers and small controls above the canvas.
//
// The returned object at the bottom is the renderer's public API. Callers should
// use that API rather than reaching into the DOM created in this function.

// A deliberately small raster style avoids depending on a third-party vector
// style whose filters/sprites can change independently of Town Red. OpenStreetMap
// tiles give us a predictable geographic base while all collaboration data is
// rendered locally on top.
const DEFAULT_STYLE = {
  version: 8,
  id: 'town-red-raster',
  sources: {
    'raster-tiles': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'simple-tiles', type: 'raster', source: 'raster-tiles' }],
};

const DEFAULT_CENTER = [-1.4701, 53.3811];
const DEFAULT_ZOOM = 11;

// Per-editor layer visibility is intentionally a local preference. It is keyed
// by map id and never changes what collaborators see on their own screens.
const LAYER_STORAGE_PREFIX = 'town-red:layers:';

// Marker kinds are stored as stable string values; their symbols are purely a
// presentation choice and can therefore change without a database migration.
const MARKER_SYMBOLS = { house: '⌂', viewed: '✓', poi: '★', note: '✎', point: '•' };

export function createTownRedMap(container, { onReady, onError, onStrokeComplete } = {}) {
  // -------------------------------------------------------------------------
  // DOM shell and controls
  // -------------------------------------------------------------------------
  // The renderer builds its own internal DOM so Vue only needs to provide one
  // container ref. This keeps MapLibre/canvas lifecycle code out of templates.
  const shell = document.createElement('div');
  shell.className = 'relative h-full min-h-[32rem] overflow-hidden rounded-2xl bg-stone-200';

  const mapElement = document.createElement('div');
  mapElement.className = 'absolute inset-0 z-0';
  mapElement.style.width = '100%';
  mapElement.style.height = '100%';

  // Strokes are drawn on a transparent high-DPI canvas rather than as thousands
  // of MapLibre features. This makes freehand painting cheap and preserves erase
  // semantics via canvas compositing.
  const canvas = document.createElement('canvas');
  canvas.className = 'pointer-events-none absolute inset-0 z-10 h-full w-full';
  canvas.style.background = 'transparent';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('aria-hidden', 'true');

  const layerPanel = document.createElement('section');
  layerPanel.className = 'absolute left-3 top-3 z-20 hidden w-56 rounded-xl border border-stone-200 bg-white/95 p-3 text-sm text-stone-800 shadow-lg backdrop-blur';
  layerPanel.setAttribute('aria-label', 'Overlay layers');
  layerPanel.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <strong class="font-semibold">Layers</strong>
      <button type="button" data-layer-show-all class="text-xs font-semibold text-red-800 hover:text-red-950">Show all</button>
    </div>
    <div data-layer-list class="mt-2 space-y-2"></div>
    <p class="mt-2 text-[11px] leading-4 text-stone-500">Visibility is saved only in this browser.</p>
  `;

  const addPointButton = document.createElement('button');
  addPointButton.type = 'button';
  addPointButton.className = 'absolute bottom-10 right-3 z-20 hidden rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 shadow-lg hover:bg-stone-50';
  addPointButton.textContent = 'Add point';

  shell.append(mapElement, canvas, layerPanel, addPointButton);
  container.replaceChildren(shell);

  // Marker editing is kept inside the renderer because moving a marker is an
  // inherently map-driven interaction: the dialog can temporarily hand control
  // back to the map so the user can click a replacement coordinate.
  const markerDialog = document.createElement('dialog');
  markerDialog.className = 'm-auto w-[min(30rem,calc(100%-2rem))] rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/40';
  markerDialog.innerHTML = `
    <form data-marker-form class="p-5">
      <h2 data-marker-title class="m-0 text-lg font-semibold">Add point</h2>
      <p data-marker-description class="mt-1 text-sm text-stone-600">Give this location a type and a short label.</p>
      <label class="mt-4 block text-sm font-medium text-stone-700">
        Type
        <select data-marker-kind class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100">
          <option value="house">House</option><option value="viewed">Viewed</option><option value="poi">Point of interest</option><option value="note">Note</option><option value="point">Point</option>
        </select>
      </label>
      <label class="mt-4 block text-sm font-medium text-stone-700">
        Label
        <input data-marker-label class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100" type="text" maxlength="160" required placeholder="e.g. 14 Church Street" />
      </label>
      <p data-marker-position class="mt-3 hidden text-xs text-stone-500"></p>
      <p data-marker-error class="mt-3 hidden text-sm text-red-700"></p>
      <div class="mt-5 flex flex-wrap justify-between gap-2">
        <div class="flex gap-2">
          <button data-marker-delete type="button" class="hidden rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50">Delete</button>
          <button data-marker-move type="button" class="hidden rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Move</button>
        </div>
        <div class="flex gap-2">
          <button data-marker-cancel type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancel</button>
          <button data-marker-save type="submit" class="rounded-lg border border-red-800 bg-red-800 px-3 py-2 text-sm font-semibold text-white hover:bg-red-900">Save point</button>
        </div>
      </div>
    </form>
  `;
  document.body.append(markerDialog);

  // -------------------------------------------------------------------------
  // MapLibre and element references
  // -------------------------------------------------------------------------
  const map = new MapLibreMap({ container: mapElement, style: DEFAULT_STYLE, center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, attributionControl: true });
  map.addControl(new NavigationControl(), 'top-right');
  map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

  const ctx = canvas.getContext('2d');
  const layerList = layerPanel.querySelector('[data-layer-list]');
  const showAllButton = layerPanel.querySelector('[data-layer-show-all]');
  const markerForm = markerDialog.querySelector('[data-marker-form]');
  const markerTitle = markerDialog.querySelector('[data-marker-title]');
  const markerDescription = markerDialog.querySelector('[data-marker-description]');
  const markerKind = markerDialog.querySelector('[data-marker-kind]');
  const markerLabel = markerDialog.querySelector('[data-marker-label]');
  const markerPosition = markerDialog.querySelector('[data-marker-position]');
  const markerError = markerDialog.querySelector('[data-marker-error]');
  const markerSave = markerDialog.querySelector('[data-marker-save]');
  const markerCancel = markerDialog.querySelector('[data-marker-cancel]');
  const markerDelete = markerDialog.querySelector('[data-marker-delete]');
  const markerMove = markerDialog.querySelector('[data-marker-move]');

  // -------------------------------------------------------------------------
  // Renderer-local state
  // -------------------------------------------------------------------------
  // Vue owns the authoritative application state; these variables are the
  // renderer's working copies used for fast redraws and map interactions.
  let strokes = [], draftStroke = null, destroyed = false, currentUserId = null, activeMapId = null;
  let hiddenCreators = new Set(), creatorNames = new globalThis.Map(), profileGeneration = 0;
  let markers = [], mapMarkers = [], unsubscribeMarkers = null, pendingPoint = null, editingMarker = null, movingMarker = null, placingPoint = false;
  let editor = { enabled: false, role: 'viewer', mode: 'navigate', brushPixels: 42, opacity: 0.2 };

  // Marker permissions and collaborator labels need the current uid. AuthDock
  // reloads the page after identity changes, so one lookup is sufficient here.
  supabase.auth.getSession().then(({ data }) => { currentUserId = data.session?.user?.id || null; renderLayerPanel(); renderMarkers(); }).catch(() => {});

  // -------------------------------------------------------------------------
  // Per-collaborator layer visibility
  // -------------------------------------------------------------------------
  // `#shared-map-select` is a compatibility bridge to the Vue app. activeMapId
  // remains the fallback for renderer-driven operations and initialisation.
  function currentSelectedMapId() { return document.querySelector('#shared-map-select')?.value || activeMapId || null; }
  function layerStorageKey(mapId = activeMapId) { return mapId ? `${LAYER_STORAGE_PREFIX}${mapId}` : null; }

  // Layer preferences are best-effort localStorage values. A blocked/corrupt
  // localStorage must never prevent the map itself from loading.
  function loadLayerPreferences(mapId) { const key = layerStorageKey(mapId); if (!key) return void (hiddenCreators = new Set()); try { const stored = JSON.parse(localStorage.getItem(key) || '[]'); hiddenCreators = new Set(Array.isArray(stored) ? stored.filter(Boolean) : []); } catch { hiddenCreators = new Set(); } }
  function saveLayerPreferences() { const key = layerStorageKey(); if (!key) return; try { localStorage.setItem(key, JSON.stringify([...hiddenCreators])); } catch {} }
  function creatorIds() { return [...new Set(strokes.map((s) => s?.created_by).filter(Boolean))]; }
  function creatorLabel(id) { const name = creatorNames.get(id); if (id === currentUserId) return name ? `${name} (You)` : 'You'; return name || `Collaborator ${id.slice(0, 6)}`; }

  // Rebuild the small layer panel from current stroke authors. Toggling a box
  // affects only drawing visibility; no shared data is changed.
  function renderLayerPanel() {
    const creators = creatorIds(); layerPanel.classList.toggle('hidden', creators.length === 0); layerList.replaceChildren();
    for (const creatorId of creators) {
      const label = document.createElement('label'); label.className = 'flex cursor-pointer items-center gap-2';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !hiddenCreators.has(creatorId); checkbox.className = 'h-4 w-4 accent-red-800';
      checkbox.addEventListener('change', () => { checkbox.checked ? hiddenCreators.delete(creatorId) : hiddenCreators.add(creatorId); saveLayerPreferences(); redraw(); });
      const text = document.createElement('span'); text.className = 'min-w-0 flex-1 truncate'; text.textContent = creatorLabel(creatorId); text.title = creatorNames.get(creatorId) || creatorId;
      const count = document.createElement('span'); count.className = 'text-xs tabular-nums text-stone-400'; count.textContent = String(strokes.filter((s) => s.created_by === creatorId).length);
      label.append(checkbox, text, count); layerList.append(label);
    }
  }

  // Profile requests can resolve out of order when maps change quickly. The
  // generation counter ensures only the newest request is allowed to update UI.
  async function refreshCreatorNames() { const generation = ++profileGeneration, creators = creatorIds(); if (!creators.length) { creatorNames = new globalThis.Map(); return renderLayerPanel(); } try { const profiles = await loadProfiles(creators); if (destroyed || generation !== profileGeneration) return; creatorNames = new globalThis.Map((profiles || []).map((p) => [p.user_id, p.display_name])); renderLayerPanel(); } catch (e) { if (!destroyed) console.warn('[Town Red] could not load collaborator names', e); } }
  showAllButton.addEventListener('click', () => { hiddenCreators.clear(); saveLayerPreferences(); renderLayerPanel(); redraw(); });
  function visibleStrokes() { return strokes.filter((s) => !s?.created_by || !hiddenCreators.has(s.created_by)); }

  // -------------------------------------------------------------------------
  // Geographic canvas drawing
  // -------------------------------------------------------------------------
  // The canvas backing store is scaled by devicePixelRatio, while MapLibre's
  // project/unproject APIs deal in CSS pixels. All helper conversions account
  // for that boundary explicitly.
  function resizeCanvas() { if (destroyed) return; const rect = shell.getBoundingClientRect(), dpr = devicePixelRatio || 1, width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr)); if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; } canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`; }

  // Brush width is stored in metres, not screen pixels, so a saved stroke keeps
  // the same real-world footprint as users zoom in and out.
  function metresToCssPixels(point, metres) { const lat = Number(point.lat), lng = Number(point.lng), cosine = Math.max(.01, Math.cos(lat * Math.PI / 180)), eastLng = lng + metres / (111320 * cosine), start = map.project([lng, lat]), east = map.project([eastLng, lat]); return Math.max(1, Math.abs(east.x - start.x)); }
  function cssPixelsToMetres(point, pixels) { const lat = Number(point.lat), lng = Number(point.lng), start = map.project([lng, lat]), east = map.unproject([start.x + pixels, start.y]), lat1 = lat * Math.PI / 180, lat2 = east.lat * Math.PI / 180, dLat = (east.lat - lat) * Math.PI / 180, dLng = (east.lng - lng) * Math.PI / 180, a = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2; return 6371008.8 * 2 * Math.asin(Math.sqrt(a)); }
  function projectPoint(point, dpr) { const p = map.project([Number(point.lng), Number(point.lat)]); return { x: p.x*dpr, y:p.y*dpr }; }
  function normalisePoints(s) { return Array.isArray(s?.points) ? s.points.filter((p) => Number.isFinite(Number(p?.lng)) && Number.isFinite(Number(p?.lat))) : []; }

  // Eraser strokes are not database deletes. They are ordered strokes drawn
  // with destination-out compositing, which preserves the collaborative history
  // and makes the final image deterministic from the ordered stroke stream.
  function drawStroke(s) { const points = normalisePoints(s); if (!points.length) return; const metres = Number(s.brush_metres ?? s.brushMetres); if (!Number.isFinite(metres)||metres<=0) return; const dpr=devicePixelRatio||1,width=metresToCssPixels(points[0],metres)*dpr,pixels=points.map(p=>projectPoint(p,dpr)); ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=width;if(s.mode==='erase'){ctx.globalCompositeOperation='destination-out';ctx.globalAlpha=1;ctx.strokeStyle=ctx.fillStyle='rgba(0,0,0,1)';}else{ctx.globalCompositeOperation='source-over';ctx.globalAlpha=Number.isFinite(Number(s.opacity))?Number(s.opacity):.2;ctx.strokeStyle=ctx.fillStyle=s.mode==='blue'?'rgb(35,95,220)':'rgb(220,35,45)';}ctx.beginPath();if(pixels.length===1){ctx.arc(pixels[0].x,pixels[0].y,width/2,0,Math.PI*2);ctx.fill();}else{ctx.moveTo(pixels[0].x,pixels[0].y);for(let i=1;i<pixels.length;i++)ctx.lineTo(pixels[i].x,pixels[i].y);ctx.stroke();}ctx.restore(); }

  // A redraw always starts from a clean canvas and replays visible saved strokes
  // in sequence order, followed by the in-progress local draft if one exists.
  function redraw() { if(destroyed)return;resizeCanvas();ctx.clearRect(0,0,canvas.width,canvas.height);for(const s of [...visibleStrokes()].sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0)))drawStroke(s);if(draftStroke)drawStroke(draftStroke); }

  // -------------------------------------------------------------------------
  // Point markers and Rightmove links
  // -------------------------------------------------------------------------
  // Owners may manage any marker. Editors may manage markers they created; the
  // database remains the final authority via RLS.
  function canManageMarker(row) { return Boolean(editor.enabled && (editor.role === 'owner' || row.created_by === currentUserId)); }
  function displayMarkerLabel(value) { return String(value || '').replace(/^view property details(?:\s+for)?\s*[:\-–—]?\s*/i, '').trim() || 'Property'; }
  function closePropertyPopup() { shell.querySelector('[data-town-red-property-popup]')?.remove(); }

  // Markers imported from Rightmove carry source_url. Clicking one opens a small
  // Town Red popup with the canonical property link and (when allowed) edit UI.
  function openPropertyPopup(row, anchor) {
    closePropertyPopup();
    if (!row?.source_url || !anchor?.isConnected) return;
    const shellRect = shell.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.dataset.townRedPropertyPopup = 'true';
    popup.className = 'absolute z-30 w-64 -translate-x-1/2 -translate-y-full rounded-xl border border-stone-200 bg-white p-3 text-sm text-stone-800 shadow-xl';
    popup.style.left = `${anchorRect.left - shellRect.left + anchorRect.width / 2}px`;
    popup.style.top = `${anchorRect.top - shellRect.top - 8}px`;
    const address = document.createElement('div');
    address.className = 'font-semibold leading-5';
    address.textContent = displayMarkerLabel(row.label);
    const actions = document.createElement('div');
    actions.className = 'mt-3 flex flex-wrap gap-2';
    const open = document.createElement('a');
    open.href = row.source_url;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.className = 'rounded-lg bg-red-800 px-3 py-2 text-xs font-semibold text-white hover:bg-red-900';
    open.textContent = 'Open on Rightmove';
    actions.append(open);
    if (canManageMarker(row)) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50';
      edit.textContent = 'Edit point';
      edit.addEventListener('click', (event) => { event.stopPropagation(); closePropertyPopup(); openEditMarker(row); });
      actions.append(edit);
    }
    popup.append(address, actions);
    popup.addEventListener('click', event => event.stopPropagation());
    shell.appendChild(popup);
  }

  // MapLibre Marker accepts arbitrary DOM, which lets Town Red show a symbol and
  // readable text label without maintaining a separate symbol layer/style.
  function markerElement(row) {
    const el=document.createElement('button');el.type='button';el.className='flex max-w-52 items-center gap-1.5 rounded-full border border-stone-300 bg-white/95 px-2 py-1 text-xs font-semibold text-stone-800 shadow-md backdrop-blur hover:border-stone-500 hover:bg-white';
    const shownLabel=displayMarkerLabel(row.label);el.title=row.source_url?shownLabel:(canManageMarker(row)?`${shownLabel} — click to edit`:shownLabel);
    const symbol=document.createElement('span');symbol.className='grid h-5 w-5 shrink-0 place-items-center rounded-full bg-stone-900 text-sm text-white';symbol.textContent=MARKER_SYMBOLS[row.kind]||MARKER_SYMBOLS.point;
    const label=document.createElement('span');label.className='truncate';label.textContent=shownLabel;el.append(symbol,label);
    el.addEventListener('click',(event)=>{event.stopPropagation();if(row.source_url)openPropertyPopup(row,el);else openEditMarker(row);}); return el;
  }

  // Re-rendering marker objects is simple and reliable at Town Red's expected
  // scale; it also guarantees removed/realtime-updated markers leave no stale DOM.
  function renderMarkers(){closePropertyPopup();for(const m of mapMarkers)m.remove();mapMarkers=[];for(const row of markers){const marker=new Marker({element:markerElement(row),anchor:'bottom'}).setLngLat([Number(row.longitude),Number(row.latitude)]).addTo(map);mapMarkers.push(marker);}}

  // Marker realtime subscriptions are map-scoped. Switching maps always tears
  // down the previous channel before loading the new marker set.
  async function switchMarkerMap(mapId){if(mapId===activeMapId&&unsubscribeMarkers)return;activeMapId=mapId||null;unsubscribeMarkers?.();unsubscribeMarkers=null;markers=[];renderMarkers();if(!activeMapId)return;try{markers=await loadMarkers(activeMapId);if(destroyed)return;renderMarkers();unsubscribeMarkers=await subscribeToMarkerChanges(activeMapId,async()=>{try{markers=await loadMarkers(activeMapId);renderMarkers();}catch(e){console.warn('[Town Red] marker refresh failed',e);}},(status,error)=>{if(['CHANNEL_ERROR','TIMED_OUT'].includes(status))console.warn('[Town Red] marker realtime status',status,error);});}catch(e){console.warn('[Town Red] could not load markers',e);}}
  function syncSelectedMap(){const selected=currentSelectedMapId();if(selected&&selected!==activeMapId){loadLayerPreferences(selected);switchMarkerMap(selected);}}

  // -------------------------------------------------------------------------
  // Marker editing / placement state machine
  // -------------------------------------------------------------------------
  function resetMarkerDialog(){markerError.textContent='';markerError.classList.add('hidden');markerPosition.classList.add('hidden');markerDelete.classList.add('hidden');markerMove.classList.add('hidden');markerSave.disabled=false;markerDelete.disabled=false;markerMove.disabled=false;}
  function showMarkerDialog(){if(!markerDialog.open)markerDialog.showModal();requestAnimationFrame(()=>markerLabel.focus());}
  function openAddMarker(point){editingMarker=null;pendingPoint=point;resetMarkerDialog();markerTitle.textContent='Add point';markerDescription.textContent='Give this location a type and a short label.';markerKind.value='house';markerLabel.value='';markerSave.textContent='Save point';showMarkerDialog();}
  function openEditMarker(row){if(!canManageMarker(row))return;editingMarker=row;pendingPoint={longitude:Number(row.longitude),latitude:Number(row.latitude)};resetMarkerDialog();markerTitle.textContent='Edit point';markerDescription.textContent='Change its label or type, move it to a new location, or delete it.';markerKind.value=row.kind;markerLabel.value=row.label;markerSave.textContent='Save changes';markerDelete.classList.remove('hidden');markerMove.classList.remove('hidden');showMarkerDialog();}

  // Point placement temporarily disables the paint canvas so the next map click
  // belongs to MapLibre and can be converted directly to lng/lat.
  function stopPointPlacement(){placingPoint=false;addPointButton.textContent='Add point';addPointButton.classList.remove('ring-2','ring-red-300');map.getCanvas().style.cursor='';setEditor(editor);}
  function startPointPlacement(move=false){if(!editor.enabled)return;syncSelectedMap();if(!activeMapId)return;placingPoint=true;markerDialog.close();addPointButton.textContent=move?'Click new location…':'Click map…';addPointButton.classList.add('ring-2','ring-red-300');canvas.style.pointerEvents='none';map.getCanvas().style.cursor='crosshair';}

  addPointButton.addEventListener('click',()=>startPointPlacement(false));
  map.on('click',(event)=>{closePropertyPopup();if(!placingPoint||!editor.enabled)return;const point={longitude:event.lngLat.lng,latitude:event.lngLat.lat};const moving=Boolean(movingMarker);stopPointPlacement();if(moving){editingMarker=movingMarker;movingMarker=null;pendingPoint=point;resetMarkerDialog();markerTitle.textContent='Move point';markerDescription.textContent='Save this new location, or move it again.';markerKind.value=editingMarker.kind;markerLabel.value=editingMarker.label;markerSave.textContent='Save changes';markerDelete.classList.remove('hidden');markerMove.classList.remove('hidden');markerPosition.textContent='New location selected.';markerPosition.classList.remove('hidden');showMarkerDialog();}else openAddMarker(point);});
  markerCancel.addEventListener('click',()=>{pendingPoint=null;editingMarker=null;movingMarker=null;markerDialog.close();});
  markerMove.addEventListener('click',()=>{if(!editingMarker)return;movingMarker=editingMarker;startPointPlacement(true);});

  // Local arrays are updated immediately after successful writes; the realtime
  // event that follows is harmless because subsequent refreshes are id-based.
  markerDelete.addEventListener('click',async()=>{if(!editingMarker||!canManageMarker(editingMarker))return;if(!window.confirm(`Delete “${editingMarker.label}”?`))return;markerDelete.disabled=true;markerError.classList.add('hidden');try{await deleteMarker(editingMarker.id);markers=markers.filter(m=>m.id!==editingMarker.id);renderMarkers();editingMarker=null;pendingPoint=null;markerDialog.close();}catch(e){markerError.textContent=e instanceof Error?e.message:String(e);markerError.classList.remove('hidden');}finally{markerDelete.disabled=false;}});
  markerForm.addEventListener('submit',async(event)=>{event.preventDefault();if(!pendingPoint||!activeMapId||!currentUserId)return;const label=markerLabel.value.trim();if(!label)return;markerSave.disabled=true;markerError.classList.add('hidden');try{let saved;if(editingMarker){saved=await updateMarker({id:editingMarker.id,kind:markerKind.value,label,longitude:pendingPoint.longitude,latitude:pendingPoint.latitude});const i=markers.findIndex(m=>m.id===saved.id);if(i>=0)markers[i]=saved;}else{saved=await createMarker({mapId:activeMapId,userId:currentUserId,kind:markerKind.value,label,longitude:pendingPoint.longitude,latitude:pendingPoint.latitude});markers.push(saved);}renderMarkers();pendingPoint=null;editingMarker=null;movingMarker=null;markerDialog.close();}catch(e){markerError.textContent=e instanceof Error?e.message:String(e);markerError.classList.remove('hidden');}finally{markerSave.disabled=false;}});

  // -------------------------------------------------------------------------
  // Public stroke/editor API used by Vue
  // -------------------------------------------------------------------------
  // setStrokes replaces the renderer's snapshot and also infers the active map
  // when possible, keeping marker subscriptions and collaborator layers aligned.
  function setStrokes(next){strokes=Array.isArray(next)?next:[];const nextMapId=strokes.find(s=>s?.map_id)?.map_id||currentSelectedMapId();if(nextMapId&&nextMapId!==activeMapId){loadLayerPreferences(nextMapId);creatorNames=new globalThis.Map();switchMarkerMap(nextMapId);}const known=new Set(creatorIds());hiddenCreators=new Set([...hiddenCreators].filter(id=>known.has(id)));saveLayerPreferences();renderLayerPanel();redraw();refreshCreatorNames();}
  function upsertStroke(stroke){if(!stroke?.id)return;const i=strokes.findIndex(s=>s.id===stroke.id);if(i>=0)strokes[i]=stroke;else strokes.push(stroke);if(stroke.map_id&&stroke.map_id!==activeMapId)switchMarkerMap(stroke.map_id);renderLayerPanel();redraw();refreshCreatorNames();}
  function removeStroke(id){strokes=strokes.filter(s=>s.id!==id);renderLayerPanel();redraw();refreshCreatorNames();}

  // Fit uses visible paint first. If a map has points but no strokes, centre on
  // the first marker so point-only maps still open somewhere useful.
  function fitToStrokes(){const points=visibleStrokes().flatMap(normalisePoints);if(!points.length&&markers.length){const f=markers[0];map.easeTo({center:[Number(f.longitude),Number(f.latitude)],zoom:14});return true;}if(!points.length)return false;let minLng=Infinity,maxLng=-Infinity,minLat=Infinity,maxLat=-Infinity;for(const p of points){const lng=Number(p.lng),lat=Number(p.lat);minLng=Math.min(minLng,lng);maxLng=Math.max(maxLng,lng);minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat);}if(minLng===maxLng&&minLat===maxLat)map.easeTo({center:[minLng,minLat],zoom:15});else map.fitBounds([[minLng,minLat],[maxLng,maxLat]],{padding:80,maxZoom:16,duration:500});return true;}

  // setEditor is the single gate controlling whether the overlay canvas can
  // intercept pointer input. Navigation mode always leaves MapLibre interactive.
  function setEditor(next){editor={...editor,...next};syncSelectedMap();const painting=editor.enabled&&editor.mode!=='navigate'&&!placingPoint;canvas.style.pointerEvents=painting?'auto':'none';canvas.style.cursor=editor.mode==='erase'?'cell':'crosshair';addPointButton.classList.toggle('hidden',!editor.enabled||!currentSelectedMapId());map.dragPan.enable();renderMarkers();}

  // -------------------------------------------------------------------------
  // Freehand pointer capture
  // -------------------------------------------------------------------------
  function eventToPoint(event){const rect=canvas.getBoundingClientRect(),ll=map.unproject([event.clientX-rect.left,event.clientY-rect.top]);return{lng:ll.lng,lat:ll.lat};}
  function pointDistanceMetres(a,b){const lat1=a.lat*Math.PI/180,lat2=b.lat*Math.PI/180,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180,h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;return 6371008.8*2*Math.asin(Math.sqrt(h));}

  // Pointer capture keeps a stroke alive if the cursor/finger briefly leaves the
  // canvas. Point sampling is distance-based in metres so uploads stay compact.
  canvas.addEventListener('pointerdown',(event)=>{if(!editor.enabled||editor.mode==='navigate'||placingPoint)return;event.preventDefault();canvas.setPointerCapture(event.pointerId);const point=eventToPoint(event);draftStroke={mode:editor.mode,brush_metres:cssPixelsToMetres(point,editor.brushPixels),opacity:editor.opacity,points:[point]};redraw();});
  canvas.addEventListener('pointermove',(event)=>{if(!draftStroke)return;event.preventDefault();const point=eventToPoint(event),prev=draftStroke.points.at(-1),spacing=Math.max(.5,draftStroke.brush_metres/15);if(pointDistanceMetres(prev,point)>=spacing){draftStroke.points.push(point);redraw();}});

  // The renderer never writes strokes itself. It hands the completed geographic
  // stroke to App.vue through onStrokeComplete, where optimistic/database state
  // is coordinated.
  function finishDraft(event){if(!draftStroke)return;if(event?.pointerId!=null&&canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);const finished=draftStroke;draftStroke=null;redraw();onStrokeComplete?.(finished);}
  canvas.addEventListener('pointerup',finishDraft);canvas.addEventListener('pointercancel',finishDraft);

  // -------------------------------------------------------------------------
  // Map lifecycle and teardown
  // -------------------------------------------------------------------------
  const mapSelect=document.querySelector('#shared-map-select');
  const onMapSelectChange=()=>{const next=currentSelectedMapId();if(next!==activeMapId){loadLayerPreferences(next);switchMarkerMap(next);}setEditor(editor);};
  mapSelect?.addEventListener('change',onMapSelectChange);

  // Every camera movement changes projected canvas coordinates, so paint must be
  // redrawn whenever MapLibre moves or resizes.
  map.on('load',()=>{map.resize();syncSelectedMap();redraw();onReady?.(map);});
  map.on('move',()=>{closePropertyPopup();redraw();});
  map.on('resize',redraw);
  map.on('error',(event)=>{console.error('[Town Red] MapLibre error',event?.error||event);onError?.(event?.error||event);});

  const resizeObserver=new ResizeObserver(()=>{if(destroyed)return;map.resize();redraw();});
  resizeObserver.observe(shell);

  // destroy() is deliberately idempotent because Vite hot reload / Vue teardown
  // can call cleanup more than once. All DOM, observers, subscriptions and map
  // instances created above are released here.
  return{
    map,
    setStrokes,
    upsertStroke,
    removeStroke,
    fitToStrokes,
    setEditor,
    redraw,
    destroy(){if(destroyed)return;destroyed=true;profileGeneration+=1;resizeObserver.disconnect();mapSelect?.removeEventListener('change',onMapSelectChange);unsubscribeMarkers?.();for(const marker of mapMarkers)marker.remove();closePropertyPopup();markerDialog.remove();try{map.remove();}catch(e){console.warn('[Town Red] MapLibre teardown warning',e);}},
  };
}
