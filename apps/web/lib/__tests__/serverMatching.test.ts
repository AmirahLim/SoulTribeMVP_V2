import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toProfileVector } from '../profileAdapter';
import { getRankedMatches, RankedMatch } from '../matching';
import { POST } from '../../app/api/matches/route';
import { NextRequest } from 'next/server';
import { evaluateGates } from '@soul-tribe/core';
const cacheTestState=vi.hoisted(()=>({extra:0,writes:[] as any[],rpcIds:null as string[] | null,calls:[] as string[]}));

vi.mock('../supabase', () => ({
  checkIsSupabaseConfigured: () => true,
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'valid_token', user: { id: 'viewer-1' } } },
      }),
    },
  }),
}));

// Mock Supabase client module for server route testing
vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn((url: string, key: string) => {
      const isAnonKey = key.startsWith('sb_publishable') || key.includes('anon');
      return {
        rpc: async (name: string) => {
          cacheTestState.calls.push(`rpc:${name}:${isAnonKey ? 'user' : 'admin'}`);
          if (name !== 'filter_local_online_ids') return { data: null, error: new Error('unknown rpc') };
          if (cacheTestState.rpcIds) return { data: cacheTestState.rpcIds.map((user_id: string) => ({ user_id })), error: null };
          const ids = ['candidate-alice', 'blocked-user-99', ...Array.from({ length: cacheTestState.extra }, (_, i) => 'extra-candidate-' + i)];
          return { data: ids.map((user_id) => ({ user_id })), error: null };
        },
        auth: {
          getUser: vi.fn(async (token: string) => {
            if (token === 'valid_token') {
              return { data: { user: { id: 'viewer-1' } }, error: null };
            }
            return { data: { user: null }, error: new Error('Invalid token') };
          }),
          getSession: vi.fn(async () => ({
            data: { session: { access_token: 'valid_token', user: { id: 'viewer-1' } } },
          })),
        },
        from: (table: string) => {
          if(table==='read_answer_sources')return {select:()=>({in:async()=>({data:[],error:null})})};
          if (table === 'match_explanations') return {
            select:()=>({eq:()=>({in:async()=>({data:[],error:null})})}),
            upsert:async(rows:any[])=>{cacheTestState.writes.push(...rows);return {error:null};},
          };
          if (table === 'blocks') {
            return {
              select: () => ({
                or: async () => ({
                  data: [
                    { blocker_id: 'viewer-1', blocked_id: 'blocked-user-99' },
                  ],
                  error: null,
                }),
              }),
            };
          }
          if (table === 'reports') {
            return {
              select: () => ({
                or: async () => ({
                  data: [],
                  error: null,
                }),
              }),
            };
          }
          if (table === 'profiles') {
            cacheTestState.calls.push('profiles');
            let rows: any[] = [
                      {
                        id: 'viewer-1',
                        display_name: 'Viewer',
                        avatar_url: 'https://example.com/viewer.jpg',
                        home_area: 'Singapore',
                        bio: 'Viewer bio',
                        birth_year: 1995,
                        status: 'active',
                        trait_intent: [{ user_id: 'viewer-1', intents: ['friendship'], answered: 5 }],
                        trait_communication: [{ user_id: 'viewer-1', mediums: ['text'], conv_styles: ['deep'], answered: 10 }],
                        trait_personality: [{ user_id: 'viewer-1', extraversion: 0.5, answered: 8 }],
                        trait_social_rhythm: [{ user_id: 'viewer-1', availability: ['sat_midday'], answered: 6 }],
                        trait_emotional: [{ user_id: 'viewer-1', er_opening_pace: 0.5, answered: 6 }],
                        trait_experience: [{ user_id: 'viewer-1', group_size_pref: 0.5, answered: 4 }],
                        trait_lifestyle: [{ user_id: 'viewer-1', answered: 5 }],
                        trait_geography: [{ user_id: 'viewer-1', home_area: 'Singapore', answered: 2 }],
                        user_interests: [{ node_name: 'Coffee & Cafes' }],
                        user_values: [{ value_key: 'Authenticity' }],
                      },
                      {
                        id: 'candidate-alice',
                        display_name: 'Alice',
                        avatar_url: 'https://example.com/alice.jpg',
                        home_area: 'Tiong Bahru',
                        bio: 'Alice bio',
                        birth_year: 1994,
                        status: 'active',
                        trait_intent: [{ user_id: 'candidate-alice', intents: ['friendship'], answered: 5 }],
                        trait_communication: [{ user_id: 'candidate-alice', mediums: ['text'], conv_styles: ['deep'], answered: 10 }],
                        trait_personality: [{ user_id: 'candidate-alice', extraversion: 0.9, answered: 8 }],
                        trait_social_rhythm: [{ user_id: 'candidate-alice', availability: ['sat_midday'], answered: 6 }],
                        trait_emotional: [{ user_id: 'candidate-alice', er_opening_pace: 0.8, answered: 6 }],
                        trait_experience: [{ user_id: 'candidate-alice', group_size_pref: 0.4, answered: 4 }],
                        trait_lifestyle: [{ user_id: 'candidate-alice', answered: 5 }],
                        trait_geography: [{ user_id: 'candidate-alice', home_area: 'Tiong Bahru', answered: 2 }],
                        user_interests: [{ node_name: 'Coffee & Cafes' }],
                        user_values: [{ value_key: 'Authenticity' }],
                      },
                      {
                        id: 'blocked-user-99',
                        display_name: 'Blocked Person',
                        avatar_url: 'https://example.com/blocked.jpg',
                        home_area: 'Singapore',
                        bio: 'Blocked user bio',
                        birth_year: 1995,
                        status: 'active',
                        trait_intent: [{ user_id: 'blocked-user-99', intents: ['friendship'], answered: 5 }],
                        trait_communication: [{ user_id: 'blocked-user-99', mediums: ['text'], conv_styles: ['deep'], answered: 10 }],
                        trait_personality: [{ user_id: 'blocked-user-99', extraversion: 0.5, answered: 8 }],
                        trait_social_rhythm: [{ user_id: 'blocked-user-99', availability: ['sat_midday'], answered: 6 }],
                        trait_emotional: [{ user_id: 'blocked-user-99', er_opening_pace: 0.5, answered: 6 }],
                        trait_experience: [{ user_id: 'blocked-user-99', group_size_pref: 0.5, answered: 4 }],
                        trait_lifestyle: [{ user_id: 'blocked-user-99', answered: 5 }],
                        trait_geography: [{ user_id: 'blocked-user-99', home_area: 'Singapore', answered: 2 }],
                        user_interests: [{ node_name: 'Coffee & Cafes' }],
                        user_values: [{ value_key: 'Authenticity' }],
                      },
                    ];
            rows.push(...Array.from({length:cacheTestState.extra},(_,i)=>({...rows[1],id:'extra-candidate-'+i})));
            const q: any = {
              in: async (_key:string,ids:string[])=>({data:rows.filter(r=>ids.includes(r.id)).map(r=>({...r,profile_version:1,explanation_revision:0})),error:null}),
              eq: (key: string, value: any) => { rows = rows.filter(r => r[key] === value).map(r=>({...r,profile_version:1,explanation_revision:0})); return q; },
              limit: async () => ({ data: rows, error: null }),
              maybeSingle: async () => ({ data: rows[0] || null, error: null }),
            };
            return { select: () => q };
          }
          if (table === 'recommendation_preferences') return { select: () => ({eq: () => ({maybeSingle: async () => ({data:null,error:null})})}) };
          if (table === 'interaction_events') return { insert: async () => ({error:null}) };
          return {
            select: () => ({
              eq: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          };
        },
      };
    }),
  };
});

