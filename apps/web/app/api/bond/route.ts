import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { toProfileVector } from '../../../lib/profileAdapter';
import { adaptRowToUserData } from '../../../lib/profileRowAdapter';
import {loadPairEvidence,cachedRead,evidenceHash} from '../../../lib/readEngine/server';
import {connectionThread} from '../../../lib/readEngine/compose';
import {poeticReadingSummary} from '../../../lib/readEngine/poeticEngine';
import {pairClaims} from '../../../lib/readEngine/relational';
import {evidenceThreadReading} from '../../../lib/readEngine/threadReading';
import {THREAD_NAMES,type EvidenceBundle} from '../../../lib/readEngine/evidence';
import {
  score,
  softGate,
  BASELINE_WEIGHTS,
  ProfileVector,
  getBondThreadPhrase,
  getHeadlineForAlignment,
  evaluateMechanism,
  calculateAsymmetricFit,
} from '@soul-tribe/core';
import type { ThreadKey } from '@soul-tribe/core';

export const runtime = 'nodejs';

function isThreadAnswered(vec: ProfileVector, key: string): boolean {
  if (!vec) return false;
  if (key === 'personality') return (vec.personality?.answered ?? 0) > 0;
  if (key === 'communication') return (vec.communication?.answered ?? 0) > 0;
  if (key === 'social_rhythm') return (vec.social_rhythm?.answered ?? 0) > 0;
  if (key === 'intent') return (vec.intent?.answered ?? 0) > 0;
  if (key === 'emotional') return (vec.emotional?.answered ?? 0) > 0;
  if (key === 'interests') return (vec.interests?.length ?? 0) > 0;
  if (key === 'values') return (vec.values?.length ?? 0) > 0;
  if (key === 'lifestyle') return (vec.lifestyle?.answered ?? 0) > 0;
  if (key === 'experience') return (vec.experience?.answered ?? 0) > 0;
  if (key === 'geography') return (vec.geography?.answered ?? 0) > 0;
  return false;
}

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




