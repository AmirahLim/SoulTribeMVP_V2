import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateGates } from '../gates.ts';
import { DEMO_PROFILES } from '../../fixtures/demoProfiles.ts';

describe('Availability & Dealbreaker Gate Evaluation', () => {
  const baseA = JSON.parse(JSON.stringify(DEMO_PROFILES[0]));
  const baseB = JSON.parse(JSON.stringify(DEMO_PROFILES[1]));

  it('1. Both have availability with no overlap -> gated (NO_SHARED_AVAILABILITY_SLOT)', () => {
    const vecA = { ...baseA, social_rhythm: { ...baseA.social_rhythm, availability: ['sat_midday'], fri_night: false, sat_night: false } };
    const vecB = { ...baseB, social_rhythm: { ...baseB.social_rhythm, availability: ['sun_evening'], fri_night: false, sat_night: false } };

    const res = evaluateGates(vecA, vecB);
    assert.ok(res.reasons.includes('NO_SHARED_AVAILABILITY_SLOT'));
  });

  it('2. Both have availability with an overlap -> NOT gated for availability', () => {
    const vecA = { ...baseA, social_rhythm: { ...baseA.social_rhythm, availability: ['sat_midday', 'sun_midday'] } };
    const vecB = { ...baseB, social_rhythm: { ...baseB.social_rhythm, availability: ['sat_midday', 'fri_night'] } };

    const res = evaluateGates(vecA, vecB);
    assert.strictEqual(res.reasons.includes('NO_SHARED_AVAILABILITY_SLOT'), false);
  });

  it('3. One side empty availability -> NOT gated for availability', () => {
    const vecA = { ...baseA, social_rhythm: { ...baseA.social_rhythm, availability: ['sat_midday'], fri_night: false, sat_night: false } };
    const vecB = { ...baseB, social_rhythm: { ...baseB.social_rhythm, availability: [], fri_night: false, sat_night: false } };

    const res = evaluateGates(vecA, vecB);
    assert.strictEqual(res.reasons.includes('NO_SHARED_AVAILABILITY_SLOT'), false);
  });

  it('4. Both sides empty availability -> NOT gated for availability', () => {
    const vecA = { ...baseA, social_rhythm: { ...baseA.social_rhythm, availability: [], fri_night: false, sat_night: false } };
    const vecB = { ...baseB, social_rhythm: { ...baseB.social_rhythm, availability: [], fri_night: false, sat_night: false } };

    const res = evaluateGates(vecA, vecB);
    assert.strictEqual(res.reasons.includes('NO_SHARED_AVAILABILITY_SLOT'), false);
  });

  it('5. candidatePoolSize = 14 skips availability and geography gates', () => {
    const vecA = { ...baseA, social_rhythm: { ...baseA.social_rhythm, availability: ['sat_midday'], fri_night: false, sat_night: false } };
    const vecB = { ...baseB, social_rhythm: { ...baseB.social_rhythm, availability: ['sun_evening'], fri_night: false, sat_night: false } };

    const res = evaluateGates(vecA, vecB, { candidatePoolSize: 14 });
    assert.strictEqual(res.reasons.includes('NO_SHARED_AVAILABILITY_SLOT'), false);
    assert.strictEqual(res.reasons.includes('GEOGRAPHY_TOO_FAR'), false);
  });

  it('6. candidatePoolSize = 15 evaluates availability and geography gates', () => {
    const vecA = { ...baseA, social_rhythm: { ...baseA.social_rhythm, availability: ['sat_midday'], fri_night: false, sat_night: false } };
    const vecB = { ...baseB, social_rhythm: { ...baseB.social_rhythm, availability: ['sun_evening'], fri_night: false, sat_night: false } };

    const res = evaluateGates(vecA, vecB, { candidatePoolSize: 15 });
    assert.ok(res.reasons.includes('NO_SHARED_AVAILABILITY_SLOT'));
  });

  it('7. candidatePoolSize = undefined behaves as default (evaluates gates)', () => {
    const vecA = { ...baseA, social_rhythm: { ...baseA.social_rhythm, availability: ['sat_midday'], fri_night: false, sat_night: false } };
    const vecB = { ...baseB, social_rhythm: { ...baseB.social_rhythm, availability: ['sun_evening'], fri_night: false, sat_night: false } };

    const res = evaluateGates(vecA, vecB);
    assert.ok(res.reasons.includes('NO_SHARED_AVAILABILITY_SLOT'));
  });

  it('8. Unknown area pairs fail closed instead of inventing travel time', () => {
    const sharedRhythm = { availability: ['sat_midday'], fri_night: false, sat_night: false };
    const vecA = { ...baseA, geography: { ...baseA.geography, home_area: 'Punggol' }, social_rhythm: { ...baseA.social_rhythm, ...sharedRhythm } };
    const vecB = { ...baseB, geography: { ...baseB.geography, home_area: 'Woodlands' }, social_rhythm: { ...baseB.social_rhythm, ...sharedRhythm } };

    const res = evaluateGates(vecA, vecB, { candidatePoolSize: 15 });
    assert.ok(res.reasons.includes('GEOGRAPHY_TOO_FAR'));
  });

  it('9. Missing home_area fails closed instead of substituting Tiong Bahru', () => {
    const sharedRhythm = { availability: ['sat_midday'], fri_night: false, sat_night: false };
    const vecA = { ...baseA, geography: { ...baseA.geography, home_area: undefined }, social_rhythm: { ...baseA.social_rhythm, ...sharedRhythm } };
    const vecB = { ...baseB, geography: { ...baseB.geography, home_area: 'Bishan' }, social_rhythm: { ...baseB.social_rhythm, ...sharedRhythm } };

    const res = evaluateGates(vecA, vecB, { candidatePoolSize: 15 });
    assert.ok(res.reasons.includes('GEOGRAPHY_TOO_FAR'));
  });

  it('10. The same reported label still passes the minute gate', () => {
    const sharedRhythm = { availability: ['sat_midday'], fri_night: false, sat_night: false };
    const vecA = { ...baseA, geography: { ...baseA.geography, home_area: 'Punggol' }, social_rhythm: { ...baseA.social_rhythm, ...sharedRhythm } };
    const vecB = { ...baseB, geography: { ...baseB.geography, home_area: ' Punggol ' }, social_rhythm: { ...baseB.social_rhythm, ...sharedRhythm } };

    const res = evaluateGates(vecA, vecB, { candidatePoolSize: 15 });
    assert.strictEqual(res.reasons.includes('GEOGRAPHY_TOO_FAR'), false);
  });
});
