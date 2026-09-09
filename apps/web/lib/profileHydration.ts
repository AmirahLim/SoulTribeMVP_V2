import { getSupabaseBrowserClient } from './supabase';
import { setUserProfile, isProfileCacheAccount } from './userStore';

export async function hydrateProfile(userId: string): Promise<void> {
  const client = getSupabaseBrowserClient();
  const [profile, answers] = await Promise.all([
    client
      .from('profiles')
      .select('id,handle,display_name,avatar_url,home_area,bio,life_contexts,trait_intent(*),trait_communication(*),trait_social_rhythm(*),trait_emotional(*),trait_experience(*),trait_geography(*)')
      .eq('id', userId)
      .maybeSingle(),
    client
      .from('profile_answers')
      .select('onboarding,deep_profile,completed_categories')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  if (profile.error || answers.error) {
    const failedQuery = profile.error ? 'profiles' : 'profile_answers';
    const error = profile.error ?? answers.error;
    console.error('[SoulTribe] profile hydration query failed:', {
      query: failedQuery,
      code: error?.code,
      message: error?.message,
    });
    throw new Error(error?.message || 'Unable to load your saved profile.');
  }
  if (!profile.data || !isProfileCacheAccount(userId)) return;
  const p = profile.data;
  const baseline = answers.data?.onboarding?.baselineV2 && typeof answers.data.onboarding.baselineV2 === 'object'
    ? answers.data.onboarding.baselineV2
    : {};
  setUserProfile({
    ...answers.data?.onboarding,
    ...baseline,
    ...(answers.data?.onboarding?.baselineV2 ? Object.fromEntries(
      ['trait_intent','trait_communication','trait_social_rhythm','trait_emotional','trait_experience','trait_geography'].map(key => {
        const value=(p as Record<string,any>)[key];
        return [key,Array.isArray(value)?value[0]??null:value??null];
      }),
    ) : {}),
    id: userId,
    lifeContexts: p.life_contexts ?? [],
    displayName: p.display_name,
    handle: p.handle,
    avatarUrl: p.avatar_url || '',
    homeArea: p.home_area,
    bio: p.bio || '',
    deepProfile: answers.data?.deep_profile || {},
    completedCategoryNums: answers.data?.completed_categories || [],
    hasCompletedOnboarding: Boolean(
      answers.data?.onboarding && Object.keys(answers.data.onboarding).length,
    ),
  });
}
