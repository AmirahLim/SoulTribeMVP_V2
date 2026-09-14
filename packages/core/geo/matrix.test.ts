import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTravelTimeMinutes } from './matrix.ts';

describe('getTravelTimeMinutes does not invent travel time', () => {
  it('treats the same trimmed label as a short local trip', () => {
    assert.equal(getTravelTimeMinutes('  Bishan  ', 'Bishan'), 5);
  });

  it('returns a known matrix pair', () => {
    assert.equal(getTravelTimeMinutes('Tiong Bahru', 'Orchard'), 15);
    assert.equal(getTravelTimeMinutes('Orchard', 'Tiong Bahru'), 15);
  });

  it('returns null for an unknown pair instead of a 30-minute default', () => {
    assert.equal(getTravelTimeMinutes('Punggol', 'Woodlands'), null);
  });

  it('returns null when either label is blank', () => {
    assert.equal(getTravelTimeMinutes('   ', 'Bishan'), null);
    assert.equal(getTravelTimeMinutes('Bishan', ''), null);
  });
});
