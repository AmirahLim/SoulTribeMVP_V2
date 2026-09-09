'use client';
import { getGenderAvatarForName } from '@soul-tribe/core';

export interface DeepProfileAnswers {
  initiationChoice?: string;
  repairFirst?: string;
  repairReturn?: string;
  repairDiscuss?: string;
  repairNeed?: string;
  repairSpace?: string;
  // 1. Social Energy
  groupSize?: string;
  socialVibe?: string;
  socialAtmosphereOpen?: string;

  // 2. How I Connect
  messagingStyle?: string;
  supportStyle?: string;
  messagingStyleOpen?: string;

  // 3. Friendship Style
  friendshipPillars?: string;
  realFriendOpen?: string;

  // 4. My Rhythm
  idealSaturday?: string;
  spontaneousTrip?: string;
  idealSaturdayOpen?: string;

  // 5. Personality (MBTI & Astrology Big 3)
  selfDescriptionOpen?: string;
  mbti?: string;
  sunSign?: string;
  moonSign?: string;
  risingSign?: string;

  // 6. Values & Worldview
  coreValues?: string;
  respectPeopleOpen?: string;

  // 7. I'm Into
  talkForHoursOpen?: string;
  currentRabbitHoleOpen?: string;

  // 8. Outing DNA
  budgetPref?: string;
  instantYesOutingOpen?: string;

  // 9. You Should Know
  likeMeIfPrompt?: string;
  quickestWayPrompt?: string;

  // 10. Boundaries & Matching
  punctualityPref?: string;
  cancellationStance?: string;

  // Stage B Questions (Tribal Pass — 8 questions)
  reliabilitySelf?: number;
  reliabilityExpect?: number;
  initiationSelf?: number;
  initiationExpect?: number;
  responseSpeedSelf?: number;
  contactFreqExpect?: number;
  seriousPlayful?: number;
  intensityEasygoing?: number;

  // Stage C Questions (Sharpen — 8 questions)
  conflictApproach?: number;
  recoveryTime?: number;
  vulnerabilityComfort?: number;
  expressiveness?: number;
  noveltySeeking?: number;
  experienceNovelty?: number;
  socialFreqSelf?: number;
  preferredDuration?: number;
}

export interface StandingLevel {
  key: string;
  label: string;
  meaning: string;
  howEarned: string;
  icon: string;
  badgeColor: string;
}

export const STANDING_LEVELS: StandingLevel[] = [
  {
    key: 'new_here',
    label: 'New Here',
    meaning: 'Just joined Soul Tribe',
    howEarned: 'Account / profile created',
    icon: '🌱',
    badgeColor: 'border-white/30 bg-white/10 text-white',
  },
  {
    key: 'explorer',
    label: 'Explorer',
    meaning: 'Has started participating IRL',
    howEarned: 'Attended first outing',
    icon: '🧭',
    badgeColor: 'border-sky-400/40 bg-sky-500/10 text-sky-200',
  },
  {
    key: 'regular',
    label: 'Regular',
    meaning: 'Consistently participates',
    howEarned: 'Multiple attended outings over time',
    icon: '⚡',
    badgeColor: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
  },
  {
    key: 'connector',
    label: 'Connector',
    meaning: 'Actively brings people together',
    howEarned: 'Hosts outings + people attend',
    icon: '🤝',
    badgeColor: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  },
  {
    key: 'trusted_host',
    label: 'Repeat Host',
    meaning: 'Has hosted several outings',
    howEarned: 'Three or more hosted outings; this is participation history, not a trust rating',
    icon: '🛡️',
    badgeColor: 'border-purple-400/40 bg-purple-500/10 text-purple-200',
  },
  {
    key: 'community_builder',
    label: 'Community Builder',
    meaning: 'Contributes beyond individual outings',
    howEarned: 'Repeat hosting, connecting people, contributing to Circles/community',
    icon: '🏗️',
    badgeColor: 'border-indigo-400/40 bg-indigo-500/10 text-indigo-200',
  },
  {
    key: 'established',
    label: 'Established',
    meaning: 'Long-term, trusted member',
    howEarned: 'Sustained participation + reliability + positive community history',
    icon: '👑',
    badgeColor: 'border-rose-400/40 bg-rose-500/10 text-rose-200',
  },
];

