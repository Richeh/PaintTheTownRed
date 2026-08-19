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
