import { getGenderAvatarForName } from '@soul-tribe/core';
import { checkIsSupabaseConfigured, getSupabaseBrowserClient } from './supabase';
import { getUserPitches, PitchedOuting } from './userStore';

export interface OutingItem {
  id: string;
  title: string;
  pitch: string;
  area: string;
  category: string;
  dateTime: string;
  startsAt?: string;
  durationMinutes?: number;
  outingState?: string;
  hostId: string;
  hostName: string;
  hostAvatar: string;
  isHostDemo?: boolean;
  seatsTotal: number;
  seatsFilled: number;
  state?: string;
  fitBadge?: string;
  cover_image_url?: string;
  cover_image_thumb_url?: string;
  cover_image_alt?: string;
  cover_photographer_name?: string;
  cover_photographer_url?: string;
  cover_download_location?: string;
}

export function getOutingCategoryImage(category: string, title?: string, area?: string, pitch?: string): string {
  const cat = (category || '').toLowerCase();
  const t = (title || '').toLowerCase();
  const p = (pitch || '').toLowerCase();
  const combined = `${t} ${p}`;

  // 1. Board Games, Card Games & Tabletop Gaming
  if (
    combined.includes('board game') ||
    combined.includes('boardgame') ||
    combined.includes('card game') ||
    combined.includes('card games') ||
    combined.includes('cards') ||
    combined.includes('tabletop') ||
    combined.includes('esther perel') ||
    combined.includes('catan') ||
    combined.includes('chess') ||
    combined.includes('trivia') ||
    combined.includes('monopoly') ||
    combined.includes('gaming')
  ) {
    return 'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=800&auto=format&fit=crop&q=80';
  }

  // 2. Coffee, Cafe, Tea & Matcha
  if (
    combined.includes('coffee') ||
    combined.includes('cafe') ||
    combined.includes('espresso') ||
    combined.includes('matcha') ||
    combined.includes('tea') ||
    cat === 'coffee'
  ) {
    return 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=800&auto=format&fit=crop&q=80';
  }

  // 3. Pottery, Ceramics, Crafts & Making
  if (
    combined.includes('pottery') ||
    combined.includes('ceramic') ||
    combined.includes('clay') ||
    combined.includes('craft') ||
    combined.includes('knit') ||
    combined.includes('crochet') ||
    combined.includes('woodwork') ||
    cat === 'creative'
  ) {
    return 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=800&auto=format&fit=crop&q=80';
  }

  // 4. Books, Reading & Poetry
  if (
    combined.includes('book') ||
    combined.includes('reading') ||
    combined.includes('literature') ||
    combined.includes('poetry')
  ) {
    return 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=800&auto=format&fit=crop&q=80';
  }

  // 5. Food, Dining, Cooking & Baking
  if (
    combined.includes('dinner') ||
    combined.includes('dining') ||
    combined.includes('food') ||
    combined.includes('ramen') ||
    combined.includes('sushi') ||
    combined.includes('pasta') ||
    combined.includes('pizza') ||
    combined.includes('brunch') ||
    combined.includes('hawker') ||
    combined.includes('baking') ||
    combined.includes('cook') ||
    cat === 'dining'
  ) {
    return 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&auto=format&fit=crop&q=80';
  }

  // 6. Climbing & Bouldering
  if (combined.includes('boulder') || combined.includes('climb')) {
    return 'https://images.unsplash.com/photo-1522163182402-834f871fd851?w=800&auto=format&fit=crop&q=80';
  }

  // 7. Hiking, Walking, Nature & Cycling
  if (
    combined.includes('trail') ||
    combined.includes('hike') ||
    combined.includes('hiking') ||
    combined.includes('cycle') ||
    combined.includes('cycling') ||
    combined.includes('bike') ||
    combined.includes('ubin') ||
    combined.includes('botanic') ||
    combined.includes('park') ||
    combined.includes('walk')
  ) {
    return 'https://images.unsplash.com/photo-1541625602330-2277a4c46182?w=800&auto=format&fit=crop&q=80';
  }

  // 8. Art, Museums, Galleries & Exhibitions
  if (
    combined.includes('art') ||
    combined.includes('gallery') ||
    combined.includes('museum') ||
    combined.includes('exhibition') ||
    combined.includes('painting') ||
    cat === 'cultural'
  ) {
    return 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800&auto=format&fit=crop&q=80';
  }

  // 9. Vinyl, Music & Acoustic
  if (
    combined.includes('vinyl') ||
    combined.includes('music') ||
    combined.includes('jazz') ||
    combined.includes('acoustic') ||
    combined.includes('record')
  ) {
    return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80';
  }

  // 10. Nightlife, Drinks, Cocktails & Bars
  if (
    combined.includes('cocktail') ||
    combined.includes('wine') ||
    combined.includes('beer') ||
    combined.includes('brewery') ||
    combined.includes('bar') ||
    combined.includes('pub') ||
    combined.includes('saloon') ||
    cat === 'nightlife'
  ) {
    return 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&auto=format&fit=crop&q=80';
  }

  // 11. Active & Sports
  if (
    cat === 'active' ||
    combined.includes('active') ||
    combined.includes('workout') ||
    combined.includes('tennis') ||
    combined.includes('badminton')
  ) {
    return 'https://images.unsplash.com/photo-1541625602330-2277a4c46182?w=800&auto=format&fit=crop&q=80';
  }

  return 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=800&auto=format&fit=crop&q=80';
}

