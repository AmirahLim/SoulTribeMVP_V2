import { beforeEach, describe, expect, it, vi } from 'vitest';

const setUserProfile = vi.fn();
const maybeSingleProfile = vi.fn();
const maybeSingleAnswers = vi.fn();

vi.mock('../supabase', () => ({
  getSupabaseBrowserClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: table === 'profiles' ? maybeSingleProfile : maybeSingleAnswers }),
      }),
    }),
  }),
}));

vi.mock('../userStore', () => ({
  setUserProfile,
  isProfileCacheAccount: () => true,
}));

describe('profile hydration flattens onboarding answers', () => {
  beforeEach(() => {
    setUserProfile.mockReset();
    maybeSingleProfile.mockResolvedValue({
      data: {
        id: 'user-1',
        handle: 'hello_you',
        display_name: 'Hello',
        avatar_url: '',
        home_area: 'Singapore',
        bio: '',
        life_contexts: ['Slow Living'],
      },
      error: null,
    });
    maybeSingleAnswers.mockResolvedValue({
      data: {
        onboarding: {
          baselineV2: {
            intent: ['Close circle'],
            clicks: ['Our humour just lands'],
            groupChoices: ['Small circle'],
            desiredQualities: ['Reliable'],
            connectionChoice: 'About once a week',
            planningChoice: 'A few days',
            outings: ['Specialty Coffee'],
            travelKm: 15,
          },
        },
        deep_profile: {},
        completed_categories: [],
      },
      error: null,
    });
  });

  it('exposes the eight baseline answers including travelKm for local matching', async () => {
    const { hydrateProfile } = await import('../profileHydration');
    await hydrateProfile('user-1');
    expect(setUserProfile).toHaveBeenCalledWith(expect.objectContaining({
      intent: ['Close circle'],
      clicks: ['Our humour just lands'],
      groupChoices: ['Small circle'],
      desiredQualities: ['Reliable'],
      connectionChoice: 'About once a week',
      planningChoice: 'A few days',
      outings: ['Specialty Coffee'],
      travelKm: 15,
      lifeContexts: ['Slow Living'],
      homeArea: 'Singapore',
    }));
  });
});
