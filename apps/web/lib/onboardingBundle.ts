type Answers = Record<string, unknown>;
const object = (value: unknown): Answers =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Answers) : {};

const EIGHT_FIELDS = [
  'intent',
  'clicks',
  'groupChoices',
  'desiredQualities',
  'connectionChoice',
  'planningChoice',
  'outings',
  'travelKm',
] as const;

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined);
}

function groupChoicesFrom(source: Answers, onboarding: Answers): unknown {
  const direct = firstDefined(source.groupChoices, onboarding.groupChoices);
  if (direct !== undefined) return direct;
  const group = firstDefined(source.group, onboarding.group, onboarding.q3GroupSize);
  return typeof group === 'string' && group.trim() ? [group] : undefined;
}

/** Resolve the eight onboarding answers from nested baselineV2, a flat draft, or legacy q1–q8 keys. */
export function resolveOnboardingBaseline(row: unknown): Answers {
  const saved = object(row);
  const onboarding = object(saved.onboarding ?? (saved.baselineV2 || saved.q1Finding || saved.intent ? saved : {}));
  const nested = object(onboarding.baselineV2);
  const source = Object.keys(nested).length ? nested : onboarding;
  const baseline: Answers = {
    intent: firstDefined(source.intent, onboarding.intent, onboarding.q1Finding),
    clicks: firstDefined(source.clicks, onboarding.clicks, onboarding.q2Feelings),
    groupChoices: groupChoicesFrom(source, onboarding),
    desiredQualities: firstDefined(source.desiredQualities, onboarding.desiredQualities, onboarding.q8Qualities),
    connectionChoice: firstDefined(source.connectionChoice, onboarding.connectionChoice),
    planningChoice: firstDefined(source.planningChoice, onboarding.planningChoice, onboarding.q5PlanningRhythm),
    outings: firstDefined(source.outings, onboarding.outings, onboarding.q6Outings),
    travelKm: firstDefined(source.travelKm, onboarding.travelKm),
  };
  for (const extra of ['intentOther', 'clicksOther', 'qualityOther', 'outingOther', 'connectionOther', 'planningOther', 'group', 'lifeContexts', 'lifeContextsPublic', 'flowVersion', 'answerRecords'] as const) {
    const value = firstDefined(source[extra], onboarding[extra]);
    if (value !== undefined) baseline[extra] = value;
  }
  return Object.fromEntries(Object.entries(baseline).filter(([, value]) => value !== undefined));
}

export function packageOnboardingForBundle(data: object): Answers {
  const d = object(data);
  const nested = object(d.baselineV2);
  const draft = d.flowVersion !== undefined || d.intent !== undefined || Object.keys(nested).length ? { ...d, ...nested } : d;
  const mapped = resolveOnboardingBaseline({ onboarding: { ...d, baselineV2: Object.keys(nested).length ? nested : draft.flowVersion || draft.intent ? draft : undefined } });
  const baselineV2 = { ...nested, ...mapped };
  delete baselineV2.baselineV2;
  return {
    ...d,
    baselineV2,
    q1Finding: baselineV2.intent,
    q2Feelings: baselineV2.clicks,
    q3GroupSize: Array.isArray(baselineV2.groupChoices) && baselineV2.groupChoices.length === 1 ? baselineV2.groupChoices[0] : d.q3GroupSize,
    q5PlanningRhythm: baselineV2.planningChoice,
    q6Outings: baselineV2.outings,
    q8Qualities: baselineV2.desiredQualities,
    connectionChoice: baselineV2.connectionChoice,
    planningChoice: baselineV2.planningChoice,
    travelKm: baselineV2.travelKm,
  };
}

export function packagedOnboardingHasEightAnswers(onboarding: unknown): boolean {
  const baseline = resolveOnboardingBaseline({ onboarding });
  return EIGHT_FIELDS.every((field) => {
    const value = baseline[field];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    return typeof value === 'string' && value.trim().length > 0;
  });
}
