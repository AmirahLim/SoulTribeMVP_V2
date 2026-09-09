import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { toProfileVector } from '../../../../lib/profileAdapter';
import { adaptRowToUserData } from '../../../../lib/profileRowAdapter';
import { buildSavedAnswerRead } from '../../../../lib/savedAnswerRead';
import {buildEvidence, THREAD_NAMES} from '../../../../lib/readEngine/evidence';
import {composeRead,availableClaims} from '../../../../lib/readEngine/compose';
import {cachedRead,loadOwnEvidence,evidenceHash} from '../../../../lib/readEngine/server';
import {
  extractMarkers,
  composeWithinPerson,
  PHRASES_YOU,
  confidenceFromCompleteness,
  generateSelfProfile,
} from '@soul-tribe/core';
import type { ProfileVector } from '@soul-tribe/core';

export const runtime = 'nodejs';

// ─── Value key humanizer ─────────────────────────────────────────────

function humanizeValueKey(key: string): string {
  if (!key) return '';
  // Split on double/triple underscores, or commas
  const rawParts = key.split(/_{2,}|,/);
  const cleanParts = rawParts.map((part) => {
    let words = part.replace(/^_+|_+$/g, '').replace(/_+/g, ' ').trim();
    if (!words) return '';
    // Special handling for the long onboarding question quote:
    if (words.toLowerCase().includes('change their mind')) {
      return 'Open-mindedness';
    }
    if (words.toLowerCase().includes('better information')) {
      return 'Intellectual honesty';
    }
    if (words.length > 28) {
      words = words.split(' ').slice(0, 3).join(' ');
    }
    return words.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }).filter(Boolean);

  return cleanParts.join(', ');
}

// ─── Expected answer counts per thread (for evidence depth) ──────────

const EXPECTED_ANSWERS: Record<string, number> = {
  personality: 6,
  communication: 8,
  social_rhythm: 6,
  intent: 4,
  emotional: 4,
  interests: 3,
  values: 3,
  lifestyle: 4,
  experience: 4,
  geography: 2,
};

const THREAD_DISPLAY_NAMES: Record<string, string> = {
  personality: 'Social Energy',
  communication: 'Communication',
  social_rhythm: 'Social Rhythm',
  intent: 'Friendship Style',
  emotional: 'Emotional Connection',
  interests: 'Interests',
  values: 'Values',
  lifestyle: 'Lifestyle',
  experience: 'Outing Style',
  geography: 'Availability',
};

const THREAD_ORDER = [
  'personality', 'communication', 'social_rhythm', 'intent', 'emotional',
  'interests', 'values', 'lifestyle', 'experience', 'geography',
] as const;

const QUESTION_MAP: Record<string, { prompt: string; href: string }> = {
  personality: { prompt: 'Share your social energy style and MBTI type', href: '/you/deeper?cat=1' },
  communication: { prompt: 'Clarify your preferred messaging mediums & reply pace', href: '/you/deeper?cat=2' },
  social_rhythm: { prompt: 'Set your weekend availability & planning rhythm', href: '/you/deeper?cat=3' },
  intent: { prompt: 'Specify what depth of friendship you are looking for', href: '/you/deeper?cat=4' },
  emotional: { prompt: 'Define your opening pace for personal conversations', href: '/you/deeper?cat=5' },
  interests: { prompt: 'Tag your favorite weekend activities & hobbies', href: '/onboarding' },
  values: { prompt: 'Pick the core character traits you value most in friends', href: '/onboarding' },
  lifestyle: { prompt: 'Add your coffee, dining, and weekend lifestyle habits', href: '/you/deeper?cat=6' },
  experience: { prompt: 'Share your preferred group size & outing vibe', href: '/you/deeper?cat=7' },
  geography: { prompt: 'Set your preferred Singapore neighbourhoods', href: '/profile' },
};

// ─── Marker-to-descriptor mapping ────────────────────────────────────