/**
 * Fetch outings the user is participating in (accepted or requested).
 * Propagates query errors so UI can render explicit error state.
 * Hard demo rule: if userId is present, never returns any demo item.
 */
export async function fetchGoingOutings(userId?: string): Promise<OutingItem[]> {
  const localPitches = getUserPitches();
  const localJoinedItems: OutingItem[] = localPitches
    .filter((p) => (p as any).state === 'accepted' || (p as any).state === 'requested')
    .filter((p) => !userId || !(p as any).isDemo)
    .map((p) => ({
      id: p.id,
      title: p.title,
      pitch: p.pitch,
      area: p.area,
      dateTime: p.dateTime,
      hostId: p.hostId || userId || 'user',
      hostName: p.hostName,
      hostAvatar: p.hostAvatar,
      isHostDemo: Boolean((p as any).isDemo || (p.hostId && p.hostId.startsWith('00000000-0000-0000-0000-'))),
      seatsTotal: p.seatsTotal,
      seatsFilled: p.seatsFilled,
      state: 'requested',
      category: (p as any).category,
      cover_image_url: p.cover_image_url,
      cover_image_thumb_url: p.cover_image_thumb_url,
      cover_image_alt: p.cover_image_alt,
      cover_photographer_name: p.cover_photographer_name,
      cover_photographer_url: p.cover_photographer_url,
      cover_download_location: p.cover_download_location,
    }));

  if (!checkIsSupabaseConfigured() || !userId) {
    return localJoinedItems;
  }

  const client = getSupabaseBrowserClient();
  const { data: memberRows, error } = await client
    .from('outing_members')
    .select(`
      outing_id,
      state,
      role,
      outings (
        id,
        host_id,
        title,
        pitch,
        activity_category,
        area,
        starts_at,
        max_participants,
        profiles!outings_host_id_fkey (display_name, avatar_url),
        outing_members (user_id, state)
      )
    `)
    .eq('user_id', userId)
    .in('state', ['accepted', 'requested']);

  if (error) {
    console.error('[SoulTribe] Supabase query error in fetchGoingOutings:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw new Error(`[Supabase ${error.code || 'ERROR'}] ${error.message}`);
  }

  const dbItems: OutingItem[] = (memberRows || [])
    .filter((row: any) => {
      const out = row.outings;
      if (!out) return false;
      const hostProfile = Array.isArray(out.profiles) ? out.profiles[0] : out.profiles;
      const isDemo = Boolean(
        (row as any).is_demo ||
        (out as any).is_demo ||
        (hostProfile as any)?.is_demo ||
        (out.host_id && String(out.host_id).startsWith('00000000-0000-0000-0000-'))
      );
      if (userId && isDemo) return false;
      return true;
    })
    .map((row: any) => {
      const out = row.outings;
      const hostProfile = Array.isArray(out.profiles) ? out.profiles[0] : out.profiles;
      const hostName = hostProfile?.display_name || '';
      const hostAvatar = hostProfile?.avatar_url || (hostName ? getGenderAvatarForName(hostName) : '');
      const members = Array.isArray(out.outing_members) ? out.outing_members : [];
      const seatsFilled = Math.max(1, members.filter((m: any) => m.state === 'accepted').length);
      const isHostDemo = Boolean(
        (hostProfile as any)?.is_demo ||
        (out as any).is_demo ||
        (out.host_id && String(out.host_id).startsWith('00000000-0000-0000-0000-'))
      );

      let dateTimeStr = '';
      if (out.starts_at) {
        const d = new Date(out.starts_at);
        if (!isNaN(d.getTime())) {
          dateTimeStr = d.toLocaleDateString('en-SG', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          });
        }
      }

      return {
        id: out.id,
        title: out.title,
        pitch: out.pitch || '',
        area: out.area || 'Singapore',
        category: out.activity_category || 'coffee',
        dateTime: dateTimeStr,
        startsAt: out.starts_at,
        durationMinutes: out.duration_minutes,
        outingState: out.state,
        hostId: out.host_id,
        hostName,
        hostAvatar,
        isHostDemo,
        seatsTotal: out.max_participants || 6,
        seatsFilled,
        state: row.state,
        cover_image_url: out.cover_image_url,
        cover_image_thumb_url: out.cover_image_thumb_url,
        cover_image_alt: out.cover_image_alt,
        cover_photographer_name: out.cover_photographer_name,
        cover_photographer_url: out.cover_photographer_url,
        cover_download_location: out.cover_download_location,
      };
    });

  // Also query outings hosted by the user where host_id = userId
  const { data: hostedOutings } = await client
    .from('outings')
    .select(`
      id,
      host_id,
      title,
      pitch,
      activity_category,
      area,
      starts_at,
      max_participants,
      profiles!outings_host_id_fkey (display_name, avatar_url),
      outing_members (user_id, state)
    `)
    .eq('host_id', userId);

  if (hostedOutings) {
    const dbItemIds = new Set(dbItems.map((i) => i.id));
    hostedOutings.forEach((out: any) => {
      if (!dbItemIds.has(out.id)) {
        const hostProfile = Array.isArray(out.profiles) ? out.profiles[0] : out.profiles;
        const isDemo = Boolean(
          (out as any).is_demo ||
          (hostProfile as any)?.is_demo ||
          (out.host_id && String(out.host_id).startsWith('00000000-0000-0000-0000-'))
        );
        if (userId && isDemo) return;

        const hostName = hostProfile?.display_name || '';
        const hostAvatar = hostProfile?.avatar_url || (hostName ? getGenderAvatarForName(hostName) : '');
        const members = Array.isArray(out.outing_members) ? out.outing_members : [];
        const seatsFilled = Math.max(1, members.filter((m: any) => m.state === 'accepted').length);
        const isHostDemo = Boolean(
          (hostProfile as any)?.is_demo ||
          (out as any).is_demo ||
          (out.host_id && String(out.host_id).startsWith('00000000-0000-0000-0000-'))
        );

        let dateTimeStr = '';
        if (out.starts_at) {
          const d = new Date(out.starts_at);
          if (!isNaN(d.getTime())) {
            dateTimeStr = d.toLocaleDateString('en-SG', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            });
          }
        }

        dbItems.push({
          id: out.id,
          title: out.title,
          pitch: out.pitch || '',
          area: out.area || 'Singapore',
          category: out.activity_category || 'coffee',
          dateTime: dateTimeStr,
          startsAt: out.starts_at,
        durationMinutes: out.duration_minutes,
        outingState: out.state,
          hostId: out.host_id,
          hostName,
          hostAvatar,
          isHostDemo,
          seatsTotal: out.max_participants || 6,
          seatsFilled,
          state: 'requested',
          cover_image_url: out.cover_image_url,
          cover_image_thumb_url: out.cover_image_thumb_url,
          cover_image_alt: out.cover_image_alt,
          cover_photographer_name: out.cover_photographer_name,
          cover_photographer_url: out.cover_photographer_url,
          cover_download_location: out.cover_download_location,
        });
      }
    });
  }

  const dbIds = new Set(dbItems.map((i) => i.id));
  const uniqueLocalJoined = localJoinedItems.filter((i) => !dbIds.has(i.id));

  return [...dbItems, ...uniqueLocalJoined];
}

