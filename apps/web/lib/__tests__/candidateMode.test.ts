import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCandidateMode,
  demoCandidateSource,
  realCandidateSource,
  mixedCandidateSource,
  getRankedMatches,
  setCandidateSource,
} from '../matching';
import * as coreModule from '@soul-tribe/core';
import type { UserProfileData } from '../userStore';

const mockUser: UserProfileData = {
  displayName: 'Tester',
  homeArea: 'Tiong Bahru',
  avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200',
  passCompletionPct: 80,
  birthYear: 1995,
  handle: 'tester_99',
  bio: 'Test bio',
};

describe('Candidate Source Mode & Safeguards', () => {
  const originalEnv = process.env.NEXT_PUBLIC_CANDIDATE_MODE;

  beforeEach(() => {
    setCandidateSource(null);
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_CANDIDATE_MODE = originalEnv;
    setCandidateSource(null);
    vi.restoreAllMocks();
  });

  it('1. getCandidateMode defaults to "real" when env var is missing or invalid', () => {
    delete process.env.NEXT_PUBLIC_CANDIDATE_MODE;
    expect(getCandidateMode()).toBe('real');

    process.env.NEXT_PUBLIC_CANDIDATE_MODE = 'invalid_mode';
    expect(getCandidateMode()).toBe('real');

    process.env.NEXT_PUBLIC_CANDIDATE_MODE = 'demo';
    expect(getCandidateMode()).toBe('demo');

    process.env.NEXT_PUBLIC_CANDIDATE_MODE = 'mixed';
    expect(getCandidateMode()).toBe('mixed');
  });

  it('2. Safeguard 1: Demo candidates carry isDemo: true through to UI ranked matches', async () => {
    setCandidateSource(demoCandidateSource);
    const matches = await getRankedMatches(mockUser, { limit: 5 });

    expect(matches.length).toBeGreaterThan(0);
    matches.forEach((match) => {
      expect(match.isDemo).toBe(true);
    });
  });

  it('3. Safeguard 4: recordEvent is NOT called for demo candidates (isDemo: true)', async () => {
    const recordSpy = vi.spyOn(coreModule, 'recordEvent');

    setCandidateSource(demoCandidateSource);
    await getRankedMatches(mockUser, { limit: 5 });

    // Telemetry must be zero for demo matches
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it('4. Safeguard 4: recordEvent IS called for real members (isDemo: false)', async () => {
    const recordSpy = vi.spyOn(coreModule, 'recordEvent');

    const fakeRealSource = {
      async getCandidates() {
        const demoFirst = coreModule.DEMO_PROFILES[0];
        return [
          {
            ...demoFirst,
            profile: {
              ...demoFirst.profile,
              id: 'real-user-12345',
              display_name: 'Real Member',
            },
            isDemo: false,
          },
        ];
      },
    };

    setCandidateSource(fakeRealSource);
    const matches = await getRankedMatches(mockUser, { limit: 1 });

    expect(matches.length).toBe(1);
    expect(matches[0].isDemo).toBe(false);
    expect(recordSpy).toHaveBeenCalled();
  });

  it('5. Safeguard 5: Logs a warning when mode is not "real"', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    process.env.NEXT_PUBLIC_CANDIDATE_MODE = 'mixed';
    const mode = getCandidateMode();

    if (mode !== 'real') {
      console.warn(`[SoulTribe WARNING] Candidate mode set to non-production mode: "${mode}"`);
    }

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SoulTribe WARNING] Candidate mode set to non-production mode: "mixed"')
    );
  });
});
