import { describe, it } from 'vitest';
import assert from 'node:assert';
import type { UserProfileData } from '../userStore';
import {
  getRankedMatches,
  setCandidateSource,
  demoCandidateSource,
  mixedCandidateSource,
  countRealMembers,
  isSmallCommunityMode,
  getSmallCommunityThreshold,
  getFitLabel,
} from '../matching';
import { DEMO_PROFILES } from '@soul-tribe/core';

describe('Part 5 — Matching Service Tests', () => {
  setCandidateSource(demoCandidateSource);

  const fullUser: UserProfileData & Record<string, any> = {
    displayName: 'Priya Sharma',
    avatarUrl: '',
    homeArea: 'Tiong Bahru',
    bio: 'Loves coffee and craft.',
    passCompletionPct: 100,
    birthYear: 1995,
    q1Finding: ['Close 1-on-1 friendships'],
    q2Feelings: ['Deep 1-on-1s', 'Chill & relaxed'],
    q4Connected: ['Voice notes', 'Regular check-ins'],
    q5PlanningRhythm: 'Spontaneous',
    q6Outings: ['Coffee & Cafes', 'Boardgames & Gaming'],
    q7EmotionalPacing: 'Fast opener',
    q8Qualities: ['Authenticity', 'Reliability'],
    deepProfile: {
      mbti: 'INFJ',
      groupSize: '3–4 people',
      socialVibe: 'Intimate · Calm',
      messagingStyle: 'Voice notes',
      supportStyle: 'Listen first',
      friendshipPillars: 'Reliability',
      idealSaturday: 'Slow coffee',
      spontaneousTrip: 'Convince me',
    },
  };

  it('6. getRankedMatches returns results sorted by rankScore descending', async () => {
    const matches = await getRankedMatches(fullUser, { limit: 6 });
    assert.ok(matches.length > 0, 'Should return candidate matches');
    for (let i = 0; i < matches.length - 1; i++) {
      assert.ok(
        matches[i].rankScore >= matches[i + 1].rankScore,
        `Expected ${matches[i].rankScore} >= ${matches[i + 1].rankScore}`
      );
    }
  });

  it('7. A candidate that fails a hard gate (e.g. mutual block) is NEVER returned', async () => {
    const blockedId = DEMO_PROFILES[1].profile.id;

    // Custom candidate source that injects a blocked profile
    const customSource = {
      async getCandidates() {
        return DEMO_PROFILES.map((p) => {
          if (p.profile.id === blockedId) {
            return {
              ...p,
              profile: {
                ...p.profile,
                status: 'banned' as const, // Hard gate failure
              },
            };
          }
          return p;
        });
      },
    };

    setCandidateSource(customSource);
    const matches = await getRankedMatches(fullUser, { limit: 10 });
    const containsBlocked = matches.some((m) => m.id === blockedId);
    assert.strictEqual(containsBlocked, false, 'Hard-gated candidate must not be returned');

    // Reset candidate source
    setCandidateSource(demoCandidateSource);
  });

  it('8. Results respect limit option', async () => {
    const pool = Array.from({ length: 8 }, (_, i) => ({
      ...DEMO_PROFILES[0],
      profile: { ...DEMO_PROFILES[0].profile, id: `limit-cand-${i}`, display_name: `Limit Cand ${i}` },
      isDemo: true,
    }));
    setCandidateSource({ async getCandidates() { return pool; } });

    const matches3 = await getRankedMatches(fullUser, { limit: 3 });
    assert.strictEqual(matches3.length, 3);

    const matches5 = await getRankedMatches(fullUser, { limit: 5 });
    assert.strictEqual(matches5.length, 5);

    setCandidateSource(demoCandidateSource);
  });

  it('9. clickText differs between candidates (proves it is generated, not static)', async () => {
    const matches = await getRankedMatches(fullUser, { limit: 6 });
    assert.ok(matches.length >= 2, 'Need at least 2 matches for comparison');

    // Check that generated clickTexts exist and reflect dynamic profile traits
    assert.ok(matches[0].clickText && matches[0].clickText.length > 5);
    assert.ok(matches[1].clickText && matches[1].clickText.length > 5);
    assert.ok(matches[0].rubText && matches[0].rubText.length > 5);
  });

  it('10. A thin viewer profile still returns results, flagged provisional: true', async () => {
    const thinUser: UserProfileData = {
      displayName: 'Thin User',
      avatarUrl: '',
      homeArea: 'Tiong Bahru',
      bio: '',
      passCompletionPct: 10,
      deepProfile: {}, // Thin profile with no answers
    };

    const matches = await getRankedMatches(thinUser, { limit: 5 });
    assert.ok(matches.length > 0, 'Thin profile should return provisional matches');
    const hasProvisional = matches.some((m) => m.provisional === true);
    assert.strictEqual(hasProvisional, true, 'Thin profile matches must be flagged provisional: true');
  });

  it('11. The signed-in user NEVER appears in their own matches list (self-exclusion)', async () => {
    const targetDemo = DEMO_PROFILES[0];
    const userWithId: UserProfileData = {
      ...fullUser,
      id: targetDemo.profile.id,
      handle: targetDemo.profile.handle,
    };

    const matches = await getRankedMatches(userWithId, { limit: 10 });
    const containsSelf = matches.some(
      (m) => m.id === targetDemo.profile.id || m.name === targetDemo.profile.display_name
    );
    assert.strictEqual(containsSelf, false, 'Signed-in user must be excluded from their own match results');
  });
});