/**
 * Fetch outings the user has been invited to (state = 'invited').
 * Propagates query errors so UI can render explicit error state.
 * Hard demo rule: if userId is missing, returns []. Never falls back to local or default list.
 */
export async function fetchInvitedOutings(userId?: string): Promise<OutingItem[]> {
  if (!checkIsSupabaseConfigured() || !userId) {
    return [];
  }

  const client = getSupabaseBrowserClient();
  const { data: memberRows, error } = await client
    .from('outing_members')
    .select(`
      outing_id,
      state,
      role,
      outings (
        id,
        host_id,
        title,
        pitch,
        activity_category,
        area,
        starts_at,
        max_participants,
        profiles!outings_host_id_fkey (display_name, avatar_url),
        outing_members (user_id, state)
      )
    `)
    .eq('user_id', userId)
    .eq('state', 'invited');

  if (error) {
    console.error('[SoulTribe] Supabase query error in fetchInvitedOutings:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw new Error(`[Supabase ${error.code || 'ERROR'}] ${error.message}`);
  }

  if (!memberRows || memberRows.length === 0) {
    return [];
  }

  return (memberRows || [])
    .filter((row: any) => {
      const out = row.outings;
      if (!out) return false;
      const hostProfile = Array.isArray(out.profiles) ? out.profiles[0] : out.profiles;
      const isDemo = Boolean(
        (row as any).is_demo ||
        (out as any).is_demo ||
        (hostProfile as any)?.is_demo ||
        (out.host_id && String(out.host_id).startsWith('00000000-0000-0000-0000-'))
      );
      if (isDemo) return false;
      return true;
    })
    .map((row: any) => {
      const out = row.outings;
      const hostProfile = Array.isArray(out.profiles) ? out.profiles[0] : out.profiles;
      const hostName = hostProfile?.display_name || '';
      const hostAvatar = hostProfile?.avatar_url || '';
      const members = Array.isArray(out.outing_members) ? out.outing_members : [];
      const seatsFilled = Math.max(1, members.filter((m: any) => m.state === 'accepted').length);
      const isHostDemo = Boolean(
        (hostProfile as any)?.is_demo ||
        (out as any).is_demo ||
        (out.host_id && String(out.host_id).startsWith('00000000-0000-0000-0000-'))
      );

      let dateTimeStr = '';
      if (out.starts_at) {
        const d = new Date(out.starts_at);
        if (!isNaN(d.getTime())) {
          dateTimeStr = d.toLocaleDateString('en-SG', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          });
        }
      }

      return {
        id: out.id,
        title: out.title,
        pitch: out.pitch || '',
        area: out.area || 'Singapore',
        category: out.activity_category || 'coffee',
        dateTime: dateTimeStr,
        startsAt: out.starts_at,
        durationMinutes: out.duration_minutes,
        outingState: out.state,
        hostId: out.host_id,
        hostName,
        hostAvatar,
        isHostDemo,
        seatsTotal: out.max_participants || 6,
        seatsFilled,
        state: 'invited',
        cover_image_url: out.cover_image_url,
        cover_image_thumb_url: out.cover_image_thumb_url,
        cover_image_alt: out.cover_image_alt,
        cover_photographer_name: out.cover_photographer_name,
        cover_photographer_url: out.cover_photographer_url,
        cover_download_location: out.cover_download_location,
      };
    });
}

