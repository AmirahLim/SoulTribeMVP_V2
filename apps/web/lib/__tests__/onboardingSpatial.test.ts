import { describe, expect, it, vi } from 'vitest';
import {
  ONBOARDING_MATCH_ANSWERS,
  onboardingMatchAnswersAlignWithCatalog,
  preferenceAnswersFromBaseline,
  radiusMetersFromOnboarding,
  radiusMetersFromProfile,
  travelKmToRadiusMeters,
} from '../onboardingSpatial';

const eightAnswers = {
  intent: ['Close circle'],
  clicks: ['Our humour just lands'],
  groupChoices: ['Small circle'],
  desiredQualities: ['Reliable'],
  connectionChoice: 'About once a week',
  planningChoice: 'A few days',
  outings: ['Specialty Coffee'],
  travelKm: 20,
};

describe('onboarding spatial matching', () => {
  it('maps all eight current onboarding answers onto matching inputs', () => {
    expect(ONBOARDING_MATCH_ANSWERS).toHaveLength(8);
    expect(onboardingMatchAnswersAlignWithCatalog()).toBe(true);
    expect(preferenceAnswersFromBaseline({ baselineV2: eightAnswers })).toEqual({
      intent: ['Close circle'],
      clicks: ['Our humour just lands'],
      groupChoices: ['Small circle'],
      desiredQualities: ['Reliable'],
      connectionChoice: 'About once a week',
      planningChoice: 'A few days',
      outings: ['Specialty Coffee'],
    });
    expect(radiusMetersFromOnboarding({ baselineV2: eightAnswers })).toBe(20000);
  });

  it('clamps travel distance into filter_local_online_ids radius bounds', () => {
    expect(travelKmToRadiusMeters(undefined)).toBe(5000);
    expect(travelKmToRadiusMeters(1)).toBe(1000);
    expect(travelKmToRadiusMeters(50)).toBe(50000);
    expect(radiusMetersFromProfile({ travelKm: 10 })).toBe(10000);
  });
});
