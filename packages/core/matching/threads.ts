// Absence is not agreement.
// Two people who have both said nothing are not compatible; they are unmeasured.
// Scorers compare only fields where BOTH sides have a real volunteered value.
// If no field in a connection thread is comparable, the thread returns null.

import type { ProfileVector } from '../domain/types.ts';
import {
  gauss,
  expectationFit,
  setOverlap,
  graphAffinity,
  bandGap,
  depthScore,
} from './functions.ts';
import { getTravelTimeMinutes } from '../geo/matrix.ts';
import {hasKilometrePreference} from '../geo/selfReportedTown.ts';

function evalNumericPair(
  valA: number | undefined | null,
  valB: number | undefined | null,
  weight: number,
  calcFn: (a: number, b: number) => number
): { score: number; weight: number } | null {
  if (typeof valA === 'number' && !isNaN(valA) && typeof valB === 'number' && !isNaN(valB)) {
    return { score: calcFn(valA, valB), weight };
  }
  return null;
}

function combineSubScores(
  subScores: ({ score: number; weight: number } | null)[]
): number | null {
  let totalScore = 0;
  let totalWeight = 0;
  for (const s of subScores) {
    if (s) {
      totalScore += s.score * s.weight;
      totalWeight += s.weight;
    }
  }
  if (totalWeight === 0) return null;
  return totalScore / totalWeight;
}

/**
 * 4.1 Personality — Weight 15
 */
export function scorePersonality(vecA: ProfileVector, vecB: ProfileVector): number | null {
  const pA = vecA.personality;
  const pB = vecB.personality;
  if (!pA || !pB) return null;

  return combineSubScores([
    evalNumericPair(pA.openness, pB.openness, 0.15, (a, b) => gauss(a, b, 0, 0.28)),
    evalNumericPair(pA.intellectual_curiosity, pB.intellectual_curiosity, 0.15, (a, b) => gauss(a, b, 0, 0.25)),
    evalNumericPair(pA.conscientiousness, pB.conscientiousness, 0.10, (a, b) => gauss(a, b, 0.15, 0.30)),
    evalNumericPair(pA.extraversion, pB.extraversion, 0.12, (a, b) => gauss(a, b, 0.12, 0.32)),
    evalNumericPair(pA.agreeableness, pB.agreeableness, 0.10, (a, b) => gauss(a, b, 0, 0.30)),
    evalNumericPair(pA.emotional_stability, pB.emotional_stability, 0.10, (a, b) => gauss(a, b, 0, 0.35)),
    evalNumericPair(pA.serious_playful, pB.serious_playful, 0.10, (a, b) => gauss(a, b, 0.10, 0.28)),
    evalNumericPair(pA.intensity_easygoing, pB.intensity_easygoing, 0.08, (a, b) => gauss(a, b, 0.15, 0.28)),
    evalNumericPair(pA.assertive_accommodating, pB.assertive_accommodating, 0.05, (a, b) => gauss(a, b, 0.20, 0.28)),
    evalNumericPair(pA.novelty_seeking, pB.novelty_seeking, 0.05, (a, b) => gauss(a, b, 0, 0.30)),
  ]);
}

/**
 * 4.2 Communication — Weight 15
 */
