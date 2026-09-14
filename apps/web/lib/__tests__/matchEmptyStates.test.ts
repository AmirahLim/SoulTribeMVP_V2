import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { NextRequest } from 'next/server';
import { MatchListNotice } from '../../components/MatchListNotice';
import {
  LocationUnavailableError, MATCH_LIST_COPY, resolveMatchListState,
} from '../matchListState';

const presenceState = vi.hoisted(() => ({ presenceOk: true, localIds: [] as string[] }));

vi.mock('../livePresence', () => ({
  reportBrowserLivePresence: vi.fn(async () => presenceState.presenceOk),
  filterLocalOnlineIds: vi.fn(async () => presenceState.localIds),
}));

vi.mock('../supabase', () => ({
  checkIsSupabaseConfigured: () => true,
  getSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'valid_token' } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null, count: 0 }) }) }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));

describe('A failed presence write still asks the server for the area pool', () => {
  beforeEach(() => {
    presenceState.presenceOk = true;
    presenceState.localIds = [];
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'X-Match-Pool': '0' },
    }));
  });

  it('does not throw LocationUnavailableError when the presence write returns false', async () => {
    presenceState.presenceOk = false;
    const { realCandidateSource, getLastSpatialPoolSize } = await import('../matching');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const viewer = { profile: { id: 'viewer-1', display_name: 'Viewer', home_area: 'Bishan', confidence: 0.5 } } as never;

    await expect(realCandidateSource.getScoredMatches(viewer)).resolves.toEqual([]);
    expect(getLastSpatialPoolSize()).toBe(0);
  });

  it('does not consult the spatial filter when presence failed', async () => {
    presenceState.presenceOk = false;
    const { filterLocalOnlineIds } = await import('../livePresence');
    const { realCandidateSource } = await import('../matching');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await realCandidateSource.getScoredMatches({ profile: { id: 'viewer-1' } } as never).catch(() => {});
    expect(filterLocalOnlineIds).not.toHaveBeenCalled();
  });

  it('throws LocationUnavailableError only when the server had no GPS origin and no home area', async () => {
    presenceState.presenceOk = false;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'X-Match-Empty-Reason': 'no_match_origin', 'X-Match-Pool': '0' },
    }));
    const { realCandidateSource, getLastSpatialPoolSize } = await import('../matching');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const viewer = { profile: { id: 'viewer-1', display_name: 'Viewer', confidence: 0.5 } } as never;

    await expect(realCandidateSource.getScoredMatches(viewer)).rejects.toBeInstanceOf(LocationUnavailableError);
    expect(getLastSpatialPoolSize()).toBeNull();
  });

  it('records the server pool size from X-Match-Pool after a successful request', async () => {
    presenceState.presenceOk = false;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'X-Match-Pool': '4' },
    }));
    const { realCandidateSource, getLastSpatialPoolSize } = await import('../matching');
    const viewer = { profile: { id: 'viewer-1', display_name: 'Viewer', home_area: 'Bishan', confidence: 0.5 } } as never;

    await expect(realCandidateSource.getScoredMatches(viewer)).resolves.toEqual([]);
    expect(getLastSpatialPoolSize()).toBe(4);
  });
});