export interface UserProfileData {
  lifeContexts?: string[];
  id?: string;
  version?: number;
  displayName: string;
  handle?: string;
  dateOfBirth?: string;
  birthYear?: number;
  agePrefMin?: number;
  agePrefMax?: number;
  // Onboarding answers Q1-Q8 (previously read via `as any` in profileAdapter)
  q1Finding?: string[];
  q2Feelings?: string[];
  q3Energy?: number;
  q3GroupSize?: string;
  q4Connected?: string[];
  q5PlanningRhythm?: string;
  q5Availability?: string[];
  q6Outings?: string[];
  q7EmotionalPacing?: string;
  q8Qualities?: string[];
  travelKm?: number;
  baselineV2?: Record<string, unknown>;
  avatarUrl: string;
  homeArea: string;
  bio: string;
  passCompletionPct: number;
  hasCompletedOnboarding?: boolean;
  completedCategoryNums?: number[];
  outingsAttended?: number;
  outingsHosted?: number;
  standingKey?: string;
  deepProfile?: DeepProfileAnswers;
}

export const HANDLE_REGEX = /^[a-z0-9_]{3,20}$/;

export function validateHandle(handle: string): { valid: boolean; error?: string } {
  const trimmed = (handle || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Username (handle) is required.' };
  }
  if (trimmed.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters long.' };
  }
  if (trimmed.length > 20) {
    return { valid: false, error: 'Username must be 20 characters or fewer.' };
  }
  if (!HANDLE_REGEX.test(trimmed)) {
    return { valid: false, error: 'Username must contain only lowercase letters, numbers, and underscores.' };
  }
  return { valid: true };
}

export function deriveSuggestedHandle(displayName: string): string {
  const cleaned = (displayName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned) return '';
  if (cleaned.length < 3) {
    return (cleaned + '_user').slice(0, 20);
  }
  return cleaned.slice(0, 20);
}

export function calculateAge(dobString: string): number | null {
  if (!dobString) return null;
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function validateDateOfBirth(dobString: string): { valid: boolean; age: number | null; birthYear: number | null; error?: string } {
  if (!dobString) {
    return { valid: false, age: null, birthYear: null, error: 'Date of birth is required.' };
  }
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) {
    return { valid: false, age: null, birthYear: null, error: 'Please enter a valid date of birth.' };
  }
  const age = calculateAge(dobString);
  if (age === null || age < 18) {
    return { valid: false, age, birthYear: dob.getFullYear(), error: 'Soul Tribe is strictly for adults aged 18 and above.' };
  }
  return { valid: true, age, birthYear: dob.getFullYear() };
}

export interface JoinedGuest {
  id: string;
  name: string;
  avatarUrl: string;
  homeArea: string;
  status: 'Confirmed' | 'Pending';
  isDemo?: boolean;
}

export interface PitchedOuting {
  id: string;
  title: string;
  pitch: string;
  area: string;
  category?: string;
  dateTime: string;
  hostName: string;
  hostAvatar: string;
  hostId?: string;
  isHostDemo?: boolean;
  seatsTotal: number;
  seatsFilled: number;
  cohesionScore: number;
  joinedGuests: JoinedGuest[];
  createdAt: string;
  fitBadge?: string;
  cover_image_url?: string;
  cover_image_thumb_url?: string;
  cover_image_alt?: string;
  cover_photographer_name?: string;
  cover_photographer_url?: string;
  cover_download_location?: string;
}

export function calculatePassCompletion(hasOnboarded: boolean = true, completedCategoryNums: number[] = []): number {
  if (!hasOnboarded) return 0;
  const uniqueCats = new Set(completedCategoryNums);
  const count = uniqueCats.size;
  const pct = 10 + count * 9;
  return Math.min(100, pct);
}

export function calculateTribeStanding(outingsAttended: number = 0, outingsHosted: number = 0): StandingLevel {
  if (outingsHosted >= 8 || (outingsAttended >= 10 && outingsHosted >= 3)) {
    return STANDING_LEVELS[6]; // Established
  }
  if (outingsHosted >= 5 || (outingsAttended >= 5 && outingsHosted >= 2)) {
    return STANDING_LEVELS[5]; // Community Builder
  }
  if (outingsHosted >= 3) {
    return STANDING_LEVELS[4]; // Trusted Host
  }
  if (outingsHosted >= 1) {
    return STANDING_LEVELS[3]; // Connector
  }
  if (outingsAttended >= 3) {
    return STANDING_LEVELS[2]; // Regular
  }
  if (outingsAttended >= 1) {
    return STANDING_LEVELS[1]; // Explorer
  }
  return STANDING_LEVELS[0]; // New Here
}

