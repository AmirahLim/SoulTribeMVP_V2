import type { ProfileVector, MatchContext } from '../domain/types.ts';
import { getTravelTimeMinutes } from '../geo/matrix.ts';
import {hasKilometrePreference} from '../geo/selfReportedTown.ts';

export interface GateCheckResult {
  passed: boolean;
  reasons: string[];
}

export function evaluateGates(
  vecA: ProfileVector,
  vecB: ProfileVector,
  context?: MatchContext
): GateCheckResult {
  const reasons: string[] = [];

  // 1. Account status gate
  if (vecA.profile.status !== 'active' || vecB.profile.status !== 'active') {
    reasons.push('ACCOUNT_NOT_ACTIVE');
  }

  // 2. Confidence gate (< 0.55 rejected)
  if (vecA.profile.confidence < 0.55 || vecB.profile.confidence < 0.55) {
    reasons.push('CONFIDENCE_TOO_LOW');
  }

  // 3. Block / Report gate
  if (context) {
    const isABlocked = context.blockedUserIds?.includes(vecB.profile.id);
    const isBBlocked = context.blockedUserIds?.includes(vecA.profile.id);
    const isAReported = context.reportedUserIds?.includes(vecB.profile.id);
    const isBReported = context.reportedUserIds?.includes(vecA.profile.id);

    if (isABlocked || isBBlocked || isAReported || isBReported) {
      reasons.push('BLOCKED_OR_REPORTED');
    }
  }

  // 4. Age preference gate
  const currentYear = new Date().getFullYear();
  const ageA = currentYear - vecA.profile.birth_year;
  const ageB = currentYear - vecB.profile.birth_year;

  if (
    ageB < vecA.profile.age_pref_min ||
    ageB > vecA.profile.age_pref_max ||
    ageA < vecB.profile.age_pref_min ||
    ageA > vecB.profile.age_pref_max
  ) {
    reasons.push('AGE_PREFERENCE_MISMATCH');
  }

  // 5. Shared availability slot & geography gates: Skip restrictive filters when pool is small (< 15 users)
  const isSmallPool = (context?.candidatePoolSize !== undefined) && context.candidatePoolSize < 15;

  if (!isSmallPool) {
    const availA = new Set(vecA.social_rhythm?.availability || []);
    if (vecA.social_rhythm?.fri_night) availA.add('fri_night');
    if (vecA.social_rhythm?.sat_night) availA.add('sat_night');

    const availB = new Set(vecB.social_rhythm?.availability || []);
    if (vecB.social_rhythm?.fri_night) availB.add('fri_night');
    if (vecB.social_rhythm?.sat_night) availB.add('sat_night');

    if (availA.size > 0 && availB.size > 0) {
      let hasSharedSlot = false;
      for (const slot of availA) {
        if (availB.has(slot)) {
          hasSharedSlot = true;
          break;
        }
      }
      if (!hasSharedSlot) {
        reasons.push('NO_SHARED_AVAILABILITY_SLOT');
      }
    }

    // 6. Geography gate: t > 2 * min(radius) across categories
    // Preserve legacy minute-based policy only for legacy profiles. New km
    // preferences cannot be evaluated without mapped locations.
    if (!hasKilometrePreference(vecA.geography) && !hasKilometrePreference(vecB.geography)) {
    const areaA = vecA.geography?.home_area?.trim();
    const areaB = vecB.geography?.home_area?.trim();
    const travelMins = areaA && areaB ? getTravelTimeMinutes(areaA, areaB) : null;

    const radA = vecA.geography?.radius_minutes || {};
    const radB = vecB.geography?.radius_minutes || {};
    const categories = ['coffee', 'dining', 'active', 'cultural', 'nightlife', 'creative'];

    let geoPassed = false;
    if (travelMins != null) {
      for (const cat of categories) {
        const rA = radA[cat] ?? 30;
        const rB = radB[cat] ?? 30;
        const minRad = Math.min(rA, rB);
        if (travelMins <= 2 * minRad) {
          geoPassed = true;
          break;
        }
      }
    }
    if (!geoPassed) {
      reasons.push('GEOGRAPHY_TOO_FAR');
    }
    }
  }

  // 7. Dealbreaker gate: Only gate when target status is explicitly known and violates dealbreaker
  const dealbreakersA = vecA.lifestyle?.dealbreakers || [];
  const dealbreakersB = vecB.lifestyle?.dealbreakers || [];

  const bSmokes = vecB.lifestyle?.smoking && vecB.lifestyle.smoking !== 'none';
  const aSmokes = vecA.lifestyle?.smoking && vecA.lifestyle.smoking !== 'none';
  const bDrinksRegularly = vecB.lifestyle?.alcohol === 'regular';
  const aDrinksRegularly = vecA.lifestyle?.alcohol === 'regular';

  if (
    (dealbreakersA.includes('smoking') && bSmokes) ||
    (dealbreakersB.includes('smoking') && aSmokes) ||
    (dealbreakersA.includes('alcohol_present') && bDrinksRegularly) ||
    (dealbreakersB.includes('alcohol_present') && aDrinksRegularly)
  ) {
    reasons.push('DEALBREAKER_VIOLATED');
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}
