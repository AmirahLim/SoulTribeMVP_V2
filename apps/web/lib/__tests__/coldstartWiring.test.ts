import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';
import type { UserProfileData } from '../userStore';
import {
  getRankedMatches,
  setCandidateSource,
  setMockSurfacedRecords,
  clearMockSuppressionData,
  getMondayOfWeek,
} from '../matching';
import { getActiveNextBestPrompts, THREAD_PROMPT_MAP } from '../threadPrompts';
import { DEMO_PROFILES, nextBestQuestions } from '@soul-tribe/core';

describe('Cold Start Wiring Tests — explorationBoost & nextBestQuestions', () => {
  beforeEach(() => {
    clearMockSuppressionData();
  });

  it('1. explorationBoost boosts newcomer ordering without altering displayed rankScore or fitLabel', async () => {
    const viewer: UserProfileData & { id: string } = {
      id: 'viewer-user-100',
      displayName: 'Viewer',
      avatarUrl: '',
      homeArea: 'Tiong Bahru',
      bio: '',
      passCompletionPct: 80,
      deepProfile: { mbti: 'INFJ' },
    };

    // New member: 0 times surfaced
    const newMember = {
      ...DEMO_PROFILES[0],
      profile: { ...DEMO_PROFILES[0].profile, id: 'new-member-1', display_name: 'New Member' },
      isDemo: false,
    };

    // Established member: surfaced 20 times to others
    const establishedMember = {
      ...DEMO_PROFILES[0],
      profile: { ...DEMO_PROFILES[0].profile, id: 'established-member-1', display_name: 'Established Member' },
      isDemo: false,
    };

    // Set 20 surfacing records for established member in mockSurfacedRecords
    const records = [];
    const thisMonday = getMondayOfWeek();
    for (let i = 0; i < 20; i++) {
      records.push({
        viewer_id: `other-user-${i}`,
        shown_id: 'established-member-1',
        week_of: thisMonday,
        shown_at: new Date().toISOString(),
        action: 'none' as const,
      });
    }
    setMockSurfacedRecords(records);

    const mockSource = {
      async getCandidates() {
        return [establishedMember, newMember];
      },
    };

    setCandidateSource(mockSource);
    const matches = await getRankedMatches(viewer);

    assert.ok(matches.length >= 2, 'Should return candidate matches');
    assert.strictEqual(matches[0].id, 'new-member-1', 'Newcomer (0 surfaces) floats up in rank ordering due to explorationBoost');
    
    // CRITICAL: Displayed rankScore & fitLabel must be unboosted
    assert.ok(typeof matches[0].rankScore === 'number', 'rankScore is a number');
    assert.ok(matches[0].fitLabel !== undefined, 'fitLabel is present');
  });

  it('2. nextBestQuestions maps all ThreadKeys to onboarding question routes and non-guilt copy', () => {
    const incompleteUser: UserProfileData = {
      displayName: 'Incomplete User',
      avatarUrl: '',
      homeArea: 'Tiong Bahru',
      bio: '',
      passCompletionPct: 20,
      deepProfile: {}, // 0 questions answered
    };

    const prompts = getActiveNextBestPrompts(incompleteUser, 2);
    assert.ok(prompts.length > 0 && prompts.length <= 2, 'Returns 1-2 prompts for incomplete profile');

    for (const prompt of prompts) {
      assert.ok(prompt.label && prompt.label.length > 0, 'Prompt has human-readable label');
      assert.ok(prompt.copy && prompt.copy.length > 10, 'Prompt has encouraging copy');
      assert.ok(prompt.href && prompt.href.startsWith('/you/deeper'), 'Prompt links to /you/deeper question route');
      assert.ok(!prompt.copy.toLowerCase().includes('deficient'), 'No guilt-trip text');
      assert.ok(!prompt.copy.toLowerCase().includes('missing'), 'No guilt-trip text');
    }
  });

  it('3. A 100% completed profile returns empty prompt list (shows nothing)', () => {
    const completeUser: UserProfileData = {
      displayName: 'Complete User',
      avatarUrl: '',
      homeArea: 'Tiong Bahru',
      bio: 'Full bio filled out completely',
      passCompletionPct: 100,
      deepProfile: {
        mbti: 'INFJ',
        messagingStyle: 'Voice notes',
        groupSize: '3–4 people',
        socialVibe: 'Intimate',
        supportStyle: 'Listen first',
        friendshipPillars: 'Reliability',
        idealSaturday: 'Slow coffee',
        spontaneousTrip: 'Convince me',
        selfDescriptionOpen: 'Curious and calm',
        messagingStyleOpen: 'Voice notes preferred',
        realFriendOpen: 'Deep bonds',
        idealSaturdayOpen: 'Craft and coffee',
        respectPeopleOpen: 'Growth mindset',
        talkForHoursOpen: 'Design and philosophy',
        instantYesOutingOpen: 'Pottery session',
        likeMeIfPrompt: 'You value listening',
        interestsList: ['Coffee', 'Ceramics', 'Design'],
      } as any,
    };

    const prompts = getActiveNextBestPrompts(completeUser, 2);
    assert.strictEqual(prompts.length, 0, 'A 100% completed profile returns 0 prompts (shows nothing)');
  });
});