describe('Four outcomes resolve to four distinct notices', () => {
  const base = { loading: false, error: null as unknown, matchCount: 0, spatialPoolSize: null as number | null };

  it('reads as location unavailable when presence failed', () => {
    const state = resolveMatchListState({ ...base, error: new LocationUnavailableError() });
    expect(state.kind).toBe('locationUnavailable');
  });

  it('reads as nobody in range when presence worked and the measured pool was zero', () => {
    const state = resolveMatchListState({ ...base, spatialPoolSize: 0 });
    expect(state.kind).toBe('nobodyInRange');
  });

  it('reads as nobody eligible when people were nearby but none were a fit', () => {
    const state = resolveMatchListState({ ...base, spatialPoolSize: 7 });
    expect(state.kind).toBe('noneEligible');
  });

  it('reads as a load failure for any other thrown error', () => {
    const state = resolveMatchListState({ ...base, error: new Error('network down'), spatialPoolSize: 0 });
    expect(state.kind).toBe('loadFailed');
  });

  it('gives every state its own words and never reuses another state\'s message', () => {
    const headlines = Object.values(MATCH_LIST_COPY).map((copy) => copy.headline);
    const bodies = Object.values(MATCH_LIST_COPY).map((copy) => copy.body);
    expect(new Set(headlines).size).toBe(headlines.length);
    expect(new Set(bodies).size).toBe(bodies.length);
  });
});

describe('The matches surfaces render the notice instead of a blank list', () => {
  const render = (kind: keyof typeof MATCH_LIST_COPY) => renderToStaticMarkup(
    React.createElement(MatchListNotice, { kind, copy: MATCH_LIST_COPY[kind], onRetry: () => {} }),
  );

  it('renders the location-unavailable state with a retry and no match list', () => {
    const html = render('locationUnavailable');
    expect(html).toContain(MATCH_LIST_COPY.locationUnavailable.headline);
    expect(html).toContain(MATCH_LIST_COPY.locationUnavailable.body);
    expect(html).toContain(MATCH_LIST_COPY.locationUnavailable.retryLabel!);
    expect(html).toContain('data-match-state="locationUnavailable"');
    // The list is articles of MatchKeepsake. None of them may appear here.
    expect(html).not.toContain('<article');
    expect(html).not.toContain(MATCH_LIST_COPY.nobodyInRange.headline);
  });

  it('renders the nobody-in-range state distinctly from location unavailable', () => {
    const html = render('nobodyInRange');
    expect(html).toContain(MATCH_LIST_COPY.nobodyInRange.headline);
    expect(html).toContain('data-match-state="nobodyInRange"');
    expect(html).not.toContain(MATCH_LIST_COPY.locationUnavailable.headline);
    expect(html).not.toContain('<article');
  });

  it('renders the load-failure state distinctly from both empty states', () => {
    const html = render('loadFailed');
    expect(html).toContain(MATCH_LIST_COPY.loadFailed.headline);
    for (const other of ['locationUnavailable', 'nobodyInRange', 'noneEligible'] as const)
      expect(html).not.toContain(MATCH_LIST_COPY[other].headline);
  });

  it('omits the retry control when the caller cannot re-run the request', () => {
    const html = renderToStaticMarkup(React.createElement(MatchListNotice, {
      kind: 'loadFailed', copy: MATCH_LIST_COPY.loadFailed,
    }));
    expect(html).not.toContain('<button');
  });

  it('routes both matches surfaces through the shared resolver and notice', () => {
    for (const page of ['home', 'people']) {
      const source = readFileSync(resolve(__dirname, `../../app/${page}/page.tsx`), 'utf8');
      expect(source).toContain('resolveMatchListState');
      expect(source).toContain('<MatchListNotice');
      // The list renders only on the resolved list state, so no surface can fall
      // back to one blanket branch keyed on an empty array.
      expect(source).toContain("matchListState.kind === 'list'");
    }
  });
});

describe('Copy is asserted from the shipped source, never restated in a test', () => {
  it('finds no test that declares a user-facing match string as its own literal', () => {
    const strings = Object.values(MATCH_LIST_COPY)
      .flatMap((copy) => [copy.headline, copy.body, copy.retryLabel])
      .filter((value): value is string => Boolean(value));
    const offenders: string[] = [];
    for (const entry of readdirSync(__dirname)) {
      if (!entry.endsWith('.test.ts')) continue;
      const source = readFileSync(join(__dirname, entry), 'utf8');
      for (const value of strings) if (source.includes(value)) offenders.push(`${entry}: ${value}`);
    }
    expect(offenders).toEqual([]);
  });
});

