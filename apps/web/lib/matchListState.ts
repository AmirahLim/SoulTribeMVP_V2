/**
 * Matching can return nothing for several unrelated reasons: neither a live
 * location nor a home area could be used as an origin, the measured local pool
 * was empty, nobody in that pool was a fit, or the request itself broke. A
 * member can only act on the difference if the screen names it, so one blank
 * list must never stand in for all of them.
 *
 * The copy lives here rather than inline in the pages so that both surfaces read
 * identically and so that a test can assert against the shipped words instead of
 * restating them.
 */

/** Thrown when matching had no live point and no home_area, so the pool is unknown rather than empty. */
export class LocationUnavailableError extends Error {
  constructor(message = 'Location access is needed to find people near you.') {
    super(message);
    this.name = 'LocationUnavailableError';
  }
}

/** The name check survives an error crossing a bundle boundary, where instanceof can fail. */
export function isLocationUnavailable(error: unknown): boolean {
  if (error instanceof LocationUnavailableError) return true;
  return typeof error === 'object' && error !== null
    && (error as { name?: unknown }).name === 'LocationUnavailableError';
}

export type MatchListNoticeKind = 'locationUnavailable' | 'nobodyInRange' | 'noneEligible' | 'loadFailed';

export type MatchListNoticeCopy = {
  headline: string;
  body: string;
  /** Absent when retrying the same request cannot change the answer. */
  retryLabel?: string;
  tone: 'blocked' | 'quiet' | 'failed';
};

export const MATCH_LIST_COPY: Record<MatchListNoticeKind, MatchListNoticeCopy> = {
  locationUnavailable: {
    headline: 'Location access is needed to match',
    body: 'Matching starts from people who are near you right now, so it needs your location. Allow location for this site, then try again.',
    retryLabel: 'Allow location and retry',
    tone: 'blocked',
  },
  nobodyInRange: {
    headline: 'Nobody is in range yet',
    body: 'Nobody nearby or in your area is around at the moment. This is worth checking again a little later.',
    retryLabel: 'Check again',
    tone: 'quiet',
  },
  noneEligible: {
    headline: 'No matches from this round',
    body: 'People were nearby, but none of them were a fit worth showing you yet. Your answers are saved, and filling in more of your Tribal Pass sharpens the next round.',
    tone: 'quiet',
  },
  loadFailed: {
    headline: 'Matches could not load',
    body: 'Something went wrong on our side, not with your answers. Please try again.',
    retryLabel: 'Reload matches',
    tone: 'failed',
  },
};

export type MatchListState =
  | { kind: 'loading' }
  | { kind: 'list' }
  | { kind: MatchListNoticeKind; copy: MatchListNoticeCopy };

export function resolveMatchListState(input: {
  loading: boolean;
  error: unknown;
  matchCount: number;
  /** Null when the pool was never measured, so a zero pool cannot be claimed. */
  spatialPoolSize: number | null;
}): MatchListState {
  if (input.loading) return { kind: 'loading' };
  if (isLocationUnavailable(input.error)) return notice('locationUnavailable');
  if (input.error) return notice('loadFailed');
  if (input.matchCount > 0) return { kind: 'list' };
  // A measured pool of zero is the only case where an empty screen is the truth.
  return notice(input.spatialPoolSize === 0 ? 'nobodyInRange' : 'noneEligible');
}

function notice(kind: MatchListNoticeKind): MatchListState {
  return { kind, copy: MATCH_LIST_COPY[kind] };
}
