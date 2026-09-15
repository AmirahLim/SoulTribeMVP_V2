import type {SupabaseClient} from '@supabase/supabase-js';
import type {MatchResult,ProfileVector} from '@soul-tribe/core';

export const SCORING_VERSION='match-score/1';

export function activityKey(category:unknown,candidatePoolSize?:number):{activity:string;smallPool:boolean}{
  return {
    activity:typeof category==='string'&&category.length>0?category:'',
    smallPool:candidatePoolSize!==undefined&&candidatePoolSize<15,
  };
}

export type CachedScore={
  user_b:string;
  resonance:number|null;
  logistics:number|null;
  rank_score:number;
  gated:boolean;
  gate_reasons:string[];
  contributions:Record<string,number>;
  version_a:number;
  version_b:number;
  scoring_version:string;
};

export function matchResultFromCache(row:CachedScore,viewer:ProfileVector,candidate:ProfileVector):MatchResult{
  return {
    resonance:row.resonance==null?null:Number(row.resonance),
    logistics:row.logistics==null?null:Number(row.logistics),
    rank_score:Number(row.rank_score),
    gated:row.gated,gate_reasons:row.gate_reasons,contributions:row.contributions,
    confidence_a:viewer.profile.confidence,confidence_b:candidate.profile.confidence,
  };
}

export function scoreCacheRow(input:{
  viewerId:string;candidateId:string;activity:string;smallPool:boolean;
  versionA:number;versionB:number;result:MatchResult;
}){
  return {
    user_a:input.viewerId,user_b:input.candidateId,activity_key:input.activity,
    small_pool:input.smallPool,scoring_version:SCORING_VERSION,
    resonance:input.result.resonance,logistics:input.result.logistics,
    rank_score:input.result.rank_score,gated:input.result.gated,
    gate_reasons:input.result.gate_reasons,contributions:input.result.contributions,
    version_a:input.versionA,version_b:input.versionB,
    computed_at:new Date().toISOString(),
  };
}

export async function readMatchScores(
  client:SupabaseClient,viewerId:string,activity:string,smallPool:boolean,candidateIds:string[],
):Promise<Map<string,CachedScore>>{
  const cached=new Map<string,CachedScore>();
  if(candidateIds.length===0)return cached;
  const {data,error}=await client.from('match_scores')
    .select('user_b,resonance,logistics,rank_score,gated,gate_reasons,contributions,version_a,version_b,scoring_version')
    .eq('user_a',viewerId).eq('activity_key',activity).eq('scoring_version',SCORING_VERSION)
    .eq('small_pool',smallPool).in('user_b',candidateIds);
  if(error){
    console.error('[SoulTribe] match score cache read',{code:error.code,message:error.message});
    return cached;
  }
  for(const row of data??[])cached.set(row.user_b,row);
  return cached;
}

export async function writeMatchScores(client:SupabaseClient,rows:ReturnType<typeof scoreCacheRow>[]):Promise<void>{
  if(rows.length===0)return;
  const {error}=await client.from('match_scores').upsert(rows,{onConflict:'user_a,activity_key,user_b,small_pool'});
  if(error)console.error('[SoulTribe] match score cache write',{code:error.code,message:error.message});
}