describe('Server-Side Matching & Privacy Protections (Step 6b)', () => {
  const oldEnv = process.env;

  beforeEach(() => {
    cacheTestState.extra=0;cacheTestState.writes=[];cacheTestState.rpcIds=null;cacheTestState.calls=[];
    process.env = {
      ...oldEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      SUPABASE_SECRET_KEY: 'secret_key_test',
    };
    vi.restoreAllMocks();
  });

  it('1. Server scores and clickText are preserved end-to-end without client re-scoring', async () => {
    const mockMatches: RankedMatch[] = [
      {
        id: 'candidate-alice',
        name: 'Alice',
        avatarUrl: 'https://example.com/alice.jpg',
        homeArea: 'Tiong Bahru',
        bio: 'Alice bio',
        rankScore: 0.89,
        resonance: 0.91,
        logistics: 0.85,
        clickText: 'Unique alignment on slow weekend coffee rituals with Alice.',
        rubText: 'Slight difference in conversation style preference.',
        fitLabel: 'Strong Resonance',
        provisional: false,
        isDemo: false,
      },
      {
        id: 'candidate-bob',
        name: 'Bob',
        avatarUrl: 'https://example.com/bob.jpg',
        homeArea: 'Katong',
        bio: 'Bob bio',
        rankScore: 0.74,
        resonance: 0.76,
        logistics: 0.70,
        clickText: 'Shared appreciation for analog photography and trail running with Bob.',
        rubText: 'Different social planning horizons.',
        fitLabel: 'Natural Resonance',
        provisional: false,
        isDemo: false,
      },
    ];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (typeof url === 'string' && url.includes('/api/matches')) {
        return new Response(JSON.stringify(mockMatches), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const viewerUser = { id: 'viewer-1', displayName: 'Viewer', homeArea: 'Singapore', avatarUrl: '', bio: '', passCompletionPct: 80 };
    const results = await getRankedMatches(viewerUser, { userId: 'viewer-1' });

    expect(results).toHaveLength(2);
    expect(results[0].rankScore).toBe(0.89);
    expect(results[0].clickText).toBe('Unique alignment on slow weekend coffee rituals with Alice.');
    expect(results[0].homeArea).toBe('Tiong Bahru');

    expect(results[1].rankScore).toBe(0.74);
    expect(results[1].clickText).toBe('Shared appreciation for analog photography and trail running with Bob.');
    expect(results[1].homeArea).toBe('Katong');

    fetchSpy.mockRestore();
  });

  it("2. The route's real response carries no private trait data at any nesting depth", async () => {
    const req = new NextRequest('http://localhost/api/matches', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid_token' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);

    const forbiddenKeys = [
      'trait_intent',
      'trait_personality',
      'trait_social_rhythm',
      'trait_emotional',
      'trait_lifestyle',
      'trait_experience',
      'trait_geography',
      'answered',
      'availability',
      'dealbreakers',
      'user_interests',
      'user_values',
    ];

    function checkNoForbiddenKeys(obj: any) {
      if (!obj || typeof obj !== 'object') return;
      for (const key of Object.keys(obj)) {
        for (const forbidden of forbiddenKeys) {
          expect(key).not.toBe(forbidden);
        }
        if (typeof obj[key] === 'object') {
          checkNoForbiddenKeys(obj[key]);
        }
      }
    }

    checkNoForbiddenKeys(json);
  });

  it('3. No fabrication: Profile row with no trait rows yields answered: 0 and lower confidence', () => {
    const thinProfile = toProfileVector({
      displayName: 'Unonboarded Member',
      id: 'thin-1',
    } as any);

    const fullProfile = toProfileVector({
      displayName: 'Full Member',
      id: 'full-1',
      trait_personality: { answered: 10 },
      trait_communication: { answered: 10 },
      trait_social_rhythm: { answered: 6 },
      trait_intent: { answered: 5 },
      trait_emotional: { answered: 6 },
      trait_lifestyle: { answered: 5 },
      trait_experience: { answered: 4 },
      trait_geography: { answered: 2 },
    } as any);

    expect(thinProfile.personality?.answered ?? 0).toBe(0);
    expect(thinProfile.communication?.answered ?? 0).toBe(0);
    expect(thinProfile.social_rhythm?.answered ?? 0).toBe(0);
    expect(thinProfile.intent?.answered ?? 0).toBe(0);
    expect(thinProfile.emotional?.answered ?? 0).toBe(0);
    expect(thinProfile.lifestyle?.answered ?? 0).toBe(0);
    expect(thinProfile.experience?.answered ?? 0).toBe(0);

    expect(thinProfile.communication?.mediums ?? []).toHaveLength(0);
    expect(thinProfile.communication?.conv_styles ?? []).toHaveLength(0);
    expect(thinProfile.intent?.intents ?? []).toHaveLength(0);
    expect(thinProfile.experience?.settings ?? []).toHaveLength(0);

    expect(thinProfile.profile.confidence).toBeLessThan(fullProfile.profile.confidence);
  });

  it('4. Blocked users are excluded from the route response', async () => {
    const req = new NextRequest('http://localhost/api/matches', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid_token' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json: RankedMatch[] = await res.json();
    const blockedFound = json.some((m) => m.id === 'blocked-user-99');
    expect(blockedFound).toBe(false);
  });

  it('5. Request to /api/matches with no session returns 401', async () => {
    const req = new NextRequest('http://localhost/api/matches', {
      method: 'POST',
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('6. A missing birth_year does not pass the age gate', () => {
    const viewerVec = toProfileVector({
      displayName: 'Viewer',
      id: 'v1',
      birthYear: 1995,
      agePrefMin: 20,
      agePrefMax: 40,
      trait_personality: { extraversion: 0.5, answered: 10 },
      trait_communication: { mediums: ['text'], conv_styles: ['deep'], answered: 10 },
      trait_social_rhythm: { availability: ['sat_midday'], answered: 6 },
      trait_intent: { intents: ['friendship'], answered: 5 },
      trait_emotional: { er_opening_pace: 0.5, answered: 6 },
      trait_experience: { group_size_pref: 0.5, answered: 4 },
      trait_lifestyle: { answered: 5 },
      trait_geography: { answered: 2 },
    } as any);

    const candidateWithoutBirthYear = toProfileVector({
      displayName: 'Candidate No Age',
      id: 'c-no-age',
      birth_year: 0,
      trait_personality: { extraversion: 0.5, answered: 10 },
      trait_communication: { mediums: ['text'], conv_styles: ['deep'], answered: 10 },
      trait_social_rhythm: { availability: ['sat_midday'], answered: 6 },
      trait_intent: { intents: ['friendship'], answered: 5 },
      trait_emotional: { er_opening_pace: 0.5, answered: 6 },
      trait_experience: { group_size_pref: 0.5, answered: 4 },
      trait_lifestyle: { answered: 5 },
      trait_geography: { answered: 2 },
    } as any);
    candidateWithoutBirthYear.profile.confidence = 0.8;

    expect(candidateWithoutBirthYear.profile.birth_year).toBe(0);
    expect(candidateWithoutBirthYear.profile.confidence).toBeGreaterThanOrEqual(0.55);

    const gateRes = evaluateGates(viewerVec, candidateWithoutBirthYear);
    expect(gateRes.passed).toBe(false);
    expect(gateRes.reasons).toContain('AGE_PREFERENCE_MISMATCH');
  });

  it('shortlists before generating explanations and exposes aggregate timing',async()=>{
    cacheTestState.extra=10;
    const res=await POST(new NextRequest('http://localhost/api/matches',{
      method:'POST',headers:{Authorization:'Bearer valid_token'},body:JSON.stringify({limit:2}),
    }));
    expect(res.status).toBe(200);
    const returned=await res.json();
    expect(returned).toHaveLength(2);
    expect(cacheTestState.writes).toHaveLength(2);
    expect(cacheTestState.writes.map(row=>row.user_b)).toEqual(returned.map((row:any)=>row.id));
    expect(res.headers.get('X-Match-Eligible')).toBe('11');
    expect(res.headers.get('X-Match-Generated')).toBe('2');
    expect(res.headers.get('Server-Timing')).toContain('scoring;dur=');
  });
  it('filters spatially before loading profiles and scores only that pool', async () => {
    cacheTestState.rpcIds = [];
    const empty = await POST(new NextRequest('http://localhost/api/matches', {
      method: 'POST', headers: { Authorization: 'Bearer valid_token' },
    }));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
    expect(cacheTestState.calls[0]).toBe('rpc:filter_local_online_ids:user');
    expect(cacheTestState.calls.filter((call) => call === 'profiles').length).toBe(1);

    cacheTestState.calls = [];
    cacheTestState.rpcIds = ['candidate-alice'];
    const local = await POST(new NextRequest('http://localhost/api/matches', {
      method: 'POST', headers: { Authorization: 'Bearer valid_token' },
    }));
    const json = await local.json();
    expect(json.map((row: { id: string }) => row.id)).toEqual(['candidate-alice']);
    expect(cacheTestState.calls[0]).toBe('rpc:filter_local_online_ids:user');
  });

  it('7. Unconfigured env variables return 500 naming missing variables', async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const req = new NextRequest('http://localhost/api/matches', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid_token' },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe('Server matching is unconfigured: missing SUPABASE_SECRET_KEY');
  });
});