const MARKER_DESCRIPTORS: Record<string, string[]> = {
  'socially-selective': ['Intimate', 'Selective'],
  'socially-expansive': ['Social', 'Expansive'],
  'energy-conserving': ['Quiet', 'Measured'],
  'harmony-focused': ['Warm', 'Diplomatic'],
  'direct-challenging': ['Direct', 'Candid'],
  'novelty-seeking': ['Curious', 'Adventurous'],
  'familiarity-comfort': ['Steady', 'Grounded'],
  'structured-routine': ['Organised', 'Consistent'],
  'spontaneous-flow': ['Spontaneous', 'Flexible'],
  'playful': ['Playful', 'Light-hearted'],
  'serious-reflective': ['Thoughtful', 'Reflective'],
  'low-contact': ['Low-pressure', 'Intentional'],
  'async-pacer': ['Unhurried', 'Patient'],
  'frequent-touchpoints': ['Connected', 'Responsive'],
  'rapid-responder': ['Prompt', 'Attentive'],
  'diplomatic-expresser': ['Diplomatic', 'Considered'],
  'direct-communicator': ['Direct', 'Upfront'],
  'proactive-initiator': ['Proactive', 'Organiser'],
  'responsive-joiner': ['Responsive', 'Agreeable'],
  'advance-planning': ['Structured', 'Planned'],
  'spontaneous': ['Spontaneous', 'Flexible'],
  'depth-oriented': ['Close', 'Intentional'],
  'casual-vibe': ['Casual', 'Easy-going'],
  'gradual-opening': ['Gradual', 'Patient'],
  'fast-opening': ['Open', 'Expressive'],
  'trust-first': ['Watchful', 'Careful'],
  'vulnerable-sharer': ['Open-hearted', 'Transparent'],
  'boundary-guarded': ['Private', 'Measured'],
  'intimate-group-oriented': ['Small-circle', 'Focused'],
  'large-group-oriented': ['Group', 'Social'],
};

// ─── Thread answer count from vector ─────────────────────────────────

function getAnswered(vec: ProfileVector, key: string): number {
  switch (key) {
    case 'personality': return vec.personality?.answered ?? 0;
    case 'communication': return vec.communication?.answered ?? 0;
    case 'social_rhythm': return vec.social_rhythm?.answered ?? 0;
    case 'intent': return vec.intent?.answered ?? 0;
    case 'emotional': return vec.emotional?.answered ?? 0;
    case 'interests': return vec.interests?.length ?? 0;
    case 'values': return vec.values?.length ?? 0;
    case 'lifestyle': return vec.lifestyle?.answered ?? 0;
    case 'experience': return vec.experience?.answered ?? 0;
    case 'geography': return vec.geography?.answered ?? 0;
    default: return 0;
  }
}

// ─── Sentence from PHRASES_YOU (never invented prose) ────────────────

function buildNote(vec: ProfileVector, key: string): string | null {
  switch (key) {
    case 'personality': {
      const ext = vec.personality?.extraversion;
      if (typeof ext === 'number') return `You ${PHRASES_YOU.extraversion(ext)}.`;
      return null;
    }
    case 'communication': {
      const resp = vec.communication?.response_speed_self;
      if (typeof resp === 'number') return `You ${PHRASES_YOU.responseSpeed(resp)}.`;
      const init = vec.communication?.initiation_self;
      if (typeof init === 'number') return `You ${PHRASES_YOU.initiation(init)}.`;
      return null;
    }
    case 'social_rhythm': {
      const plan = vec.social_rhythm?.planning_horizon;
      if (typeof plan === 'number') return `You ${PHRASES_YOU.planningHorizon(plan)}.`;
      return null;
    }
    case 'intent': {
      const depth = vec.intent?.depth;
      if (typeof depth === 'number') return `You ${PHRASES_YOU.depth(depth)}.`;
      return null;
    }
    case 'emotional': {
      const pace = vec.emotional?.er_opening_pace;
      if (typeof pace === 'number') return `You ${PHRASES_YOU.openingPace(pace)}.`;
      const cad = vec.emotional?.er_cadence_need;
      if (typeof cad === 'number') return `You ${PHRASES_YOU.cadenceNeed(cad)}.`;
      return null;
    }
    case 'interests': {
      if (vec.interests && vec.interests.length > 0) {
        const names = vec.interests.slice(0, 3).map((i) => i.node_name || i.node_path);
        if (names.length === 1) return `You tagged ${names[0]}.`;
        return `You tagged ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;
      }
      return null;
    }
    case 'values': {
      if (vec.values && vec.values.length > 0) {
        const names = vec.values.slice(0, 3).map((v) => humanizeValueKey(v.value_key));
        if (names.length === 1) return `You chose ${names[0]}.`;
        return `You chose ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;
      }
      return null;
    }
    case 'lifestyle': {
      const budget = vec.lifestyle?.budget_band;
      if (typeof budget === 'number') return `You ${PHRASES_YOU.budgetBand(budget)}.`;
      return null;
    }
    case 'experience': {
      const grp = vec.experience?.group_size_pref;
      if (typeof grp === 'number') return `You ${PHRASES_YOU.groupSize(grp)}.`;
      return null;
    }
    case 'geography': {
      const area = vec.geography?.home_area;
      if (area) return `Based in ${area}.`;
      return null;
    }
    default: return null;
  }
}

