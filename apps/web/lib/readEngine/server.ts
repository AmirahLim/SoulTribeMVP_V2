import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {buildEvidence, pairEvidence, type EvidenceBundle} from './evidence';
import {composeRead,writeRead,priorReadPhrases,type ComposedRead,type Writer} from './compose';
import {optionalReadWriter,WRITER_PROMPT_VERSION} from './openaiWriter';
import catalog from '../onboardingQuestionCatalog.json';
import {deepChoices} from '../savedAnswerRead';
import {includeMeasurements,MEASUREMENT_SELECT} from './legacy';
import {OPENING_QUESTION} from './emotionalQuestion';

export function stable(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';
  return JSON.stringify(value)??'null';
}
export const evidenceHash=(bundle:EvidenceBundle)=>createHash('sha256').update(stable(bundle)).digest('hex');
function fail(operation:string,error:{code?:string;message:string}):never{
  console.error('[SoulTribe] read engine '+operation,{code:error.code,message:error.message});throw new Error(error.message);
}
export async function loadOwnEvidence(client:SupabaseClient,owner:string,saved:unknown){
  let bundle=buildEvidence(saved,'profile');
  const measurements=await client.from('profiles').select(MEASUREMENT_SELECT).eq('id',owner).maybeSingle();
  if(measurements.error)fail('saved measurements',measurements.error);
  bundle=includeMeasurements(bundle,measurements.data);
  const {data,error}=await client.from('read_answer_sources').select('question_id,question_version,selections').eq('user_id',owner);
  if(error)fail('own source versions',error);
  for(const source of bundle.sources){
    const row=data?.find(r=>r.question_id===source.questionId&&JSON.stringify([...r.selections].sort())===JSON.stringify(source.selections));
    if(row?.question_version===1){source.questionVersion=1;source.provenance='recorded';}
  }
  return bundle;
}
/** RLS caller, not the service client. This query is the public-detail boundary. */
export async function loadPairEvidence(client:SupabaseClient,viewer:string,subject:string){
  const {data,error}=await client.from('read_answer_sources').select('user_id,question_id,question_version,dimension,thread,selections,access').in('user_id',[viewer,subject]);
  if(error)fail('evidence query',error);
  const rows=data??[];
  const unpack=(id:string)=>{
    const baseline:Record<string,unknown>={},deep:Record<string,unknown>={};
    for(const row of rows.filter(r=>r.user_id===id)){
      const q=catalog.find(q=>q.questionId===row.question_id&&q.fields[0]===row.dimension);
      if(q)baseline[row.dimension]=row.selections;
      else if(deepChoices.some(([key])=>key===row.dimension))deep[row.dimension]=row.selections;
    }
    const opening=rows.find(r=>r.user_id===id&&r.question_id===OPENING_QUESTION.id);
    return {onboarding:{baselineV2:baseline,q7EmotionalPacing:opening?.selections},deep_profile:deep};
  };
  const shared=await client.rpc('has_verified_outing_with',{b:subject});
  if(shared.error)fail('shared attendance query',shared.error);
  let bundle=pairEvidence(unpack(viewer),unpack(subject),shared.data===true);
  const measurements=await client.from('profiles').select(MEASUREMENT_SELECT).in('id',[viewer,subject]);
  if(measurements.error)fail('visible saved measurements',measurements.error);
  bundle=includeMeasurements(bundle,measurements.data?.find(r=>r.id===viewer),'self');
  bundle=includeMeasurements(bundle,measurements.data?.find(r=>r.id===subject),'other');
  for(const source of bundle.sources){
    const row=rows.find(r=>r.user_id===(source.subject==='self'?viewer:subject)&&r.question_id===source.questionId);
    if(row?.question_version===1){source.questionVersion=1;source.provenance='recorded';}
  }
  return bundle;
}