export async function acceptInvite(outingId: string, userId: string): Promise<void> {
  if (!checkIsSupabaseConfigured() || !userId || !outingId) return;
  const client = getSupabaseBrowserClient();
  const { error } = await client
    .from('outing_members')
    .update({ state: 'accepted', responded_at: new Date().toISOString() })
    .eq('outing_id', outingId)
    .eq('user_id', userId);

  if (error) {
    console.error('[SoulTribe] Failed to accept invitation:', error);
    throw new Error(`[Supabase ${error.code || 'ERROR'}] ${error.message}`);
  }
}

export async function declineInvite(outingId: string, userId: string): Promise<void> {
  if (!checkIsSupabaseConfigured() || !userId || !outingId) return;
  const client = getSupabaseBrowserClient();
  const { error } = await client
    .from('outing_members')
    .update({ state: 'declined', responded_at: new Date().toISOString() })
    .eq('outing_id', outingId)
    .eq('user_id', userId);

  if (error) {
    console.error('[SoulTribe] Failed to decline invitation:', error);
    throw new Error(`[Supabase ${error.code || 'ERROR'}] ${error.message}`);
  }
}

export const RADAR_LIMIT = 50;

/**
 * Fetch open outings for "On Your Radar".
 * Propagates query errors so UI can render explicit error state.
 * Hard demo rule: if userId is present, never returns any demo item.
 */
