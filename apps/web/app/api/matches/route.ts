import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  score,
  softGate,
  getGenderAvatarForName,
  buildMatchSurfacedEvent,
  recordEvent,
} from '@soul-tribe/core';
import type { MatchContext } from '@soul-tribe/core';
import { reflectionBoost, REFLECTION_RANKING_VERSION } from '../../../lib/reflectionRanking';
import { adaptRowToUserData } from '../../../lib/profileRowAdapter';
import { toProfileVector } from '../../../lib/profileAdapter';
import { getMatchExplanations } from '../../../lib/matchExplanationCache';
import {loadRosterEvidence,evidenceHash} from '../../../lib/readEngine/server';

export const runtime = 'nodejs';

function getFitLabel(
  rankScore: number,
  isProvisional?: boolean,
  minConfidence?: number
): string {
  if (isProvisional || (minConfidence !== undefined && minConfidence < 0.55)) {
    if (rankScore >= 0.60) return 'Early Read';
    if (rankScore >= 0.40) return 'Worth a Look';
    return '';
  }
  if (rankScore >= 0.90) return 'Rare Resonance';
  if (rankScore >= 0.80) return 'Strong Resonance';
  if (rankScore >= 0.70) return 'Natural Resonance';
  if (rankScore >= 0.60) return 'Some Resonance';
  return '';
}