export function scoreCommunication(vecA: ProfileVector, vecB: ProfileVector): number | null {
  const cA = vecA.communication;
  const cB = vecB.communication;
  if (!cA || !cB) return null;

  const subScores: ({ score: number; weight: number } | null)[] = [];

  if (
    typeof cA.contact_frequency_self === 'number' && typeof cB.contact_frequency_expect === 'number' &&
    typeof cB.contact_frequency_self === 'number' && typeof cA.contact_frequency_expect === 'number'
  ) {
    subScores.push({
      score: expectationFit(cA.contact_frequency_self, cB.contact_frequency_expect, cB.contact_frequency_self, cA.contact_frequency_expect, 0.18),
      weight: 0.25,
    });
  }

  if (cA.mediums && cA.mediums.length > 0 && cB.mediums && cB.mediums.length > 0) {
    subScores.push({ score: setOverlap(cA.mediums, cB.mediums), weight: 0.15 });
  }

  if (cA.conv_styles && cA.conv_styles.length > 0 && cB.conv_styles && cB.conv_styles.length > 0) {
    subScores.push({ score: setOverlap(cA.conv_styles, cB.conv_styles), weight: 0.20 });
  }

  if (
    typeof cA.response_speed_self === 'number' && typeof cB.response_speed_expect === 'number' &&
    typeof cB.response_speed_self === 'number' && typeof cA.response_speed_expect === 'number'
  ) {
    subScores.push({
      score: expectationFit(cA.response_speed_self, cB.response_speed_expect, cB.response_speed_self, cA.response_speed_expect, 0.22),
      weight: 0.12,
    });
  }

  subScores.push(evalNumericPair(cA.message_length, cB.message_length, 0.08, (a, b) => gauss(a, b, 0, 0.30)));
  subScores.push(evalNumericPair(cA.direct_diplomatic, cB.direct_diplomatic, 0.10, (a, b) => gauss(a, b, 0.12, 0.25)));
  subScores.push(evalNumericPair(cA.high_context_literal, cB.high_context_literal, 0.05, (a, b) => gauss(a, b, 0, 0.28)));

  if (
    typeof cA.initiation_self === 'number' && typeof cB.initiation_expect === 'number' &&
    typeof cB.initiation_self === 'number' && typeof cA.initiation_expect === 'number'
  ) {
    subScores.push({
      score: expectationFit(cA.initiation_self, cB.initiation_expect, cB.initiation_self, cA.initiation_expect, 0.25),
      weight: 0.05,
    });
  }

  return combineSubScores(subScores);
}

/**
 * 4.3 Social Rhythm — Weight 15 (Logistics)
 */
export function scoreSocialRhythm(vecA: ProfileVector, vecB: ProfileVector): number | null {
  const rA = vecA.social_rhythm;
  const rB = vecB.social_rhythm;
  if (!rA || !rB) return null;

  const subScores: ({ score: number; weight: number } | null)[] = [];

  const availA = new Set(rA.availability || []);
  const availB = new Set(rB.availability || []);
  if (rA.fri_night) availA.add('fri_night');
  if (rA.sat_night) availA.add('sat_night');
  if (rB.fri_night) availB.add('fri_night');
  if (rB.sat_night) availB.add('sat_night');

  if (availA.size > 0 && availB.size > 0) {
    subScores.push({ score: setOverlap(availA, availB), weight: 0.40 });
  }

  subScores.push(evalNumericPair(rA.planning_horizon, rB.planning_horizon, 0.20, (a, b) => gauss(a, b, 0.10, 0.28)));

  if (
    typeof rA.social_freq_self === 'number' && typeof rB.social_freq_expect === 'number' &&
    typeof rB.social_freq_self === 'number' && typeof rA.social_freq_expect === 'number'
  ) {
    subScores.push({
      score: expectationFit(rA.social_freq_self, rB.social_freq_expect, rB.social_freq_self, rA.social_freq_expect, 0.22),
      weight: 0.20,
    });
  }

  subScores.push(evalNumericPair(rA.preferred_duration, rB.preferred_duration, 0.12, (a, b) => gauss(a, b, 0, 0.30)));
  subScores.push(evalNumericPair(rA.energy_peak, rB.energy_peak, 0.08, (a, b) => gauss(a, b, 0, 0.30)));

  return combineSubScores(subScores);
}

/**
 * 4.4 Intent & Depth — Weight 15
 */
export function scoreIntent(vecA: ProfileVector, vecB: ProfileVector): number | null {
  const iA = vecA.intent;
  const iB = vecB.intent;
  if (!iA || !iB) return null;

  const subScores: ({ score: number; weight: number } | null)[] = [];

  if (iA.intents && iA.intents.length > 0 && iB.intents && iB.intents.length > 0) {
    subScores.push({ score: setOverlap(iA.intents, iB.intents), weight: 0.60 });
  }

  if (typeof iA.depth === 'number' && typeof iB.depth === 'number') {
    const depthAtoB = depthScore(iA.depth, iB.depth);
    const depthBtoA = depthScore(iB.depth, iA.depth);
    subScores.push({ score: (depthAtoB + depthBtoA) / 2, weight: 0.40 });
  }

  return combineSubScores(subScores);
}

/**
 * 4.5 Emotional Rhythm & Style — Weight 10
 */