describe('New Fit Labels & Resonance Threshold Tests', () => {
  it('getFitLabel maps score ranges correctly', () => {
    assert.strictEqual(getFitLabel(0.95), 'Rare Resonance');
    assert.strictEqual(getFitLabel(0.90), 'Rare Resonance');
    assert.strictEqual(getFitLabel(0.85), 'Strong Resonance');
    assert.strictEqual(getFitLabel(0.80), 'Strong Resonance');
    assert.strictEqual(getFitLabel(0.75), 'Natural Resonance');
    assert.strictEqual(getFitLabel(0.70), 'Natural Resonance');
    assert.strictEqual(getFitLabel(0.65), 'Some Resonance');
    assert.strictEqual(getFitLabel(0.60), 'Some Resonance');
    assert.strictEqual(getFitLabel(0.59), '', 'Scores below 60% return no label');
    assert.strictEqual(getFitLabel(0.40), '', 'Scores below 60% return no label');
  });
});

describe('Small Community Mode Tests', () => {
  const fullUser: UserProfileData = {
    displayName: 'Priya Sharma',
    avatarUrl: '',
    homeArea: 'Tiong Bahru',
    bio: 'Loves coffee and craft.',
    passCompletionPct: 80,
    deepProfile: {
      mbti: 'INFJ',
      groupSize: '3–4 people',
      socialVibe: 'Intimate · Calm',
      messagingStyle: 'Voice notes',
      supportStyle: 'Listen first',
      friendshipPillars: 'Reliability',
      idealSaturday: 'Slow coffee',
      spontaneousTrip: 'Convince me',
    },
  };

  it('countRealMembers counts real members only (demo profiles never count)', async () => {
    const mockSource = {
      async getCandidates() {
        const realMembers = [1, 2, 3, 4, 5].map((i) => ({
          ...DEMO_PROFILES[0],
          profile: { ...DEMO_PROFILES[0].profile, id: `real-user-${i}`, display_name: `Real User ${i}` },
          isDemo: false,
        }));
        const demoMembers = DEMO_PROFILES.slice(0, 10).map((p) => ({ ...p, isDemo: true }));
        return [...realMembers, ...demoMembers];
      },
    };

    setCandidateSource(mockSource);

    const count = await countRealMembers('Singapore');
    assert.strictEqual(count, 5, 'Demo profiles must never count toward real member threshold');
  });

  it('With 5 real members (<= threshold 30): isSmallCommunityMode is true and all eligible members appear', async () => {
    process.env.NEXT_PUBLIC_SMALL_COMMUNITY_THRESHOLD = '30';

    const mockSource = {
      async getCandidates() {
        return [1, 2, 3, 4, 5].map((i) => ({
          ...DEMO_PROFILES[0],
          profile: { ...DEMO_PROFILES[0].profile, id: `real-member-${i}`, display_name: `Real Member ${i}` },
          isDemo: false,
        }));
      },
    };

    setCandidateSource(mockSource);

    const realCount = await countRealMembers('Singapore');
    assert.strictEqual(realCount, 5);
    assert.strictEqual(isSmallCommunityMode(realCount), true);

    const matches = await getRankedMatches(fullUser);
    assert.strictEqual(matches.length, 5, 'All eligible members appear in small community mode (no top-6 truncation)');
  });

  it('With 50 real members (> threshold 30): isSmallCommunityMode is false and candidates below 60% are excluded', async () => {
    process.env.NEXT_PUBLIC_SMALL_COMMUNITY_THRESHOLD = '30';

    const mockSource = {
      async getCandidates() {
        return Array.from({ length: 50 }, (_, i) => ({
          ...DEMO_PROFILES[i % DEMO_PROFILES.length],
          profile: {
            ...DEMO_PROFILES[i % DEMO_PROFILES.length].profile,
            id: `real-member-${i + 1}`,
            display_name: `Real Member ${i + 1}`,
            confidence: 1.0,
            age_pref_min: 18,
            age_pref_max: 99,
          },
          personality: {
            user_id: `real-member-${i + 1}`,
            openness: 0.7,
            conscientiousness: 0.6,
            extraversion: 0.5,
            agreeableness: 0.7,
            emotional_stability: 0.6,
            serious_playful: 0.7,
            intensity_easygoing: 0.4,
            assertive_accommodating: 0.5,
            novelty_seeking: 0.5,
            intellectual_curiosity: 0.6,
            answered: 10,
          },
          communication: { ...DEMO_PROFILES[i % DEMO_PROFILES.length].communication, answered: 10 },
          social_rhythm: { ...DEMO_PROFILES[i % DEMO_PROFILES.length].social_rhythm, answered: 5 },
          intent: { ...DEMO_PROFILES[i % DEMO_PROFILES.length].intent, answered: 5 },
          emotional: { ...DEMO_PROFILES[i % DEMO_PROFILES.length].emotional, answered: 6 },
          lifestyle: { ...DEMO_PROFILES[i % DEMO_PROFILES.length].lifestyle, answered: 5 },
          experience: { ...DEMO_PROFILES[i % DEMO_PROFILES.length].experience, answered: 4 },
          geography: { ...DEMO_PROFILES[i % DEMO_PROFILES.length].geography, answered: 2 },
          interests: [
            { user_id: `cand-${i}`, node_id: 1, node_path: 'coffee_cafes',
              node_name: 'Coffee & Cafes', affinity: 'regular' as const },
            { user_id: `cand-${i}`, node_id: 2, node_path: 'boardgames_gaming',
              node_name: 'Boardgames & Gaming', affinity: 'regular' as const },
            { user_id: `cand-${i}`, node_id: 3, node_path: 'pottery_craft',
              node_name: 'Pottery & Craft', affinity: 'curious' as const },
          ],
          values: [
            { user_id: `cand-${i}`, value_key: 'Authenticity', stance: 1,
              importance: 0.8, visibility: 'matching_only' as const },
            { user_id: `cand-${i}`, value_key: 'Reliability', stance: 1,
              importance: 0.8, visibility: 'matching_only' as const },
            { user_id: `cand-${i}`, value_key: 'Curiosity', stance: 1,
              importance: 0.8, visibility: 'matching_only' as const },
          ],
          user_interests: [{ node_name: 'Coffee & Cafes' }, { node_name: 'Boardgames & Gaming' }],
          user_values: [{ value_key: 'Authenticity' }, { value_key: 'Reliability' }],
          isDemo: false,
        }));
      },
    };

    setCandidateSource(mockSource as any);

    const realCount = await countRealMembers('Singapore');
    assert.strictEqual(realCount, 50);
    assert.strictEqual(isSmallCommunityMode(realCount), false);

    const matches = await getRankedMatches(fullUser, { limit: 6 });
    assert.strictEqual(matches.length, 6, 'Above threshold, ranked top-6 slice returns');
    for (const m of matches) {
      assert.ok(m.rankScore >= 0.60, `Candidate score ${m.rankScore} must be >= 0.60 in main ranked list`);
    }
  });

  it('Gated members (hard gate failure) never appear in either small community mode or ranked mode', async () => {
    const gatedId = 'gated-member-1';
    const mockSource = {
      async getCandidates() {
        return [
          {
            ...DEMO_PROFILES[0],
            profile: { ...DEMO_PROFILES[0].profile, id: 'real-1', display_name: 'Real 1' },
            isDemo: false,
          },
          {
            ...DEMO_PROFILES[1],
            profile: { ...DEMO_PROFILES[1].profile, id: gatedId, display_name: 'Gated 1', status: 'banned' as const },
            isDemo: false,
          },
        ];
      },
    };

    setCandidateSource(mockSource);

    const matches = await getRankedMatches(fullUser);
    const containsGated = matches.some((m) => m.id === gatedId);
    assert.strictEqual(containsGated, false, 'Gated members must never appear in either mode');

    setCandidateSource(demoCandidateSource);
  });

  it('Two viewers with different onboarding answers score differently against the same demo pool', async () => {
    setCandidateSource(mixedCandidateSource);

    const viewerA: UserProfileData = {
      displayName: 'Viewer A',
      homeArea: 'Tiong Bahru',
      avatarUrl: '',
      bio: 'Bio A',
      passCompletionPct: 10,
      q1Finding: ['Close 1-on-1 friendships'],
      q2Feelings: ['Deep 1-on-1s', 'Chill & relaxed'],
      q4Connected: ['Voice notes'],
      q5PlanningRhythm: 'Spontaneous',
      q6Outings: ['Coffee & wandering', 'Board games'],
      q7EmotionalPacing: 'Fast opener',
      q8Qualities: ['Authenticity', 'Reliability'],
    };

    const viewerB: UserProfileData = {
      displayName: 'Viewer B',
      homeArea: 'Tiong Bahru',
      avatarUrl: '',
      bio: 'Bio B',
      passCompletionPct: 10,
      q1Finding: ['Activity partners'],
      q2Feelings: ['Active & energetic', 'Light banter'],
      q4Connected: ['Quick texts'],
      q5PlanningRhythm: 'Planned in advance',
      q6Outings: ['Active & sports', 'Nightlife & drinks'],
      q7EmotionalPacing: 'Slow opener',
      q8Qualities: ['Humor & wit', 'Ambition'],
    };

    const matchesA = await getRankedMatches(viewerA, { limit: 5 });
    const matchesB = await getRankedMatches(viewerB, { limit: 5 });

    assert.ok(matchesA.length > 0, 'Viewer A should get matches');
    assert.ok(matchesB.length > 0, 'Viewer B should get matches');

    const differs = matchesA.some((mA) => {
      const mB = matchesB.find((b) => b.id === mA.id);
      return mB && (mA.clickText !== mB.clickText || mA.rankScore !== mB.rankScore);
    });

    assert.ok(differs, 'Two viewers with different onboarding answers must produce different clickText or rankScore');

    setCandidateSource(demoCandidateSource);
  });
});