export async function POST(req: NextRequest) {
  const requestStarted = performance.now();
  // 1. Authenticate caller using Authorization header or session token
  const authHeader = req.headers.get('authorization');
  const token = authHeader ? authHeader.replace('Bearer ', '').trim() : null;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missingEnv: string[] = [];
  if (!supabaseUrl) missingEnv.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!publishableKey) missingEnv.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (!secretKey) missingEnv.push('SUPABASE_SECRET_KEY');

  if (missingEnv.length > 0 || !supabaseUrl || !publishableKey || !secretKey) {
    return NextResponse.json(
      { error: `Server matching is unconfigured: missing ${missingEnv.join(', ')}` },
      { status: 500 }
    );
  }

  let authUserId: string | null = null;

  if (token) {
    const authClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } });
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (!authErr && user) {
      authUserId = user.id;
    }
  }

  if (!authUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const resultLimit = body.limit ?? 20;
    if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > 200)
      return NextResponse.json({error:'Match limit must be an integer from 1 to 200'}, {status:400});
    const radiusMeters = body.radiusMeters ?? 5000;
    if (!Number.isInteger(radiusMeters) || radiusMeters < 100 || radiusMeters > 50000)
      return NextResponse.json({error:'Match radius must be an integer from 100 to 50000 meters'}, {status:400});
    const allowedCategories = ['coffee', 'dining', 'active', 'cultural', 'nightlife', 'creative', 'intellectual'];
    if (body.activityCategory && !allowedCategories.includes(body.activityCategory)) return NextResponse.json({ error: 'Unknown activity category' }, { status: 400 });

    // 2. Secret Key Client bypassing RLS (SERVER ONLY)
    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false },
    });
    const userClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: localRows, error: spatialErr } = await userClient.rpc('filter_local_online_ids', {
      p_radius_meters: radiusMeters,
    });
    if (spatialErr) {
      console.error('[SoulTribe API] Spatial filter failed:', spatialErr);
      return NextResponse.json({ error: 'Failed to apply location filter' }, { status: 500 });
    }
    const localIds = [...new Set((localRows ?? []).map((row: { user_id: string }) => row.user_id).filter((id: string) => id && id !== authUserId))];

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
    const profileIds = [authUserId, ...localIds];
    const [
      {data:blocks,error:blockErr}, {data:reports,error:reportErr},
      {data:dbProfiles,error:fetchErr}, {data:viewerRow,error:viewerError},
      {data:learningPreference,error:preferenceError},
    ] = await Promise.all([
      adminClient.from('blocks').select('blocker_id,blocked_id').or(`blocker_id.eq.${authUserId},blocked_id.eq.${authUserId}`),
      adminClient.from('reports').select('reporter_id,reported_id').or(`reporter_id.eq.${authUserId},reported_id.eq.${authUserId}`),
      localIds.length === 0
        ? Promise.resolve({ data: [] as any[], error: null })
        : adminClient.from('profiles').select(profileSelection).in('id', profileIds),
      adminClient.from('profiles').select(profileSelection).eq('id',authUserId).eq('status','active').maybeSingle(),
      adminClient.from('recommendation_preferences').select('use_reflections').eq('user_id',authUserId).maybeSingle(),
    ]);

    if (blockErr || reportErr) {
      console.error('[SoulTribe API] Failed to load blocks/reports:', blockErr || reportErr);
      return NextResponse.json({ error: 'Failed to verify safety blocks' }, { status: 500 });
    }

    // Part 4.2: Cap to 200 profiles and select specific columns

    if (fetchErr) {
      console.error('[SoulTribe API] Database query error:', fetchErr);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    if (!dbProfiles || dbProfiles.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // Exclude demo candidates server side
    const nonDemoProfiles = dbProfiles.filter(
      (p: any) => !p.id.startsWith('00000000-0000-0000-0000-')
    );

    const blockedUserIds = (blocks || []).map((b: any) =>
      b.blocker_id === authUserId ? b.blocked_id : b.blocker_id
    );
    const reportedUserIds = (reports || []).map((r: any) =>
      r.reporter_id === authUserId ? r.reported_id : r.reporter_id
    );

    const candidatesPool = nonDemoProfiles.filter(
      (p) => p.id !== authUserId && p.status === 'active' && localIds.includes(p.id),
    );

    const context: MatchContext = {
      allowProvisionalRanking: true,
      activity_category: body.activityCategory,
      blockedUserIds,
      reportedUserIds,
      candidatePoolSize: candidatesPool.length,
    };

    // 3. Find viewer profile
    if (viewerError) return NextResponse.json({ error: 'Unable to load your profile' }, { status: 503 });
    if (!viewerRow) {
      return NextResponse.json([], { status: 200 });
    }

    const viewerVec = toProfileVector(adaptRowToUserData(viewerRow), authUserId);

    if (preferenceError) {
      console.error('[SoulTribe API] recommendation_preferences query failed:', {
        code: preferenceError.code,
        message: preferenceError.message,
      });
      return NextResponse.json({ error: preferenceError.message }, { status: 500 });
    }

    let ownReflections: Array<{ about_id: string; would_meet_again: number }> = [];
    if (learningPreference?.use_reflections) {
      const { data, error } = await adminClient
        .from('rhythm_checks')
        .select('about_id,would_meet_again')
        .eq('author_id', authUserId)
        .limit(200);
      if (error) {
        console.error('[SoulTribe API] rhythm_checks query failed:', {
          code: error.code,
          message: error.message,
        });
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      ownReflections = data || [];
    }
    // Rank every eligible candidate before generating display copy.
    const scoringStarted = performance.now();
    const candidates = candidatesPool;
    const rankedMatches = [];
    const candidateVecMap = new Map();
    const matchResMap = new Map();

    for (const candRow of candidates) {
      const candVec = toProfileVector(adaptRowToUserData(candRow), candRow.id);

      const matchRes = score(viewerVec, candVec, context);
      const softRes = softGate(matchRes, { provisionalFloor: 0.0 });
      if (!softRes.eligible) continue;


      candidateVecMap.set(candRow.id, candVec);
      matchResMap.set(candRow.id, matchRes);

      // SAFE DISCLOSURE: Return ONLY RankedMatch public fields
      rankedMatches.push({
        id: candRow.id,
        name: candRow.display_name || 'Member',
        avatarUrl: candRow.avatar_url || getGenderAvatarForName(candRow.display_name || 'Member'),
        homeArea: candRow.home_area || 'Singapore',
        bio: candRow.bio || 'Member in Singapore',
        rankScore: Math.min(1, softRes.adjustedScore + reflectionBoost(Boolean(learningPreference?.use_reflections), candRow.id, ownReflections)),
        resonance: matchRes.resonance,
        logistics: matchRes.logistics,
        fitLabel: getFitLabel(softRes.adjustedScore, softRes.provisional, Math.min(viewerVec.profile.confidence, candVec.profile.confidence)),
        provisional: softRes.provisional,
        isDemo: false,
      });
    }

    rankedMatches.sort((a, b) => b.rankScore - a.rankScore);
    const scoringMs = performance.now()-scoringStarted;
    const shortlisted = rankedMatches.slice(0,resultLimit);
    const candidateRows = new Map(candidates.map(row=>[row.id,row]));
    const evidenceClient=createClient(supabaseUrl,publishableKey,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${token}`}}});
    const bundles=await loadRosterEvidence(evidenceClient,authUserId,shortlisted.map(item=>item.id));
    const {explanations,metrics} = await getMatchExplanations(adminClient,
      {row:viewerRow,vector:viewerVec},
      shortlisted.map(item=>({row:candidateRows.get(item.id)!,vector:candidateVecMap.get(item.id)!})),bundles);
    const fresh=await loadRosterEvidence(evidenceClient,authUserId,shortlisted.map(item=>item.id));
    if([...bundles].some(([id,b])=>!fresh.has(id)||evidenceHash(b)!==evidenceHash(fresh.get(id)!)))
      throw new Error('Matching evidence changed while the reading was prepared. Please retry.');
    const returnedMatches = shortlisted.map(item=>({
      ...item,clickText:explanations.get(item.id)!.click_text,rubText:explanations.get(item.id)!.friction_text,
    }));

    // Part 1.5: Emit match surfaced events on server for real candidates
    let positionCounter = 1;
    for (const item of returnedMatches) {
      const candVec = candidateVecMap.get(item.id);
      const matchRes = matchResMap.get(item.id);
      if (candVec && matchRes) {
        const surfacedEvent = buildMatchSurfacedEvent(
          viewerVec,
          candVec,
          matchRes,
          positionCounter++,
          context,
          item.provisional
        );
        recordEvent(surfacedEvent);
      }
    }

    // Aggregate audit keeps private feedback out of client-visible text.
    const timing = {...metrics,scoring_ms:scoringMs,total_ms:performance.now()-requestStarted};
    const {error:auditError} = await adminClient.from('interaction_events').insert({
      actor_id: authUserId, event_type: 'recommendations_generated', engine_version: REFLECTION_RANKING_VERSION,
      payload: { count: returnedMatches.length, profiles_fetched:dbProfiles.length,non_demo:nonDemoProfiles.length,
        after_self_exclusion:candidates.length,eligible:rankedMatches.length,limit:resultLimit,
        spatial_pool: localIds.length, radius_meters: radiusMeters,
        reflections_enabled: Boolean(learningPreference?.use_reflections),timing } });
    if(auditError) {
      console.error('[SoulTribe] matching timing audit failed',{code:auditError.code,message:auditError.message});
      throw new Error(auditError.message);
    }
    const totalMs=performance.now()-requestStarted;
    return NextResponse.json(returnedMatches, { status: 200,headers:{
      'Cache-Control':'no-store',
      'Server-Timing':`scoring;dur=${scoringMs.toFixed(2)}, explanation;dur=${metrics.explanation_ms.toFixed(2)}, cache_read;dur=${metrics.cache_read_ms.toFixed(2)}, cache_write;dur=${metrics.cache_write_ms.toFixed(2)}, total;dur=${totalMs.toFixed(2)}`,
      'X-Match-Cache-Hits':String(metrics.cache_hits),'X-Match-Generated':String(metrics.generated),
      'X-Match-Eligible':String(rankedMatches.length),
    } });
  } catch (err: any) {
    console.error('[SoulTribe API] Exception during match scoring:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
