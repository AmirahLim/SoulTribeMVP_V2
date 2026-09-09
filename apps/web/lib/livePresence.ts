import { getSupabaseBrowserClient } from './supabase';

/** Write only the signed-in member's live point. Matching reads IDs through filter_local_online_ids. */
export async function upsertLivePresence(
  longitude: number,
  latitude: number,
  isOnline = true,
  clientFactory = getSupabaseBrowserClient,
) {
  const { error } = await clientFactory().rpc('upsert_live_presence', {
    p_longitude: longitude,
    p_latitude: latitude,
    p_is_online: isOnline,
  });
  if (error) throw error;
}
