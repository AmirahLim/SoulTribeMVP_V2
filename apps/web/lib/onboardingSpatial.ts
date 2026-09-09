import catalog from './onboardingQuestionCatalog.json';

/** Radius accepted by filter_local_online_ids. */
export const MATCH_RADIUS_MIN_METERS = 100;
export const MATCH_RADIUS_MAX_METERS = 50000;
export const MATCH_RADIUS_DEFAULT_METERS = 5000;

/**
 * The eight onboarding answers that feed local discovery:
 * seven friendship preferences scored after the spatial pool, plus travel distance
 * as the radius passed into filter_local_online_ids.
 */
export const ONBOARDING_MATCH_ANSWERS = [
  { questionId: 'friendship.intent', field: 'intent', into: 'preference' },
  { questionId: 'friendship.clicks', field: 'clicks', into: 'preference' },
  { questionId: 'friendship.setting', field: 'groupChoices', into: 'preference' },
  { questionId: 'friendship.qualities', field: 'desiredQualities', into: 'preference' },
  { questionId: 'friendship.contact', field: 'connectionChoice', into: 'preference' },
  { questionId: 'friendship.planning', field: 'planningChoice', into: 'preference' },
  { questionId: 'friendship.outings', field: 'outings', into: 'preference' },
  { questionId: 'context.travel', field: 'travelKm', into: 'spatial_radius' },
] as const;

export type OnboardingMatchField = (typeof ONBOARDING_MATCH_ANSWERS)[number]['field'];

function catalogFields(questionId: string): string[] {
  const entry = (catalog as Array<{ questionId: string; fields: string[] }>).find((item) => item.questionId === questionId);
  return entry?.fields ?? [];
}

/** Confirms the eight mapped answers still exist on the live catalog. */
export function onboardingMatchAnswersAlignWithCatalog(): boolean {
  return ONBOARDING_MATCH_ANSWERS.every((answer) => catalogFields(answer.questionId).includes(answer.field));
}

export function travelKmToRadiusMeters(travelKm: unknown): number {
  if (!Number.isInteger(travelKm) || (travelKm as number) < 1) return MATCH_RADIUS_DEFAULT_METERS;
  return Math.min(MATCH_RADIUS_MAX_METERS, Math.max(MATCH_RADIUS_MIN_METERS, (travelKm as number) * 1000));
}

export function baselineFromOnboarding(onboarding: unknown): Record<string, unknown> {
  if (!onboarding || typeof onboarding !== 'object') return {};
  const nested = (onboarding as { baselineV2?: unknown }).baselineV2;
  if (nested && typeof nested === 'object') return nested as Record<string, unknown>;
  return onboarding as Record<string, unknown>;
}

export function radiusMetersFromOnboarding(onboarding: unknown): number {
  return travelKmToRadiusMeters(baselineFromOnboarding(onboarding).travelKm);
}

export function preferenceAnswersFromBaseline(baseline: unknown): Record<string, unknown> {
  const source = baselineFromOnboarding(baseline);
  const next: Record<string, unknown> = {};
  for (const answer of ONBOARDING_MATCH_ANSWERS) {
    if (answer.into !== 'preference') continue;
    if (source[answer.field] !== undefined) next[answer.field] = source[answer.field];
  }
  return next;
}

export function radiusMetersFromProfile(user: { travelKm?: unknown; baselineV2?: unknown } | null | undefined): number {
  if (!user) return MATCH_RADIUS_DEFAULT_METERS;
  if (user.travelKm !== undefined) return travelKmToRadiusMeters(user.travelKm);
  return radiusMetersFromOnboarding(user.baselineV2 ? { baselineV2: user.baselineV2 } : user);
}