export function scoreEmotional(vecA: ProfileVector, vecB: ProfileVector): number | null {
  const eA = vecA.emotional;
  const eB = vecB.emotional;
  if (!eA || !eB) return null;

  const subScores: ({ score: number; weight: number } | null)[] = [];

  subScores.push(evalNumericPair(eA.er_opening_pace, eB.er_opening_pace, 0.154, (a, b) => gauss(a, b, 0.15, 0.26)));

  if (
    typeof eA.er_cadence_need === 'number' && typeof eB.er_cadence_expect === 'number' &&
    typeof eB.er_cadence_need === 'number' && typeof eA.er_cadence_expect === 'number'
  ) {
    subScores.push({
      score: expectationFit(eA.er_cadence_need, eB.er_cadence_expect, eB.er_cadence_need, eA.er_cadence_expect, 0.18),
      weight: 0.196,
    });
  }

  if (
    typeof eA.er_reassurance_need === 'number' && typeof eB.er_reassurance_offer === 'number' &&
    typeof eB.er_reassurance_need === 'number' && typeof eA.er_reassurance_offer === 'number'
  ) {
    const reass = Math.sqrt(
      gauss(eA.er_reassurance_need, eB.er_reassurance_offer, 0, 0.22) *
      gauss(eB.er_reassurance_need, eA.er_reassurance_offer, 0, 0.22)
    );
    subScores.push({ score: reass, weight: 0.126 });
  }

  subScores.push(evalNumericPair(eA.er_recovery_time, eB.er_recovery_time, 0.098, (a, b) => gauss(a, b, 0, 0.32)));
  subScores.push(evalNumericPair(eA.er_conflict_approach, eB.er_conflict_approach, 0.126, (a, b) => gauss(a, b, 0, 0.20)));

  subScores.push(evalNumericPair(eA.expressiveness, eB.expressiveness, 0.045, (a, b) => gauss(a, b, 0, 0.30)));
  subScores.push(evalNumericPair(eA.vulnerability_comfort, eB.vulnerability_comfort, 0.06, (a, b) => gauss(a, b, 0, 0.28)));
  subScores.push(evalNumericPair(eA.affection, eB.affection, 0.045, (a, b) => gauss(a, b, 0, 0.30)));

  if (
    typeof eA.advice_vs_listening_self === 'number' && typeof eB.advice_vs_listening_expect === 'number' &&
    typeof eB.advice_vs_listening_self === 'number' && typeof eA.advice_vs_listening_expect === 'number'
  ) {
    subScores.push({
      score: expectationFit(eA.advice_vs_listening_self, eB.advice_vs_listening_expect, eB.advice_vs_listening_self, eA.advice_vs_listening_expect, 0.25),
      weight: 0.06,
    });
  }

  if (
    typeof eA.reliability_self === 'number' && typeof eB.reliability_expect === 'number' &&
    typeof eB.reliability_self === 'number' && typeof eA.reliability_expect === 'number'
  ) {
    subScores.push({
      score: expectationFit(eA.reliability_self, eB.reliability_expect, eB.reliability_self, eA.reliability_expect, 0.20),
      weight: 0.045,
    });
  }

  subScores.push(evalNumericPair(eA.boundary_clarity, eB.boundary_clarity, 0.045, (a, b) => gauss(a, b, 0, 0.30)));

  return combineSubScores(subScores);
}

/**
 * 4.6 Interests Graph — Weight 10
 */
export function scoreInterests(vecA: ProfileVector, vecB: ProfileVector): number | null {
  const iA = vecA.interests;
  const iB = vecB.interests;
  if (!iA || iA.length === 0 || !iB || iB.length === 0) return null;
  return graphAffinity(iA, iB);
}

/**
 * 4.7 Values & Worldview — Weight 8
 * Rules: 'private' values are EXCLUDED from scoring entirely.
 */
export function scoreValues(vecA: ProfileVector, vecB: ProfileVector): number | null {
  const valuesA = (vecA.values || []).filter((v) => v.visibility !== 'private');
  const valuesB = (vecB.values || []).filter((v) => v.visibility !== 'private');

  if (valuesA.length === 0 || valuesB.length === 0) return null;

  const mapB = new Map(valuesB.map((v) => [v.value_key, v]));
  const sharedScores: number[] = [];

  for (const valA of valuesA) {
    const valB = mapB.get(valA.value_key);
    if (!valB) continue;

    const maxImp = Math.max(valA.importance, valB.importance);
    const stanceDiff = Math.abs(valA.stance - valB.stance);
    const score = 1 - maxImp * stanceDiff;
    sharedScores.push(score);
  }

  if (sharedScores.length === 0) return null;
  return sharedScores.reduce((sum, s) => sum + s, 0) / sharedScores.length;
}