export async function fetchRadarOutings(userId?: string): Promise<OutingItem[]> {
  if (!checkIsSupabaseConfigured() || !userId) {
    return [];
  }

  const client = getSupabaseBrowserClient();
  const { data: outingRows, error } = await client
    .from('active_pitches')
    .select(`
      id,
      host_id,
      title,
      pitch,
      activity_category,
      area,
      starts_at,
      duration_minutes,
      max_participants,
      visibility,
      state,
      is_demo,
      cover_image_url,
      cover_image_thumb_url,
      cover_image_alt,
      cover_photographer_name,
      cover_photographer_url,
      cover_download_location
    `)
    .order('starts_at')
    .limit(RADAR_LIMIT);

  if (error) {
    console.error('[SoulTribe] Supabase query error in fetchRadarOutings:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw new Error(`[Supabase ${error.code || 'ERROR'}] ${error.message}`);
  }

  if (!outingRows || outingRows.length === 0) {
    return [];
  }

  const outingIds = outingRows.map((out: { id: string }) => out.id);
  const hostIds = [...new Set(outingRows.map((out: { host_id: string }) => out.host_id).filter(Boolean))];
  const [{ data: hostRows, error: hostError }, { data: memberRows, error: memberError }] = await Promise.all([
    hostIds.length
      ? client.from('profiles').select('id, display_name, avatar_url, is_demo').in('id', hostIds)
      : Promise.resolve({ data: [], error: null }),
    outingIds.length
      ? client.from('outing_members').select('outing_id, user_id, state').in('outing_id', outingIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (hostError) {
    console.error('[SoulTribe] Supabase query error in fetchRadarOutings:', {
      code: hostError.code,
      message: hostError.message,
      details: hostError.details,
      hint: hostError.hint,
    });
    throw new Error(`[Supabase ${hostError.code || 'ERROR'}] ${hostError.message}`);
  }
  if (memberError) {
    console.error('[SoulTribe] Supabase query error in fetchRadarOutings:', {
      code: memberError.code,
      message: memberError.message,
      details: memberError.details,
      hint: memberError.hint,
    });
    throw new Error(`[Supabase ${memberError.code || 'ERROR'}] ${memberError.message}`);
  }
  const hosts = new Map((hostRows ?? []).map((row: { id: string }) => [row.id, row]));
  const membersByOuting = new Map<string, { user_id: string; state: string }[]>();
  for (const row of memberRows ?? []) {
    const list = membersByOuting.get(row.outing_id) ?? [];
    list.push(row);
    membersByOuting.set(row.outing_id, list);
  }

  // Hard demo rule: filter out own outings AND any demo outings
  const filteredRows = outingRows.filter((out: { host_id: string; is_demo?: boolean }) => {
    if (out.host_id === userId) return false;
    const hostProfile = hosts.get(out.host_id) as { is_demo?: boolean } | undefined;
    const isDemo = Boolean(out.is_demo || hostProfile?.is_demo);
    if (userId && isDemo) return false;
    return true;
  });

  return filteredRows.map((out: {
    id: string; title: string; pitch?: string; area?: string; activity_category?: string;
    starts_at?: string; duration_minutes?: number; state?: string; host_id: string;
    max_participants?: number; cover_image_url?: string; cover_image_thumb_url?: string;
    cover_image_alt?: string; cover_photographer_name?: string; cover_photographer_url?: string;
    cover_download_location?: string; is_demo?: boolean;
  }) => {
    const hostProfile = hosts.get(out.host_id) as { display_name?: string; avatar_url?: string; is_demo?: boolean } | undefined;
    const hostName = hostProfile?.display_name || '';
    const hostAvatar = hostProfile?.avatar_url || (hostName ? getGenderAvatarForName(hostName) : '');
    const members = membersByOuting.get(out.id) ?? [];
    const seatsFilled = members.filter((m) => m.state === 'accepted').length;
    const isHostDemo = Boolean(hostProfile?.is_demo || out.is_demo);

    let dateTimeStr = '';
    if (out.starts_at) {
      const d = new Date(out.starts_at);
      if (!isNaN(d.getTime())) {
        dateTimeStr = d.toLocaleDateString('en-SG', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        });
      }
    }

    return {
      id: out.id,
      title: out.title,
      pitch: out.pitch || '',
      area: out.area || 'Singapore',
      category: out.activity_category || 'coffee',
      dateTime: dateTimeStr,
      startsAt: out.starts_at,
        durationMinutes: out.duration_minutes,
        outingState: out.state,
      hostId: out.host_id,
      hostName,
      hostAvatar,
      isHostDemo,
      seatsTotal: out.max_participants || 6,
      seatsFilled,
      cover_image_url: out.cover_image_url,
      cover_image_thumb_url: out.cover_image_thumb_url,
      cover_image_alt: out.cover_image_alt,
      cover_photographer_name: out.cover_photographer_name,
      cover_photographer_url: out.cover_photographer_url,
      cover_download_location: out.cover_download_location,
      fitBadge: undefined,
    };
  });
}

/**
 * Fetch pitches hosted by the user.
 * Propagates query errors so UI can render explicit error state.
 * Hard demo rule: if userId is present, never returns any demo item.
 */
export async function fetchUserPitches(userId?: string): Promise<OutingItem[]> {
  const localPitches = getUserPitches();
  const localItems: OutingItem[] = localPitches
    .filter((p) => !userId || !(p as any).isDemo)
    .map((p) => ({
      id: p.id,
      title: p.title,
      pitch: p.pitch,
      area: p.area,
      dateTime: p.dateTime,
      hostId: userId || 'user',
      hostName: p.hostName,
      hostAvatar: p.hostAvatar,
      isHostDemo: Boolean((p as any).isDemo || (p.hostId && p.hostId.startsWith('00000000-0000-0000-0000-'))),
      seatsTotal: p.seatsTotal,
      seatsFilled: p.seatsFilled,
      category: (p as any).category,
      cover_image_url: p.cover_image_url,
      cover_image_thumb_url: p.cover_image_thumb_url,
      cover_image_alt: p.cover_image_alt,
      cover_photographer_name: p.cover_photographer_name,
      cover_photographer_url: p.cover_photographer_url,
      cover_download_location: p.cover_download_location,
    }));

  if (!checkIsSupabaseConfigured() || !userId) {
    return localItems;
  }

  const client = getSupabaseBrowserClient();
  const { data: dbOutings, error } = await client
    .from('outings')
    .select(`
      id,
      host_id,
      title,
      pitch,
      activity_category,
      area,
      starts_at,
      max_participants,
      visibility,
      state,
      profiles!outings_host_id_fkey (display_name, avatar_url),
      outing_members (user_id, state)
    `)
    .eq('host_id', userId);

  if (error) {
    console.error('[SoulTribe] Supabase query error in fetchUserPitches:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw new Error(`[Supabase ${error.code || 'ERROR'}] ${error.message}`);
  }

  if (!dbOutings || dbOutings.length === 0) {
    return localItems;
  }

  const dbItems: OutingItem[] = (dbOutings || [])
    .filter((out: any) => {
      const hostProfile = Array.isArray(out.profiles) ? out.profiles[0] : out.profiles;
      const isDemo = Boolean(
        (out as any).is_demo ||
        (hostProfile as any)?.is_demo ||
        (out.host_id && String(out.host_id).startsWith('00000000-0000-0000-0000-'))
      );
      if (userId && isDemo) return false;
      return true;
    })
    .map((out: any) => {
      const hostProfile = Array.isArray(out.profiles) ? out.profiles[0] : out.profiles;
      const hostName = hostProfile?.display_name || '';
      const hostAvatar = hostProfile?.avatar_url || (hostName ? getGenderAvatarForName(hostName) : '');
      const members = Array.isArray(out.outing_members) ? out.outing_members : [];
      const seatsFilled = Math.max(1, members.filter((m: any) => m.state === 'accepted').length);
      const isHostDemo = Boolean(
        (hostProfile as any)?.is_demo ||
        (out as any).is_demo ||
        (out.host_id && String(out.host_id).startsWith('00000000-0000-0000-0000-'))
      );

      let dateTimeStr = '';
      if (out.starts_at) {
        const d = new Date(out.starts_at);
        if (!isNaN(d.getTime())) {
          dateTimeStr = d.toLocaleDateString('en-SG', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          });
        }
      }

      return {
        id: out.id,
        title: out.title,
        pitch: out.pitch || '',
        area: out.area || 'Singapore',
        category: out.activity_category || 'coffee',
        dateTime: dateTimeStr,
        startsAt: out.starts_at,
        durationMinutes: out.duration_minutes,
        outingState: out.state,
        hostId: out.host_id,
        hostName,
        hostAvatar,
        isHostDemo,
        seatsTotal: out.max_participants || 6,
        seatsFilled,
        cover_image_url: out.cover_image_url,
        cover_image_thumb_url: out.cover_image_thumb_url,
        cover_image_alt: out.cover_image_alt,
        cover_photographer_name: out.cover_photographer_name,
        cover_photographer_url: out.cover_photographer_url,
        cover_download_location: out.cover_download_location,
      };
    });

  const dbIds = new Set(dbItems.map((i) => i.id));
  const uniqueLocal = localItems.filter((i) => !dbIds.has(i.id));

  return [...dbItems, ...uniqueLocal];
}
