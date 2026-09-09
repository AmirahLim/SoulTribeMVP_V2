import { getSupabaseBrowserClient } from './supabase';

export type LiveCoordinates = { longitude: number; latitude: number };

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

/** Member JWT only: nearby currently-online IDs, never coordinates. */
export async function filterLocalOnlineIds(
  radiusMeters: number,
  clientFactory = getSupabaseBrowserClient,
): Promise<string[]> {
  const { data, error } = await clientFactory().rpc('filter_local_online_ids', {
    p_radius_meters: radiusMeters,
  });
  if (error) throw error;
  const unique = new Set<string>();
  for (const row of data ?? []) {
    const id = (row as { user_id?: unknown }).user_id;
    if (typeof id === 'string' && id.length > 0) unique.add(id);
  }
  return [...unique];
}

export function readBrowserCoordinates(
  getCurrentPosition: Geolocation['getCurrentPosition'] | undefined = typeof navigator !== 'undefined'
    ? navigator.geolocation?.getCurrentPosition.bind(navigator.geolocation)
    : undefined,
): Promise<LiveCoordinates> {
  if (!getCurrentPosition) {
    return Promise.reject(new Error('Location is unavailable in this browser.'));
  }
  return new Promise((resolve, reject) => {
    getCurrentPosition(
      (position) => {
        resolve({ longitude: position.coords.longitude, latitude: position.coords.latitude });
      },
      (error) => reject(error),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

/** Best-effort Box 3 write so filter_local_online_ids can see this member. */
export async function reportBrowserLivePresence(
  getPosition: () => Promise<LiveCoordinates> = readBrowserCoordinates,
  clientFactory = getSupabaseBrowserClient,
): Promise<boolean> {
  try {
    const { longitude, latitude } = await getPosition();
    await upsertLivePresence(longitude, latitude, true, clientFactory);
    return true;
  } catch {
    return false;
  }
}