/**
 * 4.8 Lifestyle — Weight 7 (Logistics)
 */
export function scoreLifestyle(vecA: ProfileVector, vecB: ProfileVector): number | null {
  const lA = vecA.lifestyle;
  const lB = vecB.lifestyle;
  if (!lA || !lB) return null;

  const subScores: ({ score: number; weight: number } | null)[] = [];

  subScores.push(evalNumericPair(lA.budget_band, lB.budget_band, 0.25, (a, b) => bandGap(a, b)));

  if (lA.alcohol && lB.alcohol) {
    subScores.push({ score: lA.alcohol === 'none' && lB.alcohol === 'regular' ? 0.5 : 1.0, weight: 0.10 });
  }
  if (lA.smoking && lB.smoking) {
    subScores.push({ score: lA.smoking !== lB.smoking ? 0.7 : 1.0, weight: 0.10 });
  }

  subScores.push(evalNumericPair(lA.activity_level, lB.activity_level, 0.15, (a, b) => gauss(a, b, 0, 0.30)));

  if (lA.food_prefs && lA.food_prefs.length > 0 && lB.food_prefs && lB.food_prefs.length > 0) {
    subScores.push({ score: setOverlap(lA.food_prefs, lB.food_prefs), weight: 0.15 });
  }

  if (lA.pets && lB.pets && (lA.pets.length > 0 || lB.pets.length > 0)) {
    subScores.push({
      score: gauss(lA.pets.length > 0 ? 1 : 0, lB.pets.length > 0 ? 1 : 0, 0, 0.35),
      weight: 0.10,
    });
  }

  subScores.push(evalNumericPair(lA.travel_frequency, lB.travel_frequency, 0.10, (a, b) => gauss(a, b, 0, 0.35)));

  return combineSubScores(subScores);
}

/**
 * 4.9 Experience / Outing Compatibility — Weight 3 (Logistics)
 */
export function scoreExperience(vecA: ProfileVector, vecB: ProfileVector): number | null {
  const eA = vecA.experience;
  const eB = vecB.experience;
  if (!eA || !eB) return null;

  const subScores: ({ score: number; weight: number } | null)[] = [];

  if (eA.settings && eA.settings.length > 0 && eB.settings && eB.settings.length > 0) {
    subScores.push({ score: setOverlap(eA.settings, eB.settings), weight: 0.30 });
  }

  subScores.push(evalNumericPair(eA.group_size_pref, eB.group_size_pref, 0.30, (a, b) => gauss(a, b, 0, 0.25)));

  if (eA.orientation && eA.orientation.length > 0 && eB.orientation && eB.orientation.length > 0) {
    subScores.push({ score: setOverlap(eA.orientation, eB.orientation), weight: 0.25 });
  }

  subScores.push(evalNumericPair(eA.novelty, eB.novelty, 0.15, (a, b) => gauss(a, b, 0.10, 0.30)));

  return combineSubScores(subScores);
}

/**
 * 4.10 Geography — Weight 2 + Gate (Logistics)
 */
export function scoreGeography(vecA: ProfileVector, vecB: ProfileVector): number | null {
  const gA = vecA.geography;
  const gB = vecB.geography;
  // Town labels and kilometre preferences are not measured travel times.
  if (hasKilometrePreference(gA) || hasKilometrePreference(gB)) return null;
  if (!gA || !gB || !gA.home_area || !gB.home_area) return null;

  const travelMinutes = getTravelTimeMinutes(gA.home_area, gB.home_area);
  if (travelMinutes == null) return null;
  const radA = gA.radius_minutes?.coffee ?? 30;
  const radB = gB.radius_minutes?.coffee ?? 30;
  const minRad = Math.min(radA, radB);

  if (travelMinutes <= minRad) return 1.0;
  return gauss(0, (travelMinutes - minRad) / 60, 0, 0.35);
}
