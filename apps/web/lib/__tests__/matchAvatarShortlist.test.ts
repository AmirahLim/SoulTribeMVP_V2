import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getGenderAvatarForName } from '@soul-tribe/core';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/matches/route';
import { explanationInputHash } from '../matchExplanationCache';
import { toProfileVector } from '../profileAdapter';

const avatarState = vi.hoisted(() => ({
  photoDataUri: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==',
  profileSelects: [] as string[],
  candidateIdsRequested: [] as string[][],
  avatarIdsRequested: [] as string[][],
  failAvatarFetch: false,
  fillerCount: 3,
}));

vi.mock('@supabase/supabase-js', () => {
  const traitRows = (id: string) => ({
    trait_intent: [{ user_id: id, intents: ['friendship'], answered: 5 }],
    trait_communication: [{ user_id: id, mediums: ['text'], conv_styles: ['deep'], answered: 10 }],
    trait_personality: [{ user_id: id, extraversion: 0.5, answered: 8 }],
    trait_social_rhythm: [{ user_id: id, availability: ['sat_midday'], answered: 6 }],
    trait_emotional: [{ user_id: id, er_opening_pace: 0.5, answered: 6 }],
    trait_experience: [{ user_id: id, group_size_pref: 0.5, answered: 4 }],
    trait_lifestyle: [{ user_id: id, answered: 5 }],
    trait_geography: [{ user_id: id, home_area: 'Singapore', answered: 2 }],
    user_interests: [{ node_name: 'Coffee & Cafes' }],
    user_values: [{ value_key: 'Authenticity' }],
  });
  const member = (id: string, display_name: string, avatar_url: string | null) => ({
    id, display_name, avatar_url, home_area: 'Singapore', bio: `${display_name} bio`,
    birth_year: 1994, status: 'active', profile_version: 1, explanation_revision: 0,
    life_contexts: [], public_onboarding: {}, ...traitRows(id),
  });
  const candidateIds = () => ['cand-photo', 'cand-null',
    ...Array.from({ length: avatarState.fillerCount }, (_, i) => `cand-filler-${i}`)];
  const allRows = () => [
    member('viewer-1', 'Viewer', 'https://example.com/viewer.jpg'),
    member('cand-photo', 'Priya Sharma', avatarState.photoDataUri),
    member('cand-null', 'Sarah Lim', null),
    ...Array.from({ length: avatarState.fillerCount }, (_, i) =>
      member(`cand-filler-${i}`, `Filler ${i}`, `https://example.com/filler-${i}.jpg`)),
  ];
  // The database only returns the columns a query asks for. Mirroring that is what
  // makes these tests prove the route cannot read an avatar it did not select.
  const project = (row: Record<string, unknown>, selection: string) => {
    if (selection.includes('avatar_url')) return row;
    const { avatar_url: _dropped, ...rest } = row;
    return rest;
  };
  return {
    createClient: vi.fn(() => ({
      rpc: async (name: string) => {
        if (name === 'filter_local_area_ids') return { data: [], error: null };
        if (name !== 'filter_local_online_ids') return { data: null, error: { code: 'PGRST202', message: 'unknown rpc' } };
        return { data: candidateIds().map((user_id) => ({ user_id })), error: null };
      },
      auth: {
        getUser: vi.fn(async (token: string) => token === 'valid_token'
          ? { data: { user: { id: 'viewer-1' } }, error: null }
          : { data: { user: null }, error: new Error('Invalid token') }),
      },
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: (selection: string) => {
              avatarState.profileSelects.push(selection);
              const isCandidateSelect = selection.includes('trait_intent');
              const isAvatarSelect = !isCandidateSelect && selection.includes('avatar_url');
              const q: Record<string, unknown> = {
                in: async (_key: string, ids: string[]) => {
                  if (isAvatarSelect) {
                    avatarState.avatarIdsRequested.push([...ids]);
                    if (avatarState.failAvatarFetch)
                      return { data: null, error: { code: 'PGRST301', message: 'avatar column unavailable' } };
                    return { data: allRows().filter((row) => ids.includes(row.id))
                      .map((row) => ({ id: row.id, avatar_url: row.avatar_url })), error: null };
                  }
                  if (isCandidateSelect) avatarState.candidateIdsRequested.push([...ids]);
                  return { data: allRows().filter((row) => ids.includes(row.id))
                    .map((row) => project(row, selection)), error: null };
                },
                eq: () => q,
                maybeSingle: async () => ({
                  data: project(allRows()[0], selection), error: null,
                }),
              };
              return q;
            },
          };
        }
        if (table === 'blocks' || table === 'reports')
          return { select: () => ({ or: async () => ({ data: [], error: null }) }) };
        if (table === 'read_answer_sources')
          return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
        if (table === 'match_explanations') return {
          select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }),
          upsert: async () => ({ error: null }),
        };
        if (table === 'profile_answers') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { onboarding: {} }, error: null }) }) }),
        };
        if (table === 'recommendation_preferences') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        };
        if (table === 'interaction_events') return { insert: async () => ({ error: null }) };
        if (table === 'match_scores') {
          const q: Record<string, unknown> = {
            select: () => q,
            eq: () => q,
            in: async () => ({ data: [], error: null }),
            upsert: async () => ({ error: null }),
          };
          return q;
        }
        return { select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
      },
    })),
  };
});

