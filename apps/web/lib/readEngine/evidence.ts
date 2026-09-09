import catalog from '../onboardingQuestionCatalog.json';
import {buildSavedAnswerRead} from '../savedAnswerRead';
import {REPAIR_QUESTIONS,INITIATIVE_QUESTION} from './deeperQuestions';
import {OPENING_QUESTION} from './emotionalQuestion';
import {resolveOnboardingBaseline} from '../onboardingBundle';

export const READ_ENGINE_VERSION = 'read-spine/8a.4';
export const DISCLOSURE_VERSION = 'public-fixed-choice/repair-detail.2';
import {THREAD_NAMES} from '@soul-tribe/core';
export {THREAD_NAMES};
export type ReadThread = keyof typeof THREAD_NAMES;
export type ReadLevel = 'early'|'profile'|'bond';
export type EvidenceLevel = 'DIRECT'|'SUPPORTED INFERENCE'|'CROSS-THREAD PATTERN'|'DYADIC INFERENCE'|'PEER OBSERVATION';
export type Source = {
  id:string; questionId:string; questionVersion:number|null; path:string;
  subject:'self'|'other'; dimension:string; thread:ReadThread; selections:string[];
  provenance:'recorded'|'legacy'; access:'public'|'shared-detail';
};
export type EvidenceBundle = {
  engineVersion:string; disclosureVersion:string; level:ReadLevel;
  sources:Source[]; // No identities, free text, raw profile or hidden answer payload.
  knownThreads:ReadThread[];
};
const object = (v:unknown):Record<string,unknown> => v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const equal = (a:unknown,b:unknown) => JSON.stringify(a)===JSON.stringify(b);

/** Closed allowlist boundary. Database callers must authorise the audience first. */
export function buildEvidence(row:unknown, level:ReadLevel, subject:'self'|'other'='self', sharedDetail=false):EvidenceBundle {
  const saved=object(row), baseline=resolveOnboardingBaseline(saved);
  const records=object(baseline.answerRecords);
  const facts=buildSavedAnswerRead(saved).facts;
  const sources:Source[]=facts.flatMap(fact=>{
    const field=fact.source.split('.').at(-1)!;
    const q=catalog.find(q=>q.fields[0]===field);
    const record=object(records[q?.questionId??'']);
    const deepQuestion=[...REPAIR_QUESTIONS,INITIATIVE_QUESTION].find(q=>q.key===field);
    const questionId=q?.questionId??deepQuestion?.id??(field===OPENING_QUESTION.key?OPENING_QUESTION.id:`tribal.${field}`);
    // A desired quality is a preference dimension, not a measured self-trait.
    const thread=(fact.thread==='desiredQualities'?'values':fact.thread==='boundaries'?'lifestyle':fact.thread) as ReadThread;
    if(!(thread in THREAD_NAMES))return [];
    if(level==='early'&&fact.source.startsWith('deep_profile.'))return [];
    const access=thread==='repair'?'shared-detail':'public';
    if(subject==='other'&&access==='shared-detail'&&!sharedDetail)return [];
    const answer=object(record.answer);
    const recorded=q&&record.questionId===q.questionId&&record.questionVersion===q.questionVersion
      &&equal(answer[field],baseline[field]);
    return [{id:`${subject}:${questionId}`,questionId,questionVersion:recorded?q.questionVersion:null,
      path:fact.source,subject,dimension:field,thread,selections:[...fact.selections].sort(),
      provenance:recorded?'recorded':'legacy',access} as Source];
  });
  return {engineVersion:READ_ENGINE_VERSION,disclosureVersion:DISCLOSURE_VERSION,level,sources,
    knownThreads:[...new Set(sources.map(s=>s.thread))]};
}
export function pairEvidence(viewer:unknown,other:unknown,sharedDetail=false):EvidenceBundle {
  // Before meeting, neither operand of a sensitive comparison reaches the writer.
  const a=buildEvidence(viewer,'bond'),b=buildEvidence(other,'bond','other',sharedDetail);
  const sources=[...a.sources,...b.sources].filter(s=>sharedDetail||s.access==='public');
  return {...a,sources,knownThreads:[...new Set(sources.map(s=>s.thread))]};
}
export function canonicalSourceIds(ids:string[], composite:Record<string,string[]>={}):string[] {
  const leaves=new Set<string>();
  const walk=(id:string,path:Set<string>)=>{
    if(path.has(id))throw new Error('Cyclic evidence source');
    if(!composite[id]){leaves.add(id);return;}
    const next=new Set(path).add(id); composite[id].forEach(child=>walk(child,next));
  };
  ids.forEach(id=>walk(id,new Set())); return [...leaves].sort();
}