// ─── Descriptors from markers for this thread ────────────────────────

function buildDescriptor(markers: Array<{ key: string; thread: string }>, threadKey: string): string[] {
  const threadMarkers = markers.filter((m) => m.thread === threadKey);
  for (const m of threadMarkers) {
    const desc = MARKER_DESCRIPTORS[m.key];
    if (desc) return desc;
  }
  return [];
}

// ─── Extra visual data ───────────────────────────────────────────────

function buildExtraVisualData(vec: ProfileVector, key: string): Record<string, unknown> | undefined {
  if (key === 'personality') {
    const grp = vec.experience?.group_size_pref;
    if (typeof grp === 'number') {
      const activeGroup = grp <= 0.3 ? '1:1' : grp <= 0.5 ? '3–4' : grp <= 0.7 ? '5–8' : 'Crowd';
      return { activeGroup };
    }
    return undefined;
  }
  if (key === 'social_rhythm' && vec.social_rhythm?.availability) {
    const avail = vec.social_rhythm.availability;
    const daySet = new Set<string>();
    const dayMap: Record<string, string> = { mon: 'M', tue: 'T', wed: 'W', thu: 'Th', fri: 'F', sat: 'S', sun: 'S2' };
    for (const slot of avail) {
      const prefix = slot.split('_')[0]?.toLowerCase();
      if (prefix && dayMap[prefix]) daySet.add(dayMap[prefix]);
    }
    if (daySet.size > 0) return { activeDays: Array.from(daySet) };
    return undefined;
  }
  if (key === 'intent') {
    const depth = vec.intent?.depth;
    const ext = vec.personality?.extraversion;
    if (typeof depth === 'number') {
      const mapY = Math.max(10, Math.min(90, 100 - (depth / 4) * 80));
      const mapX = typeof ext === 'number' ? Math.max(10, Math.min(90, ext * 80 + 10)) : 40;
      return { mapX, mapY };
    }
    return undefined;
  }
  return undefined;
}

// ─── Signals from markers ────────────────────────────────────────────

function buildSignals(markers: Array<{ key: string; thread: string }>, threadKey: string) {
  return markers
    .filter((m) => m.thread === threadKey)
    .filter((m) => !m.key.startsWith('interest-') && !m.key.startsWith('value-') && !m.key.startsWith('area-') && !m.key.startsWith('budget-'))
    .map((m) => ({
      key: m.key,
      label: m.key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      evidenceLevel: 'DIRECT' as const,
    }));
}

