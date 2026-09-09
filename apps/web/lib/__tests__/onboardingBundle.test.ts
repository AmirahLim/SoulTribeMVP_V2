import {describe, expect, it} from 'vitest';
import {packageOnboardingForBundle, packagedOnboardingHasEightAnswers, resolveOnboardingBaseline} from '../onboardingBundle';
import {buildSavedAnswerRead, ONBOARDING_EVIDENCE_FIELDS, TRIBAL_PASS_EVIDENCE_KEYS, pipelineEvidenceFields} from '../savedAnswerRead';
import {buildEvidence} from '../readEngine/evidence';
import {composeRead} from '../readEngine/compose';

const eight = {
  intent: ['Close circle'],
  clicks: ['Our humour just lands'],
  groupChoices: ['Small circle'],
  desiredQualities: ['Reliable'],
  connectionChoice: 'About once a week',
  planningChoice: 'A few days',
  outings: ['Specialty Coffee'],
  travelKm: 10,
};

describe('onboarding bundle packaging for save_profile_bundle', () => {
  it('maps all eight current answers into baselineV2 and q1–q8 aliases', () => {
    const packed = packageOnboardingForBundle(eight);
    expect(packed.baselineV2).toEqual(expect.objectContaining(eight));
    expect(packed.q1Finding).toEqual(eight.intent);
    expect(packed.q8Qualities).toEqual(eight.desiredQualities);
    expect(packed.q5PlanningRhythm).toEqual(eight.planningChoice);
    expect(packed.q6Outings).toEqual(eight.outings);
    expect(packagedOnboardingHasEightAnswers(packed)).toBe(true);
  });

  it('rebuilds a reading from a flat save_profile_bundle payload without omitting answers', () => {
    const packed = packageOnboardingForBundle({
      q1Finding: eight.intent,
      q2Feelings: eight.clicks,
      q3GroupSize: 'Small circle',
      q5PlanningRhythm: eight.planningChoice,
      q6Outings: eight.outings,
      q8Qualities: eight.desiredQualities,
      connectionChoice: eight.connectionChoice,
      travelKm: eight.travelKm,
    });
    const row = {onboarding: packed, deep_profile: {messagingStyle: 'Random thoughts'}};
    const read = buildSavedAnswerRead(row);
    expect(read.facts.some(fact => fact.source.endsWith('.intent'))).toBe(true);
    expect(read.facts.some(fact => fact.source.endsWith('.desiredQualities'))).toBe(true);
    expect(read.facts.some(fact => fact.source.endsWith('.outings'))).toBe(true);
    expect(read.notes.communication.join(' ')).toContain('Random thoughts');
    expect(composeRead(buildEvidence(row, 'profile')).sections.length).toBeGreaterThan(0);
    expect(JSON.stringify(resolveOnboardingBaseline(row))).not.toMatch(/omission/i);
  });
});

describe('owner read pipeline coverage', () => {
  it('feeds every catalog onboarding field and Tribal Pass choice into evidence, not travelKm prose', () => {
    const tribal = {
      repairFirst: 'Ask how they saw it',
      repairReturn: 'Later that day',
      repairDiscuss: 'Talk through what went wrong',
      repairNeed: 'A clear apology',
      repairSpace: 'Agreeing when we will talk',
      initiationChoice: 'It goes both ways',
      groupSize: 'Depends',
      socialVibe: 'Calm',
      messagingStyle: 'Random thoughts',
      supportStyle: 'Listen',
      friendshipPillars: 'Comfortable silence',
      idealSaturday: 'Exploring',
      spontaneousTrip: 'Not without itinerary',
      coreValues: 'Family · Stability',
      budgetPref: 'Free',
      punctualityPref: 'Flexible',
      cancellationStance: 'Context matters',
      mbti: 'INTJ',
      selfDescriptionOpen: 'private free text stays out of the writer',
    };
    const row = {onboarding: packageOnboardingForBundle(eight), deep_profile: tribal};
    const coverage = pipelineEvidenceFields(row);
    expect(coverage.onboarding).toEqual([...ONBOARDING_EVIDENCE_FIELDS]);
    expect(coverage.tribalPass).toEqual(TRIBAL_PASS_EVIDENCE_KEYS);
    expect(coverage.travelKm).toBe(10);
    const bundle = buildEvidence(row, 'profile');
    expect(bundle.sources.map(source => source.dimension).sort()).toEqual(
      [...ONBOARDING_EVIDENCE_FIELDS, ...TRIBAL_PASS_EVIDENCE_KEYS].sort(),
    );
    expect(JSON.stringify(bundle)).not.toMatch(/INTJ|private free text/);
    const used = new Set(composeRead(bundle).sections.flatMap(section => section.claims.flatMap(claim => claim.dimensions)));
    expect(used.has('planningChoice')).toBe(true);
    expect(used.has('messagingStyle')).toBe(true);
    expect(used.has('travelKm')).toBe(false);
  });
});
