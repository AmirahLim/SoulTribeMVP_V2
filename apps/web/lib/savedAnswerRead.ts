import catalog from './onboardingQuestionCatalog.json';
import {REPAIR_QUESTIONS,INITIATIVE_QUESTION} from './readEngine/deeperQuestions';
import {OPENING_QUESTION} from './readEngine/emotionalQuestion';
import { resolveOnboardingBaseline } from './onboardingBundle';

type Answers = Record<string, unknown>;
const object = (value: unknown): Answers => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Answers : {};
export type SavedAnswerFact = {source: string; selections: string[]; note: string; thread?: string};
export type SavedAnswerRead = {notes: Record<string, string[]>; facts: SavedAnswerFact[]; hasDeeperAnswers: boolean};

// Literal fixed choices for the owner's read only. Never pass this output through
// the legacy trait inference adapter or expose it via another member's profile.
export const deepChoices: [string, string, string, string[]][] = [
  ...REPAIR_QUESTIONS.map(q=>[q.key,'repair',q.prompt,[...q.options]] as [string,string,string,string[]]),
  [INITIATIVE_QUESTION.key,'initiative',INITIATIVE_QUESTION.prompt,[...INITIATIVE_QUESTION.options]],
  ['groupSize', 'personality', 'Your current group-size preference', ['One-on-one','3–4 people','5–8 people','Big group','Depends']],
  ['socialVibe', 'personality', 'The social atmosphere you chose', ['Intimate','Playful-chaotic','Intellectual','Adventurous','Calm','High-energy','Creative']],
  ['messagingStyle', 'communication', 'How you like to message', ['Random thoughts','Memes','Check-ins','Voice notes','Calls','Making plans','Mostly IRL']],
  ['supportStyle', 'communication', 'The support you chose to offer', ['Listen','Reassure','Make sense of it','Advice','Solve it','Ask me']],
  ['friendshipPillars', 'intent', 'What friendship means to you', ['We tell each other everything','Inside jokes','Spontaneous plans','Comfortable silence','Show up in hard times']],
  ['idealSaturday', 'experience', 'Your ideal free Saturday', ['Slow coffee','Outdoors','Hobbies','Exploring','Social all day','Dinner-drinks','Home','Spontaneous']],
  ['spontaneousTrip', 'social_rhythm', 'Your answer to a spontaneous weekend trip', ['Already packing','Convince me','24 hours notice needed','Not without itinerary']],
  ['coreValues', 'values', 'Your life priorities', ['Family','Freedom','Adventure','Community','Achievement','Creativity','Growth','Stability','Curiosity']],
  ['budgetPref', 'lifestyle', 'Your outing budget preference', ['Free','<$20','$20–50','$50–100','$100+']],
  ['punctualityPref', 'boundaries', 'Your punctuality preference', ['Low','Flexible','Important','Essential']],
  ['cancellationStance', 'boundaries', 'Your answer about cancellations', ['Fine','Context matters','Dislike','Dealbreaker']],
];
const baselineThreads: Record<string, [string, string]> = {
  'friendship.intent': ['intent','What you are looking for'],
  'friendship.clicks': ['communication','When connection clicks for you'],
  'friendship.setting': ['personality','Your initial social-setting preference'],
  'friendship.contact': ['communication','Your preferred contact rhythm'],
  'friendship.planning': ['social_rhythm','Your preferred notice for plans'],
  'friendship.qualities': ['desiredQualities','Qualities you look for in friends'],
  'friendship.outings': ['interests','Outings you chose'],
};

export const ONBOARDING_EVIDENCE_FIELDS = [
  'intent', 'clicks', 'groupChoices', 'desiredQualities', 'connectionChoice', 'planningChoice', 'outings',
] as const;
export const TRIBAL_PASS_EVIDENCE_KEYS = deepChoices.map(([key]) => key);

/** Fields the owner read / writer may use. travelKm is matching-only and is not a reading source. */
export function pipelineEvidenceFields(row: unknown) {
  const sources = new Set(buildSavedAnswerRead(row).facts.map(fact => fact.source.split('.').at(-1)!));
  return {
    onboarding: ONBOARDING_EVIDENCE_FIELDS.filter(field => sources.has(field)),
    tribalPass: TRIBAL_PASS_EVIDENCE_KEYS.filter(key => sources.has(key)),
    travelKm: resolveOnboardingBaseline(row).travelKm,
  };
}

export function buildSavedAnswerRead(row: unknown): SavedAnswerRead {
  const saved = object(row), baseline = resolveOnboardingBaseline(saved), deep = object(saved.deep_profile);
  const result: SavedAnswerRead = {notes: {}, facts: [], hasDeeperAnswers: false};
  const add = (source: string, thread: string, label: string, raw: unknown, allowed: string[], split = false) => {
    const candidates = Array.isArray(raw) ? raw : typeof raw === 'string' ? (split ? raw.split(' · ') : [raw]) : [];
    const selections = [...new Set(candidates.filter((v): v is string => typeof v === 'string' && allowed.includes(v)))];
    if (!selections.length) return;
    const note = `${label}: ${selections.join(' · ')}.`;
    (result.notes[thread] ??= []).push(note);
    result.facts.push({source, selections, note, thread});
  };
  // Prefer deeper selections in presentation, but retain baseline as a separately
  // labelled source. Unknown legacy question versions are not reconstructed.
  for (const [key, thread, label, choices] of deepChoices) {
    add(`deep_profile.${key}`, thread, label, deep[key], choices, true);
  }
  result.hasDeeperAnswers = result.facts.length > 0;
  add(`onboarding.${OPENING_QUESTION.key}`, 'emotional', 'How you approach opening up',
    object(saved.onboarding)[OPENING_QUESTION.key], [...OPENING_QUESTION.options]);
  for (const question of catalog) {
    const mapping = baselineThreads[question.questionId];
    if (!mapping) continue;
    const raw = baseline[question.fields[0]];
    add(`onboarding.baselineV2.${question.fields[0]}`, ...mapping, raw,
      question.options.map(option => option.value).filter(value => value !== 'Other'));
  }
  return result;
}

/** Omitted numeric questions must not erase previously measured answers. */
export function suppliedTraitFields(traits: Record<string, Record<string, unknown>>) {
  return Object.fromEntries(Object.entries(traits).flatMap(([table, fields]) => {
    // Explicit null is a withdrawal; undefined means the question was not sent.
    const supplied = Object.fromEntries(Object.entries(fields).filter(([, value]) => value === null || (typeof value === 'number' && Number.isFinite(value))));
    return Object.keys(supplied).length ? [[table, supplied]] : [];
  }));
}
