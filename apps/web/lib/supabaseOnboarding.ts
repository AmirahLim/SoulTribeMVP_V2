import { getSupabaseBrowserClient } from './supabase';
import type { DeepProfileAnswers } from './userStore';
import { ONBOARDING_INTEREST_NODES } from '@soul-tribe/core';
import { suppliedTraitFields } from './savedAnswerRead';
import { packageOnboardingForBundle } from './onboardingBundle';

export interface OnboardingDataToSave {
  displayName: string;
  handle: string;
  homeArea: string;
  birthYear?: number | null;
  dateOfBirth?: string;
  avatarUrl?: string;
  bio?: string;
  q1Finding: string[];
  q2Feelings: string[];
  q3Energy?: number | null;
  q3GroupSize?: string | null;
  q4Connected: string[];
  q5PlanningRhythm?: string | null;
  q5Availability: string[];
  q6Outings: string[];
  q7EmotionalPacing?: string | null;
  q8Qualities: string[];
}

type SaveResult = {
  success: boolean;
  error?: string;
  isDuplicateHandle?: boolean;
};
async function saveBundle(
  userId: string,
  profile: object | null,
  answers: object,
  traits: object,
  interests: number[] | null = null,
): Promise<SaveResult> {
  try {
    const client = getSupabaseBrowserClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || user?.id !== userId)
      return { success: false, error: 'Please sign in again.' };
    const { error } = await client.rpc('save_profile_bundle', {
      p_profile: profile,
      p_answers: answers,
      p_traits: traits,
      p_interests: interests,
    });
    if (error)
      return {
        success: false,
        error: error.message,
        isDuplicateHandle: error.code === '23505',
      };
    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unable to save answers.',
    };
  }
}
function interestIds(names: string[]): number[] {
  return ONBOARDING_INTEREST_NODES.filter((n) =>
    names.some((name) => name.toLowerCase().trim() === n.name.toLowerCase()),
  ).map((n) => n.id);
}
export async function saveOnboardingToSupabase(
  userId: string,
  data: OnboardingDataToSave,
): Promise<SaveResult> {
  const rhythm = data.q5PlanningRhythm || '';
  const pacing = data.q7EmotionalPacing || '';
  const group = data.q3GroupSize || '';
  return saveBundle(
    userId,
    {
      handle: data.handle.trim().toLowerCase(),
      display_name: data.handle.trim().toLowerCase(),
      home_area: data.homeArea.trim(),
      birth_year: data.birthYear,
      avatar_url: data.avatarUrl || null,
      bio: data.bio || null,
    },
    { onboarding: packageOnboardingForBundle(data) },
    {
      trait_intent: { intents: data.q1Finding },
      trait_communication: {
        conv_styles: data.q2Feelings,
        mediums: data.q4Connected,
      },
      trait_personality: { extraversion: data.q3Energy ?? null },
      trait_social_rhythm: {
        availability: data.q5Availability,
        planning_horizon: !rhythm
          ? null
          : /Spontaneous/i.test(rhythm)
            ? 0.2
            : /Flexible/i.test(rhythm)
              ? 0.5
              : /In advance|Planned|ahead/i.test(rhythm)
                ? 0.8
                : null,
      },
      trait_experience: {
        settings: data.q6Outings,
        group_size_pref: !group
          ? null
          : group === '1-on-1'
            ? 0
            : group === '3-4 people'
              ? 0.5
              : /5-6 people|Big group/.test(group)
                ? 1
                : null,
      },
      trait_emotional: {
        er_opening_pace: !pacing
          ? null
          : /Fast/i.test(pacing)
            ? 0.9
            : /Slow|Cautious/i.test(pacing)
              ? 0.2
              : /Let it unfold/i.test(pacing)
                ? 0.5
                : null,
      },
      trait_geography: { home_area: data.homeArea.trim() },
    },
    interestIds(data.q6Outings),
  );
}
// Legacy API retained for callers. Qualities desired in others never become personal values.
export async function saveUserInterestsAndValues(
  userId: string,
  outings: string[],
  _qualities: string[],
): Promise<SaveResult> {
  return saveBundle(userId, null, {}, {}, interestIds(outings));
}
function deepProfileSavePatch(d: DeepProfileAnswers) {
  // Omit undefined keys so a partial Tribal Pass save cannot replace the stored object.
  // Empty string remains so a cleared chip can withdraw that field.
  return Object.fromEntries(Object.entries(d).filter(([, value]) => value !== undefined));
}

export async function saveDeeperPassToSupabase(
  userId: string,
  d: DeepProfileAnswers,
  categories: number[],
): Promise<SaveResult> {
  // Map direct, numeric answers only. Free text and MBTI are not psychometric evidence.
  return saveBundle(
    userId,
    null,
    { deep_profile: deepProfileSavePatch(d), completed_categories: [...new Set(categories)] },
    suppliedTraitFields({
      trait_personality: {
        serious_playful: d.seriousPlayful,
        intensity_easygoing: d.intensityEasygoing,
        novelty_seeking: d.noveltySeeking,
      },
      trait_communication: {
        initiation_self: d.initiationSelf,
        initiation_expect: d.initiationExpect,
        response_speed_self: d.responseSpeedSelf,
        contact_frequency_expect: d.contactFreqExpect,
      },
      trait_social_rhythm: {
        social_freq_self: d.socialFreqSelf,
        preferred_duration: d.preferredDuration,
      },
      trait_emotional: {
        reliability_self: d.reliabilitySelf,
        reliability_expect: d.reliabilityExpect,
        er_conflict_approach: d.conflictApproach,
        er_recovery_time: d.recoveryTime,
        vulnerability_comfort: d.vulnerabilityComfort,
        expressiveness: d.expressiveness,
      },
      trait_experience: { novelty: d.experienceNovelty },
    }),
  );
}
