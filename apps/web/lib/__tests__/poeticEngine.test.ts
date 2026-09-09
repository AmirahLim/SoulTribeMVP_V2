import {describe, expect, it} from 'vitest';
import {packageOnboardingForBundle} from '../onboardingBundle';
import {buildEvidence} from '../readEngine/evidence';
import {composeRead} from '../readEngine/compose';
import {POETIC_ANALYSIS, POETIC_OUTPUT, POETIC_ROLE, evidenceForWriter, writerUserContent} from '../readEngine/poeticEngine';

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

describe('poetic writer prompt payload', () => {
  it('hardcodes the interpreter instructions and carries onboarding plus Tribal Pass into the user turn', () => {
    const row = {
      onboarding: packageOnboardingForBundle(eight),
      deep_profile: {messagingStyle: 'Random thoughts', coreValues: 'Family', mbti: 'INTJ', selfDescriptionOpen: 'private diary'},
    };
    const bundle = buildEvidence(row, 'profile');
    const plan = composeRead(bundle);
    const payload = writerUserContent(bundle, plan);
    expect(payload).toContain(POETIC_ROLE);
    expect(payload).toContain(POETIC_ANALYSIS);
    expect(payload).toContain(POETIC_OUTPUT);
    const evidence = evidenceForWriter(bundle);
    expect(evidence.some(item => item.dimension === 'intent' && item.selections.includes('Close circle'))).toBe(true);
    expect(evidence.some(item => item.dimension === 'planningChoice')).toBe(true);
    expect(evidence.some(item => item.dimension === 'messagingStyle')).toBe(true);
    expect(evidence.some(item => item.dimension === 'coreValues')).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/INTJ|private diary|travelKm/);
    expect(payload).toContain('"dimension":"intent"');
    expect(payload).toContain('Random thoughts');
  });
});
