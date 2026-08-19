import { supabase } from './supabase.js';

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
    .insert({
      name: name.trim(),
      owner_id: userId,
    })
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

  if (Array.isArray(data)) {
    return data[0]?.map_id || null;
  }

  if (data && typeof data === 'object') {
    return data.map_id || null;
  }

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
  const row = {
    id,
    map_id: mapId,
    created_by: userId,
    mode,
    brush_metres: brushMetres,
    opacity,
    points,
  };

  const { data, error } = await supabase
    .from('strokes')
    .insert(row)
    .select('id,sequence,map_id,created_by,mode,brush_metres,opacity,points,created_at')
    .single();

  if (error) throw error;
  return data;
}

export async function subscribeToStrokeInserts(mapId, onInsert, onStatus) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) throw sessionError;

  if (sessionData.session?.access_token) {
    await supabase.realtime.setAuth(sessionData.session.access_token);
  }

  const channel = supabase
    .channel(`town-red-web-strokes-${mapId}-${Date.now()}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'strokes',
        filter: `map_id=eq.${mapId}`,
      },
      (payload) => onInsert?.(payload.new),
    )
    .subscribe((status, error) => onStatus?.(status, error));

  return () => {
    supabase.removeChannel(channel);
  };
}
