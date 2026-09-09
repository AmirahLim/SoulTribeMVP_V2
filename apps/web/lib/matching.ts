import {
  score,
  softGate,
  generateMatchExplanation,
  DEMO_PROFILES,
  getGenderAvatarForName,
  buildMatchSurfacedEvent,
  recordEvent,
  explorationBoost,
} from '@soul-tribe/core';
import type { ProfileVector, MatchContext } from '@soul-tribe/core';
import type { UserProfileData } from './userStore';
import { toProfileVector } from './profileAdapter';
export { toProfileVector };
import { initTelemetry } from './telemetryInit';
import { getSupabaseBrowserClient, checkIsSupabaseConfigured } from './supabase';
import { filterLocalOnlineIds, reportBrowserLivePresence } from './livePresence';
import { radiusMetersFromProfile } from './onboardingSpatial';

export type CandidateMode = 'real' | 'demo' | 'mixed';

/**
 * Resolves the active candidate source mode.
 * Defaults to 'real' when NEXT_PUBLIC_CANDIDATE_MODE is missing or unrecognized.
 * Production must never fall into 'demo' or 'mixed' by accident.
 */
export function getCandidateMode(): CandidateMode {
  const envMode = process.env.NEXT_PUBLIC_CANDIDATE_MODE;
  if (envMode === 'demo' || envMode === 'mixed') {
    return envMode;
  }
  return 'real'; // Fail-closed default for production security
}

// SAFEGUARD 5: Log a clear console warning on startup when mode is not 'real'
if (typeof window !== 'undefined' || process.env.NODE_ENV !== 'test') {
  const mode = getCandidateMode();
  if (mode !== 'real') {
    console.warn(
      `[SoulTribe WARNING] Candidate source mode set to non-production mode: "${mode}". Demo profiles will be included.`
    );
  }
}

export interface CandidateVector extends ProfileVector {
  isDemo?: boolean;
}

/** Swappable data source interface for candidate vectors (e.g. demo profiles) */
export interface CandidateSource {
  getCandidates(opts?: { area?: string; limit?: number }): Promise<CandidateVector[]>;
}

/** Server-scored match source interface */
export interface ScoredMatchSource {
  getScoredMatches(
    viewerVec: ProfileVector,
    opts?: { area?: string; limit?: number; activityCategory?: string; radiusMeters?: number }
  ): Promise<RankedMatch[]>;
}

let lastSpatialPoolSize: number | null = null;

export function getLastSpatialPoolSize(): number | null {
  return lastSpatialPoolSize;
}