// ─── GET handler ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock.supabase.co';
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'mock-pub-key';

  // Auth with caller's own token — no service role key
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authErr } = await client.auth.getUser(token);
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const authUserId = user.id;

  // Fetch profile with trait joins — goes through RLS (own rows only)
  const { data: row, error: fetchErr } = await client
    .from('profiles')
    .select(`
      id, display_name, handle, avatar_url, home_area, bio,
      trait_intent (*),
      trait_communication (*),
      trait_personality (*),
      trait_social_rhythm (*),
      trait_emotional (*),
      trait_experience (*),
      trait_lifestyle (*),
      trait_geography (*),
      user_interests (*, interest_nodes (name,path)),
      user_values (*)
    `)
    .eq('id', authUserId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[SoulTribe] own profile query failed', {code: fetchErr.code, message: fetchErr.message});
    return NextResponse.json({error: fetchErr.message}, {status: 500});
  }
  if (!row) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  // Owner-scoped original answers, through the caller's JWT and existing RLS.
  // Keep categorical evidence out of the legacy numeric inference adapter.
  const {data: savedAnswers, error: answersError} = await client.from('profile_answers')
    .select('onboarding,deep_profile,completed_categories').eq('user_id', authUserId).maybeSingle();
  if (answersError) {
    console.error('[SoulTribe] own answers query failed', {code: answersError.code, message: answersError.message});
    return NextResponse.json({error: answersError.message}, {status: 500});
  }
  const savedAnswerRead = buildSavedAnswerRead(savedAnswers);
  let evidenceBundle;
  try{evidenceBundle=await loadOwnEvidence(client,authUserId,savedAnswers);}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to load answer versions'},{status:500});}
  let composedRead = composeRead(evidenceBundle);
  const cacheSecret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(cacheSecret){
    try{composedRead=(await cachedRead(createClient(supabaseUrl,cacheSecret,{auth:{persistSession:false}}),authUserId,authUserId,evidenceBundle)).read;}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to prepare your reading'},{status:503});}
  }
  // Detect an answer withdrawal or edit while the cache was being prepared.
  const freshAnswers=await client.from('profile_answers').select('onboarding,deep_profile,completed_categories').eq('user_id',authUserId).maybeSingle();
  if(freshAnswers.error)return NextResponse.json({error:freshAnswers.error.message},{status:500});
  try{if(evidenceHash(await loadOwnEvidence(client,authUserId,freshAnswers.data))!==evidenceHash(evidenceBundle))
    return NextResponse.json({error:'Your answers changed while the read was loading. Please retry.'},{status:409});}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to verify your answers'},{status:500});}

  // Build vector
  const userData = adaptRowToUserData(row);
  const vec = toProfileVector(userData, authUserId);

  // Compute markers
  const rawMarkers = extractMarkers(vec, vec.answers);
  const markers = composeWithinPerson(rawMarkers);
  const markerKeys = markers.map((m) => m.key);

  // Build thread array
  const threads: any[] = [];
  let threadsExplored = 0;

  for (const key of THREAD_ORDER) {
    const answered = getAnswered(vec, key);
    const name = THREAD_NAMES[key];

    if (answered === 0) {
      const q = QUESTION_MAP[key];
      threads.push({
        key,
        name,
        status: 'unknown',
        nextPrompt: q.prompt,
        nextHref: q.href,
      });
      continue;
    }

    // Thread is known
    threadsExplored++;
    const expected = EXPECTED_ANSWERS[key];
    const strength = Math.min(1, answered / expected);
    const confidence = strength; // same basis

    const note = buildNote(vec, key);
    const descriptor = buildDescriptor(markers, key);
    const signals = buildSignals(markers, key);
    const extraVisualData = buildExtraVisualData(vec, key);

    // If we have no phrase-able field answered, mark as unknown
    if (note === null) {
      const q = QUESTION_MAP[key];
      threads.push({
        key,
        name,
        status: 'unknown',
        nextPrompt: q.prompt,
        nextHref: q.href,
      });
      threadsExplored--; // not actually explorable
      continue;
    }

    const thread: any = {
      key,
      name,
      status: 'known',
      strength,
      confidence,
      descriptor,
      note,
      signals,
    };
    if (extraVisualData) thread.extraVisualData = extraVisualData;
    threads.push(thread);
  }

  for(const key of ['repair','initiative'] as const){
    const sources=evidenceBundle.sources.filter(s=>s.thread===key);
    const claims=availableClaims(evidenceBundle).filter(c=>c.threads.includes(key));
    const legacyInitiative=key==='initiative'&&typeof vec.communication?.initiation_self==='number';
    const known=sources.length>0||legacyInitiative;
    threads.push({key,name:THREAD_NAMES[key],status:known?'known':'unknown',
      ...(known?{note:claims[0]?.text??`You ${PHRASES_YOU.initiation(vec.communication!.initiation_self!)}.`,evidence:sources}
        :{nextPrompt:key==='repair'?'Share what helps after something feels off.':'Share how invitations usually begin.',nextHref:key==='repair'?'/you/deeper?cat=11':'/you/deeper?cat=2'})});
    if(key==='repair'&&known)threadsExplored++;
  }
  // Top-level confidence
  const topConfidence = typeof confidenceFromCompleteness === 'function'
    ? confidenceFromCompleteness(vec)
    : Math.min(1, threadsExplored / 10);

  // Self-profile synthesis from core engine
  const selfProfile = generateSelfProfile(vec);
  // A missing composite rule is not missing member data. Show supported direct
  // evidence until the separately approved composition/voice work is released.
  if (savedAnswerRead.facts.length) {
    selfProfile.tribalRead = {
      ...selfProfile.tribalRead,
      headline: composedRead.sections[0]?.title ?? 'Your reading is taking shape',
      summary: composedRead.sections[0]?.text || savedAnswerRead.facts.slice(0, 3).map(fact => fact.note).join(' '),
      sections: selfProfile.tribalRead.sections,
    };
  }

  const DEFAULT_VALUE_POSITIONS = [
    { x: 0.50, y: 0.46, weight: 1.0 },
    { x: 0.24, y: 0.24, weight: 0.66 },
    { x: 0.78, y: 0.28, weight: 0.62 },
    { x: 0.72, y: 0.76, weight: 0.55 },
    { x: 0.22, y: 0.72, weight: 0.58 },
  ];

  const DEFAULT_INTEREST_POSITIONS = [
    { x: 0.50, y: 0.30, weight: 1.0, isRabbitHole: true },
    { x: 0.20, y: 0.58, weight: 0.7 },
    { x: 0.76, y: 0.56, weight: 0.75 },
    { x: 0.38, y: 0.83, weight: 0.6 },
    { x: 0.82, y: 0.20, weight: 0.55 },
  ];

  // Interests and values with normalized 0..1 coordinates for canvas rendering
  const interests = (vec.interests || []).map((i, idx) => {
    const pos = DEFAULT_INTEREST_POSITIONS[idx % DEFAULT_INTEREST_POSITIONS.length];
    return {
      name: i.node_name || i.node_path || '',
      x: pos.x,
      y: pos.y,
      weight: pos.weight,
      isRabbitHole: pos.isRabbitHole,
    };
  });

  // Flatten, parse, and deduplicate values into clean single-word tags
  const rawValues = (row.user_values || []) as any[];
  const distinctValueLabels: string[] = [];
  for (const v of rawValues) {
    const rawKey = (v.value_name || v.value_key || '') as string;
    const parts = rawKey.split(/_{2,}|,|\/|\band\b/i);
    for (const part of parts) {
      let word = part.replace(/^_+|_+$/g, '').replace(/_+/g, ' ').trim();
      if (!word) continue;
      if (word.toLowerCase().includes('change their mind')) word = 'Open-mindedness';
      else if (word.toLowerCase().includes('better information')) word = 'Adaptability';
      else if (word.length > 20) word = word.split(' ')[0];
      word = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      if (!distinctValueLabels.includes(word)) {
        distinctValueLabels.push(word);
      }
    }
  }

  // Top 5 unique values strictly mapped 1-to-1 to constellation positions
  const topValues = distinctValueLabels.slice(0, 5);
  const values = topValues.map((label, idx) => {
    const pos = DEFAULT_VALUE_POSITIONS[idx];
    return {
      label,
      name: label,
      x: pos.x,
      y: pos.y,
      weight: pos.weight,
    };
  });

  // Derive optional sections only when real answers exist behind them
  const tension = selfProfile.contradiction;
  const connectionNotes = (selfProfile.connectionNotes && selfProfile.connectionNotes.length > 0)
    ? selfProfile.connectionNotes
    : undefined;
  const socialInstinct = markers.length > 0 ? selfProfile.primaryInstinct : undefined;

  const hasBoundaryData =
    vec.personality?.conscientiousness !== undefined ||
    vec.social_rhythm?.planning_horizon !== undefined ||
    vec.experience?.group_size_pref !== undefined ||
    (Boolean(vec.geography?.home_area) && (vec.geography?.answered || 0) > 0);

  const boundaries = hasBoundaryData
    ? {
        punctualityStance: vec.personality?.conscientiousness !== undefined ? selfProfile.boundaries.punctualityStance : undefined,
        cancellationStance: vec.social_rhythm?.planning_horizon !== undefined ? selfProfile.boundaries.cancellationStance : undefined,
        groupSizeBoundary: vec.experience?.group_size_pref !== undefined ? selfProfile.boundaries.groupSizeBoundary : undefined,
        locationBoundary: (Boolean(vec.geography?.home_area) && (vec.geography?.answered || 0) > 0)
          ? selfProfile.boundaries.locationBoundary
          : undefined,
      }
    : undefined;

  const response: Record<string, any> = {
    profile: {
      id: row.id,
      display_name: row.display_name || '',
      handle: row.handle || '',
      home_area: row.home_area || 'Singapore',
      avatar_url: row.avatar_url || undefined,
      bio: row.bio || undefined,
    },
    confidence: topConfidence,
    passCompletionPct: Math.round((threadsExplored / 11) * 100),
    threadsExplored,
    threadsTotal: 11,
    threads,
    markers: markerKeys,
    signalsCount: markers.length,
    tribalRead: selfProfile.tribalRead,
    savedAnswerRead,
    composedRead,
    outingPreferences: selfProfile.outingPreferences,
    interests,
    values,
  };

  if (tension) response.tension = tension;
  if (boundaries) response.boundaries = boundaries;
  if (connectionNotes) response.connectionNotes = connectionNotes;
  if (socialInstinct) response.socialInstinct = socialInstinct;

  return NextResponse.json(response, {headers: {'Cache-Control': 'private, no-store'}});
}
