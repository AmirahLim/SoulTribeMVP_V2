import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';
import type { UserProfileData } from '../userStore';
import {
  getRankedMatches,
  setCandidateSource,
  setMockSurfacedRecords,
  getMockSurfacedRecords,
  setMockSharedOutings,
  clearMockSuppressionData,
  getMondayOfWeek,
  recordSurfacedMatches,
  demoCandidateSource,
} from '../matching';
import { DEMO_PROFILES } from '@soul-tribe/core';

describe('Repeat Suppression & Freshness Service Tests', () => {
  const viewerUser: UserProfileData & { id: string } = {
    id: 'user-viewer-1',
    displayName: 'Priya Sharma',
    avatarUrl: '',
    homeArea: 'Tiong Bahru',
    bio: 'Loves coffee and craft.',
    passCompletionPct: 80,
    deepProfile: {
      mbti: 'INFJ',
      groupSize: '3–4 people',
      socialVibe: 'Intimate · Calm',
    },
  };

  const candA = {
    ...DEMO_PROFILES[0],
    profile: { ...DEMO_PROFILES[0].profile, id: 'real-user-a', display_name: 'User A' },
    isDemo: false,
  };

  const candB = {
    ...DEMO_PROFILES[1],
    profile: { ...DEMO_PROFILES[1].profile, id: 'real-user-b', display_name: 'User B' },
    isDemo: false,
  };

  const candC = {
    ...DEMO_PROFILES[0],
    profile: { ...DEMO_PROFILES[0].profile, id: 'real-user-c', display_name: 'User C' },
    isDemo: false,
  };

  beforeEach(() => {
    clearMockSuppressionData();
  });

  it('1. Someone shown last week with action "none" ranks below someone never shown', async () => {
    const lastWeekMonday = getMondayOfWeek(new Date(Date.now() - 7 * 86400 * 1000));
    setMockSurfacedRecords([
      {
        viewer_id: 'user-viewer-1',
        shown_id: 'real-user-a',
        week_of: lastWeekMonday,
        shown_at: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
        action: 'none',
      },
    ]);

    const mockSource = {
      async getCandidates() {
        return [candA, candB];
      },
    };

    setCandidateSource(mockSource);
    const matches = await getRankedMatches(viewerUser);

    assert.strictEqual(matches.length, 2);
    assert.strictEqual(matches[0].id, 'real-user-b', 'Never-shown candidate B must rank first');
    assert.strictEqual(matches[1].id, 'real-user-a', 'Candidate A shown last week with action "none" must rank below candidate B');
  });

  it('2. Someone marked "hidden" NEVER appears', async () => {
    const currentMonday = getMondayOfWeek();
    setMockSurfacedRecords([
      {
        viewer_id: 'user-viewer-1',
        shown_id: 'real-user-c',
        week_of: currentMonday,
        shown_at: new Date().toISOString(),
        action: 'hidden',
      },
    ]);

    const mockSource = {
      async getCandidates() {
        return [candA, candB, candC];
      },
    };

    setCandidateSource(mockSource);
    const matches = await getRankedMatches(viewerUser, { limit: 10 });
    const containsHidden = matches.some((m) => m.id === 'real-user-c');

    assert.strictEqual(containsHidden, false, 'Candidate marked "hidden" must NEVER appear in matches');
  });

  it('3. Someone from a completed shared outing is de-prioritised', async () => {
    setMockSharedOutings([
      {
        viewer_id: 'user-viewer-1',
        peer_id: 'real-user-a',
        completed: true,
      },
    ]);

    const mockSource = {
      async getCandidates() {
        return [candA, candB];
      },
    };

    setCandidateSource(mockSource);
    const matches = await getRankedMatches(viewerUser);

    assert.strictEqual(matches.length, 2);
    assert.strictEqual(matches[0].id, 'real-user-b', 'Fresh candidate B must rank before completed outing peer A');
    assert.strictEqual(matches[1].id, 'real-user-a', 'Peer from completed outing must be de-prioritised');
  });

  it('4. With only 3 eligible members and a limit of 6, all 3 still appear even if all 3 were shown last week', async () => {
    const lastWeekMonday = getMondayOfWeek(new Date(Date.now() - 7 * 86400 * 1000));
    setMockSurfacedRecords([
      { viewer_id: 'user-viewer-1', shown_id: 'real-user-a', week_of: lastWeekMonday, shown_at: new Date().toISOString(), action: 'none' },
      { viewer_id: 'user-viewer-1', shown_id: 'real-user-b', week_of: lastWeekMonday, shown_at: new Date().toISOString(), action: 'none' },
      { viewer_id: 'user-viewer-1', shown_id: 'real-user-c', week_of: lastWeekMonday, shown_at: new Date().toISOString(), action: 'none' },
    ]);

    const mockSource = {
      async getCandidates() {
        return [candA, candB, candC];
      },
    };

    setCandidateSource(mockSource);
    const matches = await getRankedMatches(viewerUser, { limit: 6 });

    assert.strictEqual(matches.length, 3, 'Graceful degradation: all 3 members must appear even if all 3 were shown last week');
  });

  it('5. Demo profiles are NEVER written to match_surfaced', async () => {
    clearMockSuppressionData();
    setCandidateSource(demoCandidateSource);

    const anonUser = { ...viewerUser, id: undefined };
    const matches = await getRankedMatches(anonUser, { limit: 5 });
    assert.ok(matches.length > 0, 'Demo matches returned for demo source');

    // recordSurfacedMatches must filter out demo matches
    await recordSurfacedMatches('user-viewer-1', matches);

    // Verify in-memory records container contains 0 demo profiles
    const containsDemoInRecords = matches.filter((m) => m.isDemo);
    assert.ok(containsDemoInRecords.length > 0, 'Returned matches contained demo profiles');
    // Ensure no demo profiles were saved into match_surfaced mock records
    assert.strictEqual(
      getMockSurfacedRecords().length,
      0,
      'Demo profiles must NEVER be recorded in match_surfaced'
    );
  });
});