export const realCandidateSource: ScoredMatchSource = {
  async getScoredMatches(
    _viewerVec: ProfileVector,
    _opts?: { area?: string; limit?: number; activityCategory?: string; radiusMeters?: number }
  ): Promise<RankedMatch[]> {
    if (!checkIsSupabaseConfigured()) {
      throw new Error('Member discovery is not configured. Please contact support.');
    }

    try {
      const client = getSupabaseBrowserClient();
      const { data: { session } } = await client.auth.getSession().catch(() => ({ data: { session: null } }));
      const token = session?.access_token;

      if (!token) {
        if (typeof window === 'undefined' && process.env.VITEST) {
          const demoVecs = await demoCandidateSource.getCandidates(_opts);
          return scoreDemoCandidates(_viewerVec, demoVecs);
        }
        throw new Error('Your session is not ready. Please sign in again.');
      }

      await reportBrowserLivePresence();
      const radiusMeters = _opts?.radiusMeters ?? radiusMetersFromProfile(null);
      lastSpatialPoolSize = (await filterLocalOnlineIds(radiusMeters)).length;

      const res = await fetch('/api/matches', {
        method: 'POST',
        body: JSON.stringify({ activityCategory: _opts?.activityCategory, limit: _opts?.limit, radiusMeters }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        console.error('[SoulTribe] candidate query failed:', res.status, errJson.error || res.statusText);
        throw new Error(errJson.error || `Server match request failed with status ${res.status}`);
      }

      const matches: RankedMatch[] = await res.json();
      console.info('[SoulTribe] matches timing', {
        serverTiming:res.headers?.get('Server-Timing'),cacheHits:res.headers?.get('X-Match-Cache-Hits'),
        generated:res.headers?.get('X-Match-Generated'),returned:matches.length,
      });
      return matches;
    } catch (err: any) {
      console.error('[SoulTribe] candidate query exception:', err?.message || err);
      throw err;
    }
  },
};

export const demoCandidateSource: CandidateSource = {
  async getCandidates(opts?: { area?: string; limit?: number; all?: boolean }): Promise<CandidateVector[]> {
    const maxCount = opts?.limit ?? 40;
    const pool = DEMO_PROFILES.slice(0, maxCount);
    return pool.map((vec) => ({
      ...vec,
      isDemo: true,
    }));
  },
};

let lastCandidateFetchError: string | null = null;

export function getLastCandidateFetchError(): string | null {
  return lastCandidateFetchError;
}

export function clearLastCandidateFetchError(): void {
  lastCandidateFetchError = null;
  lastSpatialPoolSize = null;
}

export const mixedCandidateSource: ScoredMatchSource = {
  async getScoredMatches(
    viewerVec: ProfileVector,
    opts?: { area?: string; limit?: number; activityCategory?: string; radiusMeters?: number }
  ): Promise<RankedMatch[]> {
    clearLastCandidateFetchError();
    const demoVecs = await demoCandidateSource.getCandidates(opts);
    const demoMatches = scoreDemoCandidates(viewerVec, demoVecs);

    try {
      const realMatches = await realCandidateSource.getScoredMatches(viewerVec, opts);
      return [...realMatches, ...demoMatches];
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to fetch real member candidates';
      console.warn('[SoulTribe] real candidate fetch failed in mixed mode, retaining demo candidates:', errMsg);
      lastCandidateFetchError = errMsg;
      return demoMatches;
    }
  },
};

let customActiveSource: (CandidateSource | ScoredMatchSource) | null = null;

export function getActiveCandidateSource(): CandidateSource | ScoredMatchSource {
  if (customActiveSource) return customActiveSource;

  const mode = getCandidateMode();
  if (mode === 'demo') return demoCandidateSource;
  if (mode === 'mixed') return mixedCandidateSource;
  return realCandidateSource;
}

export function setCandidateSource(src: (CandidateSource | ScoredMatchSource) | null): void {
  customActiveSource = src;
}

export interface RankedMatch {
  id: string;
  name: string;
  avatarUrl: string;
  homeArea: string;
  bio: string;
  rankScore: number;
  resonance: number | null;
  logistics: number | null;
  clickText: string;
  rubText: string;    // GENERATED, not hardcoded
  fitLabel: string;
  provisional: boolean;                  // thin-profile match
  confidence?: number;
  isDemo: boolean;                       // SAFEGUARD 1: Flag carried to UI
}

export function getFitLabel(
  rankScore: number,
  isProvisional?: boolean,
  minConfidence?: number
): string {
  if (isProvisional || (minConfidence !== undefined && minConfidence < 0.55)) {
    if (rankScore >= 0.60) return 'Early Read';
    if (rankScore >= 0.40) return 'Worth a Look';
    return '';
  }
  if (rankScore >= 0.90) return 'Rare Resonance';
  if (rankScore >= 0.80) return 'Strong Resonance';
  if (rankScore >= 0.70) return 'Natural Resonance';
  if (rankScore >= 0.60) return 'Some Resonance';
  return '';
}

export function getTribalPassStatusCopy(
  completionPct: number,
  matchCount: number,
  isProvisional: boolean = true
): { headline: string; subtitle: string } {
  let headline = "Your onboarding answers are saved.";
  if (completionPct > 20 && completionPct < 80) {
    headline = "You've answered baseline onboarding and initial Tribal Pass questions.";
  } else if (completionPct >= 80) {
    headline = "Your Tribal Pass is well-developed.";
  }

  let subtitle = "";
  if (matchCount > 0) {
    if (isProvisional) {
      subtitle = `${matchCount} ${matchCount === 1 ? 'person' : 'people'} to look at, these sharpen as you fill in your Tribal Pass.`;
    } else {
      subtitle = `${matchCount} ${matchCount === 1 ? 'match' : 'matches'} with clear resonance and rhythm reading.`;
    }
  } else {
    subtitle = "Complete remaining sections to sharpen your tribe alignment.";
  }

  return { headline, subtitle };
}

export function scoreDemoCandidates(
  viewerVec: ProfileVector,
  demoVecs: CandidateVector[],
  context?: MatchContext
): RankedMatch[] {
  const ranked: RankedMatch[] = [];
  for (const candVec of demoVecs) {
    const matchRes = score(viewerVec, candVec, context);
    const softRes = softGate(matchRes, { provisionalFloor: 0.0 });
    if (!softRes.eligible) continue;

    const explanation = generateMatchExplanation(viewerVec, candVec);
    const minConf = Math.min(viewerVec.profile.confidence, candVec.profile.confidence);
    ranked.push({
      id: candVec.profile.id,
      name: candVec.profile.display_name,
      avatarUrl: candVec.profile.avatar_url || getGenderAvatarForName(candVec.profile.display_name),
      homeArea: candVec.geography?.home_area || candVec.profile.home_area || 'Singapore',
      bio: candVec.profile.bio || 'Demo member',
      rankScore: softRes.adjustedScore,
      resonance: matchRes.resonance,
      logistics: matchRes.logistics,
      clickText: explanation.click_text,
      rubText: explanation.friction_text,
      fitLabel: getFitLabel(softRes.adjustedScore, softRes.provisional, minConf),
      provisional: softRes.provisional,
      isDemo: candVec.isDemo ?? true,
    });
  }
  return ranked;
}

export function getSmallCommunityThreshold(): number {
  const envVal = process.env.NEXT_PUBLIC_SMALL_COMMUNITY_THRESHOLD;
  if (envVal !== undefined && envVal !== null && envVal.trim() !== '') {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 30;
}

export async function countRealMembers(area?: string, viewerVec?: ProfileVector): Promise<number> {
  if (customActiveSource) {
    if ('getScoredMatches' in customActiveSource) {
      const fallbackViewerVec = viewerVec || toProfileVector({ displayName: 'Viewer', homeArea: area || 'Singapore' } as any, '00000000-0000-0000-0000-000000000099');
      const matches = await customActiveSource.getScoredMatches(fallbackViewerVec, { area });
      return matches.filter((m) => !m.isDemo).length;
    }
    const candidates = await customActiveSource.getCandidates({ area });
    return candidates.filter((c) => !c.isDemo).length;
  }

  if (checkIsSupabaseConfigured()) {
    try {
      const client = getSupabaseBrowserClient();
      let query = client.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'active');
      if (area) {
        query = query.eq('home_area', area);
      }
      const { count, error } = await query;
      if (!error && typeof count === 'number') {
        return count;
      }
    } catch {
      // fallback
    }
  }

  const fallbackViewerVec = viewerVec || toProfileVector({ displayName: 'Viewer', homeArea: area || 'Singapore' } as any, '00000000-0000-0000-0000-000000000099');
  const realMatches = await realCandidateSource.getScoredMatches(fallbackViewerVec, { area });
  return realMatches.filter((m) => !m.isDemo).length;
}

export function isSmallCommunityMode(realMemberCount: number): boolean {
  const threshold = getSmallCommunityThreshold();
  return realMemberCount <= threshold;
}

export function getMondayOfWeek(d: Date = new Date()): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  return monday.toISOString().split('T')[0];
}

export interface SurfacedRecord {
  viewer_id: string;
  shown_id: string;
  week_of: string;
  shown_at: string;
  action: 'none' | 'saved' | 'pitched_to' | 'hidden';
}

export interface SharedOutingRecord {
  viewer_id: string;
  peer_id: string;
  completed: boolean;
}

let mockSurfacedRecords: SurfacedRecord[] = [];
let mockSharedOutings: SharedOutingRecord[] = [];

export function getMockSurfacedRecords(): SurfacedRecord[] {
  return mockSurfacedRecords;
}

export function setMockSurfacedRecords(records: SurfacedRecord[]): void {
  mockSurfacedRecords = [...records];
}

export function setMockSharedOutings(records: SharedOutingRecord[]): void {
  mockSharedOutings = [...records];
}

export function clearMockSuppressionData(): void {
  mockSurfacedRecords = [];
  mockSharedOutings = [];
}

export async function recordSurfacedMatches(
  viewerId: string,
  matches: RankedMatch[]
): Promise<void> {
  const realMatches = matches.filter((m) => !m.isDemo);
  if (realMatches.length === 0 || !viewerId) return;

  const currentMonday = getMondayOfWeek();
  const nowStr = new Date().toISOString();

  // Save to mock store for local tracking / unit testing
  for (const m of realMatches) {
    const existingIdx = mockSurfacedRecords.findIndex(
      (r) => r.viewer_id === viewerId && r.shown_id === m.id && r.week_of === currentMonday
    );
    if (existingIdx >= 0) {
      mockSurfacedRecords[existingIdx].shown_at = nowStr;
    } else {
      mockSurfacedRecords.push({
        viewer_id: viewerId,
        shown_id: m.id,
        week_of: currentMonday,
        shown_at: nowStr,
        action: 'none',
      });
    }
  }

  // Database upsert if Supabase is connected
  if (checkIsSupabaseConfigured()) {
    try {
      const client = getSupabaseBrowserClient();
      const rows = realMatches.map((m, idx) => ({
        viewer_id: viewerId,
        shown_id: m.id,
        week_of: currentMonday,
        shown_at: nowStr,
        action: 'none',
        rank_position: idx + 1,
        rank_score: m.rankScore,
      }));

      await client
        .from('match_surfaced')
        .upsert(rows, { onConflict: 'viewer_id,shown_id,week_of' });
    } catch {
      // Fail-safe
    }
  }
}

export async function getSuppressionData(viewerId: string): Promise<{
  hiddenIds: Set<string>;
  softSuppressedMap: Map<string, { reason: 'outing' | 'recent_shown'; shownAt?: string }>;
}> {
  const hiddenIds = new Set<string>();
  const softSuppressedMap = new Map<string, { reason: 'outing' | 'recent_shown'; shownAt?: string }>();

  const twoWeeksAgoDate = new Date(Date.now() - 13 * 86400 * 1000);
  const twoWeeksAgoMonday = getMondayOfWeek(twoWeeksAgoDate);

  // 1. Process mock records
  for (const rec of mockSurfacedRecords) {
    if (rec.viewer_id === viewerId) {
      if (rec.action === 'hidden') {
        hiddenIds.add(rec.shown_id);
      } else if (rec.action === 'none') {
        if (rec.week_of >= twoWeeksAgoMonday) {
          softSuppressedMap.set(rec.shown_id, {
            reason: 'recent_shown',
            shownAt: rec.shown_at,
          });
        }
      }
    }
  }

  for (const outing of mockSharedOutings) {
    if (outing.completed && outing.viewer_id === viewerId) {
      softSuppressedMap.set(outing.peer_id, { reason: 'outing' });
    }
  }

  // 2. Query Supabase if connected
  if (checkIsSupabaseConfigured() && viewerId) {
    try {
      const client = getSupabaseBrowserClient();

      const { data: surfacedRows } = await client
        .from('match_surfaced')
        .select('shown_id, week_of, action, shown_at')
        .eq('viewer_id', viewerId);

      if (surfacedRows) {
        for (const row of surfacedRows) {
          if (row.action === 'hidden') {
            hiddenIds.add(row.shown_id);
          } else if (row.action === 'none') {
            if (row.week_of >= twoWeeksAgoMonday) {
              if (!softSuppressedMap.has(row.shown_id)) {
                softSuppressedMap.set(row.shown_id, {
                  reason: 'recent_shown',
                  shownAt: row.shown_at,
                });
              }
            }
          }
        }
      }

      const { data: myOutings } = await client
        .from('outing_members')
        .select('outing_id, outings!inner(state)')
        .eq('user_id', viewerId)
        .eq('state', 'accepted')
        .eq('outings.state', 'completed');

      if (myOutings && myOutings.length > 0) {
        const outingIds = myOutings.map((o: any) => o.outing_id);
        const { data: peerMembers } = await client
          .from('outing_members')
          .select('user_id')
          .in('outing_id', outingIds)
          .eq('state', 'accepted')
          .neq('user_id', viewerId);

        if (peerMembers) {
          for (const peer of peerMembers) {
            softSuppressedMap.set(peer.user_id, { reason: 'outing' });
          }
        }
      }
    } catch {
      // Fail-safe
    }
  }

  return { hiddenIds, softSuppressedMap };
}

export async function getGlobalSurfacedCounts(candidateIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (candidateIds.length === 0) return counts;

  for (const rec of mockSurfacedRecords) {
    if (candidateIds.includes(rec.shown_id)) {
      counts.set(rec.shown_id, (counts.get(rec.shown_id) ?? 0) + 1);
    }
  }

  if (checkIsSupabaseConfigured()) {
    try {
      const client = getSupabaseBrowserClient();
      const { data } = await client
        .from('match_surfaced')
        .select('shown_id')
        .in('shown_id', candidateIds);

      if (data) {
        for (const row of data) {
          counts.set(row.shown_id, (counts.get(row.shown_id) ?? 0) + 1);
        }
      }
    } catch {
      // Fail-safe
    }
  }

  return counts;
}

export async function getRankedMatches(
  user: UserProfileData & { id?: string },
  opts?: { area?: string; limit?: number; activityCategory?: string; userId?: string; discovery?: 'community' | 'curated' }
): Promise<RankedMatch[]> {
  initTelemetry();
  clearLastCandidateFetchError();

  let viewerId = user.id || opts?.userId;
  let isAuthenticatedRealMember = false;
  const currentMode = getCandidateMode();

  // If in real mode and viewer ID is not passed, attempt to get it from browser session
  if (!viewerId && checkIsSupabaseConfigured() && typeof window !== 'undefined') {
    try {
      const client = getSupabaseBrowserClient();
      const { data: { session } } = await client.auth.getSession();
      if (session?.user?.id) {
        viewerId = session.user.id;
        isAuthenticatedRealMember = true;
      }
    } catch {
      // fallback
    }
  } else if (viewerId && viewerId !== '00000000-0000-0000-0000-000000000099') {
    isAuthenticatedRealMember = true;
  }

  // SELF-EXCLUSION GUARANTEE: If in real mode and real viewer ID is unavailable in browser, return [] rather than risking showing the user themselves
  if (currentMode === 'real' && !viewerId && checkIsSupabaseConfigured() && typeof window !== 'undefined') {
    throw new Error('Your session is not ready. Please sign in again.');
  }

  const effectiveId = viewerId || '00000000-0000-0000-0000-000000000099';
  const limit = opts?.limit ?? 6;
  const viewerVec = toProfileVector(user, effectiveId);

  const context: MatchContext = {
    activity_category: opts?.activityCategory as any,
  };

  // Fetch candidates from source
  // A real signed-in member must never enter mixed/demo fallback. Preserve the
  // actual error so the page can distinguish a failure from an empty result.
  const source = isAuthenticatedRealMember && checkIsSupabaseConfigured()
    ? realCandidateSource : getActiveCandidateSource();
  let candidateMatches: RankedMatch[] = [];

  if ('getScoredMatches' in source) {
    candidateMatches = await source.getScoredMatches(viewerVec, {
      area: opts?.area,
      limit: opts?.limit,
      activityCategory: opts?.activityCategory,
      radiusMeters: radiusMetersFromProfile(user),
    });
  } else {
    const candidateVecs = await source.getCandidates({ area: opts?.area, limit: opts?.limit });
    candidateMatches = scoreDemoCandidates(viewerVec, candidateVecs, context);
  }

  // PART A GUARD: An authenticated real member must NEVER see a demo profile, whatever NEXT_PUBLIC_CANDIDATE_MODE says.
  if (isAuthenticatedRealMember) {
    candidateMatches = candidateMatches.filter((m) => !m.isDemo);
  }

  const { hiddenIds, softSuppressedMap } = await getSuppressionData(effectiveId);
  const candidateIds = candidateMatches.map((c) => c.id);
  const globalSurfacedCounts = await getGlobalSurfacedCounts(candidateIds);

  const freshPool: (RankedMatch & { orderingScore: number; lastShownAt?: string })[] = [];
  const suppressedPool: (RankedMatch & { lastShownAt?: string })[] = [];
  let positionCounter = 1;

  for (const m of candidateMatches) {
    // HARD EXCLUSION 1: Self-exclusion
    if (viewerId && m.id === viewerId) continue;
    if (viewerVec.profile.id !== '00000000-0000-0000-0000-000000000099' && m.id === viewerVec.profile.id) continue;
    // Identity is established by ID, never by display-name similarity.

    // HARD EXCLUSION 2: Hidden candidates
    if (hiddenIds.has(m.id)) continue;

    if (!m.isDemo) {
      const surfacedEvent = buildMatchSurfacedEvent(
        viewerVec,
        toProfileVector({ displayName: m.name, homeArea: m.homeArea } as any, m.id),
        { resonance: m.resonance, logistics: m.logistics, rankScore: m.rankScore } as any,
        positionCounter++,
        context,
        m.provisional
      );
      recordEvent(surfacedEvent);
    }

    // Exposure fairness: count global times surfaced & calculate ordering boost
    const timesSurfaced = m.isDemo ? 0 : (globalSurfacedCounts.get(m.id) ?? 0);
    const boost = m.isDemo ? 0 : explorationBoost(timesSurfaced);
    const orderingScore = m.rankScore + boost;

    const matchItem: RankedMatch & { orderingScore: number; lastShownAt?: string } = {
      ...m,
      // Candidate's own homeArea is PRESERVED (never overwritten with viewer homeArea)
      homeArea: m.homeArea || 'Singapore',
      orderingScore,
    };

    if (!m.isDemo && softSuppressedMap.has(m.id)) {
      const info = softSuppressedMap.get(m.id);
      matchItem.lastShownAt = info?.shownAt;
      suppressedPool.push(matchItem);
    } else {
      freshPool.push(matchItem);
    }
  }

  // Sort fresh pool by orderingScore descending (newcomers with low timesSurfaced float higher)
  freshPool.sort((a, b) => b.orderingScore - a.orderingScore);

  // Sort suppressed pool by least-recently-shown first (oldest shownAt first)
  suppressedPool.sort((a, b) => {
    if (a.lastShownAt && b.lastShownAt) {
      const tA = new Date(a.lastShownAt).getTime();
      const tB = new Date(b.lastShownAt).getTime();
      if (tA !== tB) return tA - tB;
    } else if (a.lastShownAt) {
      return -1;
    } else if (b.lastShownAt) {
      return 1;
    }
    return b.rankScore - a.rankScore;
  });

  const realMemberCount = await countRealMembers(opts?.area || user.homeArea);
  const isSmall = isSmallCommunityMode(realMemberCount);

  let finalResults: RankedMatch[] = [];

  if (opts?.discovery === 'community') {
    // Compatibility orders the directory; it does not decide membership.
    // Server safety gates and explicit hides have already been applied.
    finalResults = [...freshPool, ...suppressedPool];
  } else if (isSmall) {
    const combined = [...freshPool, ...suppressedPool];
    if (opts?.limit === undefined || opts?.limit === 6) {
      finalResults = combined;
    } else {
      finalResults = combined.slice(0, limit);
    }
  } else {
    const freshEligible = freshPool.filter((m) => m.rankScore >= 0.60);
    const suppressedEligible = suppressedPool.filter((m) => m.rankScore >= 0.60);

    if (freshEligible.length >= limit) {
      finalResults = freshEligible.slice(0, limit);
    } else {
      const needed = limit - freshEligible.length;
      finalResults = [...freshEligible, ...suppressedEligible.slice(0, needed)];
    }
  }

  if (viewerId) {
    await recordSurfacedMatches(viewerId, finalResults);
  }

  return finalResults;
}