export const DEFAULT_USER_PROFILE: UserProfileData = {
  version: 10,
  displayName: '',
  handle: '',
  avatarUrl: '',
  homeArea: 'Singapore',
  bio: '',
  passCompletionPct: 0,
  hasCompletedOnboarding: false,
  completedCategoryNums: [],
  outingsAttended: 0,
  outingsHosted: 0,
  standingKey: 'new_here',
  deepProfile: {},
};

export const DEFAULT_PITCHES: PitchedOuting[] = [];

let cacheAccount: string | null = null;
export function setProfileCacheAccount(userId: string | null): void {
  cacheAccount = userId;
}
export function isProfileCacheAccount(userId: string): boolean { return cacheAccount === userId; }
function cacheKey(key: string): string {
  return `${key}:v2:${cacheAccount ?? 'guest'}`;
}

export function getUserProfile(): UserProfileData {
  if (typeof window === 'undefined') return DEFAULT_USER_PROFILE;
  try {
    const saved = localStorage.getItem(cacheKey('soul_tribe_user_profile'));
    if (saved) {
      const parsed = JSON.parse(saved);
      const completedCats = parsed.completedCategoryNums !== undefined
        ? parsed.completedCategoryNums
        : [];
      const hasOnboarded = parsed.hasCompletedOnboarding ?? false;
      const calculatedPct = calculatePassCompletion(hasOnboarded, completedCats);

      const result: UserProfileData = {
        ...DEFAULT_USER_PROFILE,
        ...parsed,
        version: 10,
        passCompletionPct: calculatedPct,
        completedCategoryNums: completedCats,
        hasCompletedOnboarding: hasOnboarded,
        deepProfile: {
          ...DEFAULT_USER_PROFILE.deepProfile,
          ...(parsed.deepProfile || {}),
        },
      };

      localStorage.setItem(cacheKey('soul_tribe_user_profile'), JSON.stringify(result));
      return result;
    }
  } catch (e) {
    console.error('Failed to read user profile', e);
  }
  return DEFAULT_USER_PROFILE;
}

export function setUserProfile(data: Partial<UserProfileData>): UserProfileData {
  const current = getUserProfile();
  const completedCats = data.completedCategoryNums !== undefined
    ? data.completedCategoryNums
    : (current.completedCategoryNums || []);
  const hasOnboarded = data.hasCompletedOnboarding !== undefined
    ? data.hasCompletedOnboarding
    : (current.hasCompletedOnboarding ?? false);

  const calculatedPct = calculatePassCompletion(hasOnboarded, completedCats);

  const updated: UserProfileData = {
    ...current,
    ...data,
    version: 10,
    passCompletionPct: calculatedPct,
    completedCategoryNums: completedCats,
    hasCompletedOnboarding: hasOnboarded,
    deepProfile: data.deepProfile ?? current.deepProfile ?? {},
  };

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(cacheKey('soul_tribe_user_profile'), JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save user profile', e);
    }
  }
  return updated;
}

export function getUserPitches(): PitchedOuting[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(cacheKey('soul_tribe_user_pitches'));
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to read user pitches', e);
  }
  return [];
}

export function addUserPitch(newPitch: PitchedOuting): PitchedOuting[] {
  const current = getUserPitches();
  const updated = [newPitch, ...current];
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(cacheKey('soul_tribe_user_pitches'), JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save user pitch', e);
    }
  }
  return updated;
}

export function removeUserPitchLocal(outingId: string): PitchedOuting[] {
  const current = getUserPitches();
  const updated = current.filter((p) => p.id !== outingId);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(cacheKey('soul_tribe_user_pitches'), JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to remove user pitch', e);
    }
  }
  return updated;
}

export function getJoinedOutingsLocal(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(cacheKey('soul_tribe_joined_outings'));
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error('Failed to read joined outings', e);
  }
  return [];
}

export function addJoinedOutingLocal(outingId: string): string[] {
  const current = getJoinedOutingsLocal();
  if (current.includes(outingId)) return current;
  const updated = [...current, outingId];
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(cacheKey('soul_tribe_joined_outings'), JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save joined outing', e);
    }
  }
  return updated;
}

export function removeJoinedOutingLocal(outingId: string): string[] {
  const current = getJoinedOutingsLocal();
  const updated = current.filter((id) => id !== outingId);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(cacheKey('soul_tribe_joined_outings'), JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to remove joined outing', e);
    }
  }
  return updated;
}
