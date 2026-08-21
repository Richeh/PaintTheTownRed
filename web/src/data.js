import { supabase } from './supabase.js';

function databaseError(error, context) {
  if (!error) return new Error(context);
  const message = error.message || error.details || error.hint || String(error);
  const suffix = error.code ? ` (${error.code})` : '';
  const wrapped = new Error(`${context}: ${message}${suffix}`);
  wrapped.cause = error;
  return wrapped;
}

export async function listSharedMaps(userId) {
  const { data: maps, error } = await supabase
    .from('maps')
    .select('id,name,owner_id,created_at')
    .order('created_at', { ascending: true });

  if (error) throw error;

  const roleByMap = new Map();

  const memberMapIds = (maps || [])
    .filter((map) => map.owner_id !== userId)
    .map((map) => map.id);

  if (memberMapIds.length) {
    const { data: memberships, error: membershipError } = await supabase
      .from('map_members')
      .select('map_id,role')
      .in('map_id', memberMapIds)
      .eq('user_id', userId);

    if (membershipError) throw membershipError;

    for (const membership of memberships || []) {
      roleByMap.set(membership.map_id, membership.role);
    }
  }

  return (maps || []).map((map) => ({
    ...map,
    role: map.owner_id === userId ? 'owner' : roleByMap.get(map.id) || 'viewer',
  }));
}

export async function createSharedMap({ name, userId }) {
  const { data, error } = await supabase
    .from('maps')
    .insert({ name: name.trim(), owner_id: userId })
    .select('id,name,owner_id,created_at')
    .single();

  if (error) throw error;
  return data;
}

export async function joinSharedMap(inviteToken) {
  const { data, error } = await supabase.rpc('join_map_with_invite', {
    p_token: inviteToken.trim(),
  });

  if (error) throw error;
  if (Array.isArray(data)) return data[0]?.map_id || null;
  if (data && typeof data === 'object') return data.map_id || null;
  return typeof data === 'string' ? data : null;
}

export async function createMapInvite({ mapId, role = 'editor', maxUses = 1 }) {
  const { data, error } = await supabase.rpc('create_map_invite', {
    p_map_id: mapId,
    p_role: role,
    p_max_uses: maxUses,
    p_expires_at: null,
  });

  if (error) throw error;
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data[0]?.invite_token || data[0]?.token || null;
  if (data && typeof data === 'object') return data.invite_token || data.token || null;
  return null;
}

export async function getProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,display_name,created_at,updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw databaseError(error, 'Could not load profile');
  return data || null;
}

export async function saveProfile({ userId, displayName }) {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, display_name: displayName.trim() }, { onConflict: 'user_id' })
    .select('user_id,display_name,created_at,updated_at')
    .single();
  if (error) throw databaseError(error, 'Could not save profile');
  return data;
}

export async function loadProfiles(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,display_name')
    .in('user_id', ids);
  if (error) throw error;
  return data || [];
}

export async function loadStrokes(mapId) {
  if (!mapId) return [];
  const { data, error } = await supabase
    .from('strokes')
    .select('id,sequence,map_id,created_by,mode,brush_metres,opacity,points,created_at')
    .eq('map_id', mapId)
    .order('sequence', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createStroke({ mapId, userId, mode, brushMetres, opacity, points, id }) {
  const { data, error } = await supabase
    .from('strokes')
    .insert({ id, map_id: mapId, created_by: userId, mode, brush_metres: brushMetres, opacity, points })
    .select('id,sequence,map_id,created_by,mode,brush_metres,opacity,points,created_at')
    .single();
  if (error) throw error;
  return data;
}

const MARKER_COLUMNS = 'id,map_id,created_by,kind,label,longitude,latitude,source_url,created_at,updated_at';

export async function loadMarkers(mapId) {
  if (!mapId) return [];
  const { data, error } = await supabase
    .from('markers')
    .select(MARKER_COLUMNS)
    .eq('map_id', mapId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createMarker({ mapId, userId, kind, label, longitude, latitude, sourceUrl = null }) {
  const { data, error } = await supabase
    .from('markers')
    .insert({ map_id: mapId, created_by: userId, kind, label: label.trim(), longitude, latitude, source_url: sourceUrl || null })
    .select(MARKER_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function updateMarker({ id, kind, label, longitude, latitude, sourceUrl }) {
  const changes = { kind, label: label.trim(), updated_at: new Date().toISOString() };
  if (Number.isFinite(Number(longitude))) changes.longitude = Number(longitude);
  if (Number.isFinite(Number(latitude))) changes.latitude = Number(latitude);
  if (sourceUrl !== undefined) changes.source_url = sourceUrl || null;

  const { data, error } = await supabase
    .from('markers')
    .update(changes)
    .eq('id', id)
    .select(MARKER_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMarker(id) {
  const { error } = await supabase.from('markers').delete().eq('id', id);
  if (error) throw error;
}

async function setRealtimeAuth() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session?.access_token) await supabase.realtime.setAuth(sessionData.session.access_token);
}

export async function subscribeToStrokeInserts(mapId, onInsert, onStatus) {
  await setRealtimeAuth();
  const channel = supabase
    .channel(`town-red-web-strokes-${mapId}-${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'strokes', filter: `map_id=eq.${mapId}` }, (payload) => onInsert?.(payload.new))
    .subscribe((status, error) => onStatus?.(status, error));
  return () => { supabase.removeChannel(channel); };
}

export async function subscribeToMarkerChanges(mapId, onChange, onStatus) {
  await setRealtimeAuth();
  const channel = supabase
    .channel(`town-red-web-markers-${mapId}-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'markers', filter: `map_id=eq.${mapId}` }, (payload) => onChange?.(payload))
    .subscribe((status, error) => onStatus?.(status, error));
  return () => { supabase.removeChannel(channel); };
}