const routeState = vi.hoisted(() => ({
  auditRows: [] as Record<string, any>[],
  localIds: [] as string[],
  areaIds: [] as string[],
  viewerHomeArea: 'Bishan' as string | null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    rpc: async (name: string) => {
      if (name === 'filter_local_online_ids')
        return { data: routeState.localIds.map((user_id) => ({ user_id })), error: null };
      if (name === 'filter_local_area_ids')
        return { data: routeState.areaIds.map((user_id) => ({ user_id })), error: null };
      return { data: null, error: { code: 'PGRST202', message: 'unknown rpc' } };
    },
    auth: { getUser: async () => ({ data: { user: { id: 'viewer-1' } }, error: null }) },
    from: (table: string) => {
      if (table === 'interaction_events') return {
        insert: async (row: Record<string, any>) => { routeState.auditRows.push(row); return { error: null }; },
      };
      if (table === 'blocks' || table === 'reports')
        return { select: () => ({ or: async () => ({ data: [], error: null }) }) };
      if (table === 'profile_answers') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { onboarding: {} }, error: null }) }) }),
      };
      if (table === 'profiles') return {
        select: () => ({
          in: async () => ({ data: [], error: null }),
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({
              data: routeState.viewerHomeArea == null ? null : {
                id: 'viewer-1', status: 'active', home_area: routeState.viewerHomeArea,
                display_name: 'Viewer', birth_year: 1995,
              },
              error: null,
            })}),
            maybeSingle: async () => ({
              data: routeState.viewerHomeArea == null ? null : {
                id: 'viewer-1', status: 'active', home_area: routeState.viewerHomeArea,
              },
              error: null,
            }),
          }),
        }),
      };
      return {
        select: () => ({
          in: async () => ({ data: [], error: null }),
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      };
    },
  })),
}));

describe('An empty result leaves a trace in interaction_events', () => {
  const oldEnv = process.env;

  beforeEach(() => {
    routeState.auditRows = [];
    routeState.localIds = [];
    routeState.areaIds = [];
    routeState.viewerHomeArea = 'Bishan';
    process.env = {
      ...oldEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      SUPABASE_SECRET_KEY: 'secret_key_test',
    };
  });

  it('writes an audit row with spatial_pool 0 when nobody was in range', async () => {
    const { POST } = await import('../../app/api/matches/route');
    const res = await POST(new NextRequest('http://localhost/api/matches', {
      method: 'POST', headers: { Authorization: 'Bearer valid_token' },
      body: JSON.stringify({ limit: 10, radiusMeters: 10000 }),
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(routeState.auditRows).toHaveLength(1);
    const [audit] = routeState.auditRows;
    expect(audit.event_type).toBe('recommendations_generated');
    expect(audit.actor_id).toBe('viewer-1');
    expect(audit.payload.spatial_pool).toBe(0);
    expect(audit.payload.area_pool).toBe(0);
    expect(audit.payload.local_pool).toBe(0);
    expect(audit.payload.count).toBe(0);
    expect(audit.payload.empty_reason).toBe('empty_local_pool');
    expect(res.headers.get('X-Match-Empty-Reason')).toBe('empty_local_pool');
    expect(res.headers.get('X-Match-Pool')).toBe('0');
  });

  it('names the empty result no_match_origin when the viewer has no home area either', async () => {
    routeState.viewerHomeArea = '  ';
    const { POST } = await import('../../app/api/matches/route');
    const res = await POST(new NextRequest('http://localhost/api/matches', {
      method: 'POST', headers: { Authorization: 'Bearer valid_token' },
      body: JSON.stringify({ limit: 10, radiusMeters: 10000 }),
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(routeState.auditRows[0].payload.empty_reason).toBe('no_match_origin');
    expect(res.headers.get('X-Match-Empty-Reason')).toBe('no_match_origin');
  });
});