export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : null;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock.supabase.co';
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'mock-pub-key';
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-secret-key';

  let authUserId: string | null = null;

  if (token) {
    const authClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } });
    const { data: { user }, error } = await authClient.auth.getUser(token);
    if (!error && user) {
      authUserId = user.id;
    }
  }

  if (!authUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });

  // 2. Parse request body
  const body = await req.json().catch(() => ({}));
  const candidateId = body.candidateId;

  if (!candidateId || typeof candidateId !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidateId)) {
    return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });
  }

  // 3. Fetch profiles from database bypassing RLS
  const profileSelection = `
      id,
      profile_version,
      explanation_revision,
      display_name,
      avatar_url,
      home_area,
      bio,
      birth_year,
      life_contexts,
      public_onboarding,
      age_pref_min,
      age_pref_max,
      status,
      is_demo,
      trait_intent (*),
      trait_repair (*),
      trait_communication (*),
      trait_personality (*),
      trait_social_rhythm (*),
      trait_emotional (*),
      trait_experience (*),
      trait_lifestyle (*),
      trait_geography (*),
      user_interests (*, interest_nodes (name,path)),
      user_values (*)
    `;
  let { data: dbProfiles, error: fetchErr } = await adminClient
    .from('profiles')
    .select(profileSelection)
    .in('id', [authUserId, candidateId]);

  // Older deployments identify seeded demo accounts by their reserved UUIDs.
  // Only retry for this exact optional-column mismatch; all other errors fail closed.
  if (fetchErr?.code === '42703' && /column (?:profiles\.)?is_demo does not exist/i.test(fetchErr.message)) {
    const legacyResult = await adminClient
      .from('profiles')
      .select(profileSelection.replace(/\s+is_demo,/, ''))
      .in('id', [authUserId, candidateId]);
    // The dynamic projection has the same fields except is_demo, which is absent.
    dbProfiles = legacyResult.data as unknown as typeof dbProfiles;
    fetchErr = legacyResult.error;
  }

  if (fetchErr || !dbProfiles) {
    return NextResponse.json({ error: 'Failed to fetch profile data' }, { status: 500 });
  }

  const viewerRow = dbProfiles.find((p: any) => p.id === authUserId);
  const candRow = dbProfiles.find((p: any) => p.id === candidateId);

  if (!viewerRow || !candRow || (candRow as any).is_demo || candRow.id.startsWith('00000000-0000-0000-0000-')) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const [blocked, reported] = await Promise.all([
    adminClient.from('blocks').select('blocker_id,blocked_id').or(`blocker_id.eq.${authUserId},blocked_id.eq.${authUserId}`),
    adminClient.from('reports').select('reporter_id,reported_id').or(`reporter_id.eq.${authUserId},reported_id.eq.${authUserId}`),
  ]);
  if (blocked.error || reported.error) return NextResponse.json({ error: 'Unable to verify access' }, { status: 503 });
  if (viewerRow.status !== 'active' || candRow.status !== 'active' ||
      blocked.data?.some(b => b.blocker_id === candidateId || b.blocked_id === candidateId) ||
      reported.data?.some(r => r.reporter_id === candidateId || r.reported_id === candidateId)) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  // Build ProfileVectors
  const viewerVec = toProfileVector(adaptRowToUserData(viewerRow), authUserId);
  const candVec = toProfileVector(adaptRowToUserData(candRow), candidateId);

  const matchRes = score(viewerVec, candVec, {allowProvisionalRanking:true});
  const softRes = softGate(matchRes, { provisionalFloor: 0.0 });
  const asymmetric = calculateAsymmetricFit(viewerVec, candVec, matchRes.resonance);
  const evidenceClient=createClient(supabaseUrl,publishableKey,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  let composed;let visibleBundle:EvidenceBundle;
  try{
    const bundle=await loadPairEvidence(evidenceClient,authUserId,candidateId);
    visibleBundle=bundle;
    composed=await cachedRead(adminClient,authUserId,candidateId,bundle);
    if(evidenceHash(await loadPairEvidence(evidenceClient,authUserId,candidateId))!==composed.hash)throw new Error('Reading access or evidence changed. Please retry.');
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to compose this reading'},{status:503});}

  const minConfidence = Math.min(viewerVec.profile.confidence, candVec.profile.confidence);

  const threadKeys = [
    'personality',
    'communication',
    'intent',
    'emotional',
    'values',
    'interests',
    'social_rhythm',
    'lifestyle',
    'experience',
    'geography',
  ];

  const threads = threadKeys.map((key) => {
    const isAnsweredA = isThreadAnswered(viewerVec, key);
    const isAnsweredB = isThreadAnswered(candVec, key);
    const isKnown = isAnsweredA && isAnsweredB && (key !== 'values' || (viewerVec.values?.every(v => v.visibility === 'public') && candVec.values?.every(v => v.visibility === 'public')));
    const weight = (BASELINE_WEIGHTS[key as keyof typeof BASELINE_WEIGHTS] ?? 0)
      +(typeof matchRes.contributions.repair!=='number'&&['personality','communication','intent'].includes(key)?2:0);

    const contrib = matchRes.contributions[key];
    const interpretation=connectionThread(visibleBundle,key);
    if(interpretation)return {...evidenceThreadReading(visibleBundle,key as keyof typeof THREAD_NAMES),weight,
      ...(isKnown&&typeof contrib==='number'&&key!=='emotional'?{alignment:contrib}:{})};
    if (!isKnown || typeof contrib !== 'number') {
      return {
        key,
        status: 'unknown' as const,
        weight,
      };
    }

    const alignment = contrib;
    const mech = evaluateMechanism(key as ThreadKey, alignment, viewerVec, candVec);
    const headline = mech.outputState;
    const phrase = key==='emotional' ? 'Original emotional answers are not available for an evidence-backed interpretation yet.' : getBondThreadPhrase(key, viewerVec, candVec, alignment);

    return {
      key,
      status: 'known' as const,
      headline,
      ...(key==='emotional'?{}:{alignment}),
      weight,
      phrase,
      mechanism: mech.mechanism.toLowerCase() as 'alignment' | 'complementarity' | 'friction' | 'context',
      frictionClass: mech.severity || mech.frictionType,
      outputState: mech.outputState,
    };
  });

  const THREAD_LABELS: Record<string, string> = {
    personality: 'personality',
    communication: 'communication style',
    social_rhythm: 'social rhythm & availability',
    intent: 'friendship intent',
    emotional: 'emotional pacing',
    interests: 'interests & hobbies',
    values: 'core values',
    lifestyle: 'lifestyle habits',
    experience: 'outing preferences',
    geography: 'preferred neighbourhoods',
  };

  // Same/different is an answer oracle when the viewer knows their own operand.
  // Do not release it (or a numeric direction) before verified shared attendance.
  threads.push({...evidenceThreadReading(visibleBundle,'repair'),weight:6});
  const invitationA=visibleBundle.sources.find(s=>s.subject==='self'&&s.thread==='initiative');
  const invitationB=visibleBundle.sources.find(s=>s.subject==='other'&&s.thread==='initiative');
  const aInit=viewerVec.communication?.initiation_self,bInit=candVec.communication?.initiation_self;
  const hasInitiative=!!(invitationA&&invitationB)||(typeof aInit==='number'&&typeof bInit==='number');
  const initiativeRead=evidenceThreadReading(visibleBundle,'initiative');
  threads.push(initiativeRead.status==='known'?{...initiativeRead,weight:0}:hasInitiative?{key:'initiative',status:'known',weight:0,
    phrase:invitationA&&invitationB?`Your invitation pattern: ${invitationA.selections.join(' · ')}. Their invitation pattern: ${invitationB.selections.join(' · ')}.`:'Both of you have separately answered the invitation question. This facet carries no extra ranking weight.',
    mechanism:'context',headline:'Moderate',frictionClass:undefined,outputState:'Moderate'}:{key:'initiative',status:'unknown',weight:0});

  const viewerGaps: { questionId: string; prompt: string; href: string }[] = [];
  const candidateGaps: { questionId: string; prompt: string; href: string }[] = [];

  for (const key of threadKeys) {
    const viewerAns = isThreadAnswered(viewerVec, key);
    const candAns = isThreadAnswered(candVec, key);

    if (!viewerAns) {
      viewerGaps.push({
        questionId: key,
        prompt: QUESTION_MAP[key]?.prompt || `Answer questions on ${key} to refine match precision`,
        href: QUESTION_MAP[key]?.href || '/you/deeper',
      });
    } else if (!candAns) {
      const label = THREAD_LABELS[key] || key.replace('_', ' ');
      candidateGaps.push({
        questionId: key,
        prompt: `${candVec.profile.display_name} hasn't shared their ${label} yet, this part sharpens when they do.`,
        href: '',
      });
    }
  }

  const sharpen = [...viewerGaps.slice(0, 3)];
  if (sharpen.length < 3) {
    sharpen.push(...candidateGaps.slice(0, 3 - sharpen.length));
  }

  return NextResponse.json({
    candidate: { id: candRow.id, displayName: candRow.display_name, bio: candRow.bio, homeArea: candRow.home_area },
    clickText: poeticReadingSummary(composed.read, composed.read.sections[0]?.text??''),
    composedRead:composed.read,
    readHash:composed.hash,
    writerVersion:composed.writerVersion,
    overall: {
      rankScore: softRes.adjustedScore,
      resonance: matchRes.resonance,
      logistics: matchRes.logistics,
      confidence: minConfidence,
      provisional: softRes.provisional,
      fitAtoB: asymmetric.fitAtoB,
      fitBtoA: asymmetric.fitBtoA,
      imbalance: asymmetric.imbalance,
    },
    threads:threads.map(t=>({...t,name:THREAD_NAMES[t.key as keyof typeof THREAD_NAMES],
      readingState:'readingState' in t?t.readingState:t.status!=='known'?'not yet measured':t.mechanism==='friction'?'needs a little care':t.mechanism==='alignment'?'common ground':'still taking shape',
      evidence:visibleBundle.sources.filter(s=>s.thread===t.key).map(s=>({questionId:s.questionId,questionVersion:s.questionVersion,selections:s.selections,subject:s.subject}))})),
    rubText: pairClaims(visibleBundle).find(c=>c.tone==='friction')?.text??'',
    sharpen,
  },{headers:{'Cache-Control':'private, no-store'}});
}