/** One RLS batch for the shortlist; match cards never request shared-only detail. */
export async function loadRosterEvidence(client:SupabaseClient,viewer:string,ids:string[]){
  const subjects=[viewer,...ids];
  const [answers,profiles]=await Promise.all([
    client.from('read_answer_sources').select('user_id,question_id,dimension,selections,access').in('user_id',subjects),
    client.from('profiles').select(MEASUREMENT_SELECT).in('id',subjects),
  ]);
  if(answers.error)fail('match evidence',answers.error);
  if(profiles.error)fail('match visible measurements',profiles.error);
  const unpack=(id:string)=>{
    const baseline:Record<string,unknown>={},deep:Record<string,unknown>={};
    for(const row of answers.data??[]){
      if(row.user_id!==id||row.access!=='public')continue;
      if(catalog.some(q=>q.questionId===row.question_id&&q.fields[0]===row.dimension))baseline[row.dimension]=row.selections;
      else if(deepChoices.some(([key])=>key===row.dimension))deep[row.dimension]=row.selections;
    }
    const opening=answers.data?.find(r=>r.user_id===id&&r.question_id===OPENING_QUESTION.id&&r.access==='public');
    return {onboarding:{baselineV2:baseline,q7EmotionalPacing:opening?.selections},deep_profile:deep};
  };
  const result=new Map<string,EvidenceBundle>();
  for(const id of ids){
    if(!profiles.data?.some(p=>p.id===id))throw new Error('A matching profile is no longer available. Please retry.');
    let bundle=pairEvidence(unpack(viewer),unpack(id),false);
    bundle=includeMeasurements(bundle,profiles.data.find(p=>p.id===viewer),'self');
    bundle=includeMeasurements(bundle,profiles.data.find(p=>p.id===id),'other');
    result.set(id,bundle);
  }
  return result;
}
/** Fresh authorisation/evidence must precede every call, including cache hits. */
export async function cachedRead(client:SupabaseClient,viewer:string,subject:string,bundle:EvidenceBundle,writer?:Writer,writerVersion?:string){
  const activeWriter=writer??optionalReadWriter();
  writerVersion=(activeWriter?WRITER_PROMPT_VERSION:'deterministic/8a.2');
  // Remember wording across views without ever feeding another read to a writer.
  // Early wording is derived from the same visible baseline evidence, not a new fact.
  const {data:history,error:historyError}=await client.from('read_phrase_history').select('phrase').eq('viewer_id',viewer).in('subject_id',[viewer,subject]).neq('level',bundle.level);
  if(historyError)fail('phrase history',historyError);
  const priorPhrases=[...priorReadPhrases(bundle),...(history??[]).map(r=>r.phrase)];
  const phraseVersion=createHash('sha256').update(stable([...new Set(priorPhrases)].sort())).digest('hex');
  writerVersion=writerVersion+':'+phraseVersion.slice(0,12);
  const hash=evidenceHash(bundle),started=performance.now();
  const {data,error}=await client.rpc('claim_composed_read',{p_viewer:viewer,p_subject:subject,p_level:bundle.level,p_hash:hash,
    p_engine:bundle.engineVersion,p_writer:writerVersion,p_disclosure:bundle.disclosureVersion});
  if(error)fail('cache claim',error);
  if(data?.state==='hit')return {read:data.document as ComposedRead,hash,writerVersion,cache:'hit',durationMs:performance.now()-started};
  // Another request owns the lease. No duplicate external generation or long wait.
  if(data?.state==='busy')return {read:composeRead(bundle,priorPhrases),hash,writerVersion,cache:'busy-fallback',durationMs:performance.now()-started};
  if(data?.state!=='claimed'||typeof data.lease!=='string')throw new Error('Unable to claim reading');
  const read=await writeRead(bundle,activeWriter,priorPhrases);
  const finished=await client.rpc('finish_composed_read',{p_viewer:viewer,p_subject:subject,p_level:bundle.level,p_hash:hash,p_lease:data.lease,p_document:read});
  if(finished.error)fail('cache publish',finished.error);
  if(finished.data!==true)throw new Error('Reading changed while it was being prepared. Please retry.');
  return {read,hash,writerVersion,cache:'generated',durationMs:performance.now()-started};
}