function matchRequest(limit: number) {
  return new NextRequest('http://localhost/api/matches', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid_token' },
    body: JSON.stringify({ limit, radiusMeters: 10000 }),
  });
}

describe('Candidate avatars are loaded only for the shortlist', () => {
  const oldEnv = process.env;

  beforeEach(() => {
    avatarState.profileSelects = [];
    avatarState.candidateIdsRequested = [];
    avatarState.avatarIdsRequested = [];
    avatarState.failAvatarFetch = false;
    avatarState.fillerCount = 3;
    process.env = {
      ...oldEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      SUPABASE_SECRET_KEY: 'secret_key_test',
    };
    vi.restoreAllMocks();
  });

  it('never asks the candidate query for avatar_url', async () => {
    const res = await POST(matchRequest(10));
    expect(res.status).toBe(200);

    const candidateSelect = avatarState.profileSelects.find((sel) => sel.includes('trait_intent'));
    expect(candidateSelect).toBeDefined();
    expect(candidateSelect).not.toContain('avatar_url');
  });

  it('fetches one avatar row per returned match, not per candidate scored', async () => {
    avatarState.fillerCount = 8;
    const res = await POST(matchRequest(3));
    expect(res.status).toBe(200);
    const json: { id: string }[] = await res.json();

    expect(json).toHaveLength(3);
    expect(res.headers.get('X-Match-Eligible')).toBe('10');
    expect(avatarState.candidateIdsRequested[0]).toHaveLength(11);
    expect(avatarState.avatarIdsRequested).toHaveLength(1);
    expect([...avatarState.avatarIdsRequested[0]].sort())
      .toEqual(json.map((match) => match.id).sort());
  });

  it('keeps a stored photo byte-identical and still places the name-based fallback', async () => {
    const res = await POST(matchRequest(10));
    expect(res.status).toBe(200);
    const json: { id: string; avatarUrl: string }[] = await res.json();

    const withPhoto = json.find((match) => match.id === 'cand-photo')!;
    const withoutPhoto = json.find((match) => match.id === 'cand-null')!;
    expect(withPhoto.avatarUrl).toBe(avatarState.photoDataUri);
    expect(Buffer.byteLength(withPhoto.avatarUrl))
      .toBe(Buffer.byteLength(avatarState.photoDataUri));
    expect(withoutPhoto.avatarUrl).toBe(getGenderAvatarForName('Sarah Lim'));
  });

  it('returns 200 with the full match list when the avatar fetch fails', async () => {
    avatarState.failAvatarFetch = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(matchRequest(10));
    expect(res.status).toBe(200);
    const json: { id: string; name: string; avatarUrl: string }[] = await res.json();

    expect(json).toHaveLength(5);
    expect(avatarState.avatarIdsRequested).toHaveLength(1);
    for (const match of json) expect(match.avatarUrl).toBe(getGenderAvatarForName(match.name));
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('Explanation cache keys ignore profile photos', () => {
  const baseAnswers = {
    homeArea: 'Singapore',
    birthYear: 1994,
    trait_personality: { extraversion: 0.5, answered: 10 },
    trait_communication: { mediums: ['text'], conv_styles: ['deep'], answered: 10 },
    trait_social_rhythm: { availability: ['sat_midday'], answered: 6 },
    trait_intent: { intents: ['friendship'], answered: 5 },
    trait_emotional: { er_opening_pace: 0.5, answered: 6 },
    trait_experience: { group_size_pref: 0.5, answered: 4 },
    trait_lifestyle: { answered: 5 },
    trait_geography: { answered: 2 },
  };

  it('produces one hash for two vectors differing only in avatar_url', () => {
    const viewer = toProfileVector({ ...baseAnswers, displayName: 'Viewer', id: 'viewer-1' } as never);
    const candidate = (avatarUrl?: string) => toProfileVector({
      ...baseAnswers, displayName: 'Priya Sharma', id: 'cand-photo', avatarUrl,
    } as never);

    const firstPhoto = candidate('data:image/png;base64,AAAA');
    const secondPhoto = candidate('data:image/png;base64,BBBB');
    const noPhoto = candidate();

    expect(firstPhoto.profile.avatar_url).not.toBe(secondPhoto.profile.avatar_url);
    expect(explanationInputHash(viewer, firstPhoto)).toBe(explanationInputHash(viewer, secondPhoto));
    expect(explanationInputHash(viewer, noPhoto)).toBe(explanationInputHash(viewer, firstPhoto));
  });
});
