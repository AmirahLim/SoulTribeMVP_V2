import {canonicalSourceIds, type EvidenceBundle, type EvidenceLevel, type ReadThread, type Source} from './evidence';
import {VOCABULARY} from './vocabulary';
import {contextualClaims} from './patterns';
import {pairClaims} from './relational';
import {measuredPosition} from './legacy';

export type ReadClaim={id:string; sourceIds:string[]; threads:ReadThread[]; dimensions:string[];
  evidenceLevel:EvidenceLevel; text:string; shape:string; title:string; priority:number; slot?:string; tone?:'click'|'friction'|'context'};
export type ReadSection={key:string; title:string; text:string; claims:ReadClaim[];
  evidence:{questionId:string;questionVersion:number|null;selections:string[];subject:string}[]};
export type ComposedRead={version:string;level:EvidenceBundle['level'];sections:ReadSection[];omitted:string[];writer:'deterministic'|'external'};
const words=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(Boolean);
const grams=(text:string,n:number)=>{const w=words(text);return new Set(w.slice(0,Math.max(0,w.length-n+1)).map((_,i)=>w.slice(i,i+n).join(' ')));};
export function proseSimilarity(a:string,b:string){const x=grams(a,3),y=grams(b,3);return new Set([...x,...y]).size?[...x].filter(t=>y.has(t)).length/new Set([...x,...y]).size:0;}
export function repeatedSpan(a:string,b:string,n=8){const x=grams(a,n);return [...grams(b,n)].some(g=>x.has(g));}
export const readPhraseSpans=(text:string)=>[...grams(text,8)];
const sentences=(text:string)=>text.split(/(?<=[.!?])\s+/).map(s=>words(s).join(' ')).filter(Boolean);
export function repeatsReadText(a:string,b:string){return repeatedSpan(a,b)||sentences(a).some(s=>sentences(b).includes(s));}
export const readingPhrases=(read:ComposedRead)=>read.sections.flatMap(s=>[s.title,s.text,...s.claims.map(c=>c.title)]);
export function priorReadPhrases(bundle:EvidenceBundle):string[]{
  if(bundle.level==='early')return [];
  return readingPhrases(composeRead({...bundle,level:'early',sources:bundle.sources.filter(s=>s.subject==='self'&&s.path.startsWith('onboarding.'))}));
}

function makeClaim(id:string,sources:Source[],text:string,title:string,priority=1,shape='observation'):ReadClaim {
  return {id,sourceIds:canonicalSourceIds(sources.map(s=>s.id)),threads:[...new Set(sources.map(s=>s.thread))],
    dimensions:[...new Set(sources.map(s=>s.dimension))],evidenceLevel:sources.length>1?'CROSS-THREAD PATTERN':'SUPPORTED INFERENCE',
    text,title,priority,shape};
}
function disclosure(claims:ReadClaim[],bundle:EvidenceBundle){
  const ids=new Set(claims.flatMap(c=>c.sourceIds));
  return bundle.sources.filter(s=>ids.has(s.id)).map(s=>({questionId:s.questionId,questionVersion:s.questionVersion,selections:s.selections,subject:s.subject}));
}
/** Step 2: derive available claims from literal positions, not a profile template. */
export function availableClaims(bundle:EvidenceBundle):ReadClaim[] {
  const claims:ReadClaim[]=[...contextualClaims(bundle)];
  for(const source of bundle.sources){
    if(source.subject!=='self')continue;
    const measured=measuredPosition(source);
    if(measured&&bundle.level!=='early')claims.push({...makeClaim(source.id,[source],
      `Your earlier saved measurement suggests you tend to ${measured.position}. Treat this as a starting point to check against how friendship feels now, not a fixed description.`,
      measured.title,2,'measurement'),slot:measured.slot});
    for(const option of source.selections){
      const voice=VOCABULARY[source.dimension]?.[option];
      if(!voice)continue;
      claims.push(makeClaim(`${source.id}:${option}:${bundle.level}`,[source],
        bundle.level==='early'?voice.early:voice.profile,bundle.level==='early'?voice.title:voice.profileTitle,source.path.startsWith('deep_profile.')?3:1,
        source.dimension));
      if(bundle.level==='profile'&&['planningChoice','punctualityPref','cancellationStance'].includes(source.dimension))
        claims.push({...makeClaim(`care:${source.id}:${option}`,[source],voice.consequence,'What an invitation needs to respect',4,'care'),slot:'friction'});
      if(bundle.level==='profile'&&source.dimension==='groupChoices')
        claims.push({...makeClaim(`setting:${source.id}:${option}`,[source],voice.consequence,'A setting that leaves room for you',2,'setting'),slot:'best'});
    }
  }
  const clicks=bundle.sources.find(s=>s.subject==='self'&&s.dimension==='clicks');
  if(clicks?.selections.includes('Our humour just lands')&&clicks.selections.includes('We actually make plans happen')){
    const deep=clicks.selections.includes('We skip the small talk');
    claims.push(makeClaim(`clicks-together:${bundle.level}`,[clicks],bundle.level==='early'
      ?deep?'A joke opens the door. You want conversation beyond introductions and a plan that actually happens.':'Humour carries the beginning; a real plan gives it somewhere to go.'
      :deep?'There is laughter at the start, but you do not want to live in the opening exchange. Let the conversation go somewhere, then find a time to continue it.':'The joke is not the whole connection. Following it with an invitation gives the laughter another afternoon to return to.',
      bundle.level==='early'?(deep?'A joke, then somewhere further':'Let the laugh become a plan'):(deep?'Lightness need not keep you at the surface':'An invitation after the laughter'),12,'click-combination'));
  }
  if(bundle.level==='early')return claims;
  const src=(dim:string,option?:string)=>bundle.sources.find(s=>s.subject==='self'&&s.dimension===dim&&(!option||s.selections.includes(option)));
  const add=(id:string,a:Source|undefined,b:Source|undefined,text:string,title:string,priority=10)=>{
    if(a&&b)claims.push(makeClaim(id,[a,b],text,title,priority,'cross-thread'));
  };
  add('close-without-constant',src('intent','Close circle'),src('connectionChoice','Weeks/Months can pass, we’re still good'),
    'A close circle, with weeks or months between conversations: you are not asking friendship to prove itself through a running exchange. Closeness may be having a place to return to, even when the chat has been quiet.',
    'Close does not have to mean constant');
  add('thought-as-catchup',src('messagingStyle','Random thoughts'),src('connectionChoice','About once a week'),
    'A stray thought can be the catch-up. With a weekly rhythm you want to keep, reaching out need not wait until there is a whole life update to give. Something small can keep the conversation moving.',
    'The thought is the reason to write');
  add('base-and-window',src('coreValues','Stability'),src('intent','New perspectives'),
    'A steady base matters to you, and so does a view you would not have found alone. The friendship you want may bring something unfamiliar into a life whose foundations you still want to keep.',
    'A steady base, with the windows open');
  add('adventure-with-outline',src('idealSaturday','Exploring'),src('spontaneousTrip','Not without itinerary'),
    'Unfamiliar places appeal to you; an undefined trip does not. You may want the discovery inside the day, with the shape of the day settled first.',
    'Discovery inside a plan');
  const atmosphere=src('socialVibe','Calm');
  if(atmosphere?.selections.includes('High-energy'))claims.push(makeClaim('room-with-range',[atmosphere],
    'The room does not have to stay at the same volume. There is a place for a lively stretch and a quieter corner; either can be part of the company you enjoy.',
    'A room with more than one mood',11,'social-range'));
  return claims;
}

const profileSlots=[
  {key:'social',dimensions:['groupSize','socialVibe','groupChoices','friendshipPillars'],extra:['close-without-constant','room-with-range']},
  {key:'connect',dimensions:['messagingStyle','supportStyle','connectionChoice','clicks','initiationChoice','q7EmotionalPacing','planningChoice'],extra:['thought-as-catchup','clicks-together:profile']},
  {key:'bring',dimensions:['coreValues','intent','desiredQualities'],extra:['base-and-window']},
  {key:'best',dimensions:['idealSaturday','socialVibe','groupSize','groupChoices','spontaneousTrip'],extra:['adventure-with-outline']},
  {key:'friction',dimensions:['repairFirst','repairReturn','repairNeed','repairDiscuss','repairSpace','punctualityPref','cancellationStance','planningChoice'],extra:[]},
  {key:'doing',dimensions:['outings','budgetPref'],extra:[]},
];
const earlySlots=[
  {key:'intent',dimensions:['intent'],extra:[]}, {key:'setting',dimensions:['groupChoices'],extra:[]},
  {key:'click',dimensions:['clicks'],extra:['clicks-together:early']}, {key:'rhythm',dimensions:['connectionChoice','planningChoice'],extra:[]},
  {key:'qualities',dimensions:['desiredQualities'],extra:[]}, {key:'outings',dimensions:['outings'],extra:[]},
];

/** Step 3: choose emphasis and ordering using evidence, with no random rotation. */
export function composeRead(bundle:EvidenceBundle,priorPhrases:string[]=[]):ComposedRead {
  if(bundle.level==='bond')return composeBond(bundle,priorPhrases);
  const candidates=availableClaims(bundle).filter(c=>validateClaim(c,bundle));
  const slots=bundle.level==='early'?earlySlots:profileSlots;
  const priorText=[...priorReadPhrases(bundle),...priorPhrases];
  const sections:ReadSection[]=[],used=new Set<string>(),selectedText:string[]=[];
  const repeats=(texts:string[],claim:ReadClaim)=>texts.some(text=>repeatsReadText(text,claim.text)||words(text).join(' ')===words(claim.title).join(' '));
  const usesDeeper=(claim:ReadClaim)=>claim.sourceIds.some(id=>bundle.sources.find(s=>s.id===id)?.path.startsWith('deep_profile.'));
  for(const slot of slots){
    const earlyPlacement:Record<string,string>={social:'intent',connect:'click',bring:'qualities',best:'setting',friction:'rhythm',doing:'outings'};
    const pool=candidates.filter(c=>c.slot?(bundle.level==='early'?earlyPlacement[c.slot]:c.slot)===slot.key:slot.extra.includes(c.id)||(c.sourceIds.length===1&&c.dimensions.some(d=>slot.dimensions.includes(d))))
      .sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
    const selected:ReadClaim[]=[];const shapeCount=new Map<string,number>();
    for(const claim of pool){
      if(used.has(claim.id)||repeats(selectedText,claim)||(!usesDeeper(claim)&&repeats(priorText,claim)))continue;
      if(selected.some(c=>c.sourceIds.some(id=>claim.sourceIds.includes(id))))continue;
      if((shapeCount.get(claim.shape)??0)>=2)continue;
      selected.push(claim);used.add(claim.id);selectedText.push(claim.text,claim.title);
      shapeCount.set(claim.shape,(shapeCount.get(claim.shape)??0)+1);
      if(selected.length===(bundle.level==='early'&&slot.key!=='rhythm'?1:2))break;
    }
    if(selected.length)sections.push({key:slot.key,title:selected[0].title,text:selected.map(c=>c.text).join(' '),claims:selected,evidence:disclosure(selected,bundle)});
  }
  return {version:bundle.engineVersion,level:bundle.level,sections,omitted:slots.filter(s=>!sections.some(x=>x.key===s.key)).map(s=>s.key),writer:'deterministic'};
}

export function composeBond(bundle:EvidenceBundle,priorPhrases:string[]=[]):ComposedRead {
  const claims=pairClaims(bundle);
  const selected:ReadClaim[]=[];
  for(const c of claims.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id))){
    if(!validateClaim(c,bundle)||priorPhrases.some(t=>repeatsReadText(t,c.text)))continue;
    if(selected.some(s=>s.text===c.text))continue;
    selected.push(c);
  }
  return {version:bundle.engineVersion,level:'bond',sections:selected.map(c=>({key:c.id,title:c.title,text:c.text,claims:[c],evidence:disclosure([c],bundle)})),omitted:[],writer:'deterministic'};
}

export function connectionThread(bundle:EvidenceBundle,thread:string) {
  return pairClaims(bundle).filter(c=>c.threads.includes(thread as ReadThread)&&validateClaim(c,bundle))
    .sort((a,b)=>Number(b.tone==='friction')-Number(a.tone==='friction')||b.priority-a.priority)[0];
}

/** Step 5: structural claim/source validation. Not a proof of arbitrary prose. */
export function validateClaim(claim:ReadClaim,bundle:EvidenceBundle):boolean {
  if(!claim.text?.trim()||!claim.sourceIds?.length||!claim.dimensions?.length||!claim.threads?.length)return false;
  const ids=canonicalSourceIds(claim.sourceIds),sources=bundle.sources.filter(s=>ids.includes(s.id));
  if(sources.length!==ids.length)return false;
  if(claim.threads.some(t=>!bundle.knownThreads.includes(t)||!sources.some(s=>s.thread===t)))return false;
  if(claim.dimensions.some(d=>!sources.some(s=>s.dimension===d)))return false;
  if(claim.evidenceLevel==='CROSS-THREAD PATTERN'&&new Set(sources.map(s=>s.questionId)).size<2)return false;
  if(claim.evidenceLevel==='DYADIC INFERENCE'&&new Set(sources.map(s=>s.subject)).size!==2)return false;
  if(claim.evidenceLevel==='PEER OBSERVATION')return false; // Requires a separately threshold-released peer claim.
  const quantities=sources.flatMap(s=>s.selections.join(' ').match(/\d+(?:\.\d+)?/g)??[]);
  if((claim.text.match(/\d+(?:\.\d+)?/g)??[]).some(n=>!quantities.includes(n)))return false;
  return !/%|\b(authentic|unlock|seamless|introvert|extrovert|diagnos(?:is|ed))\b/i.test(claim.text);
}

export type Writer = (input:{bundle:EvidenceBundle;plan:ComposedRead})=>Promise<unknown>;
/** Optional external writer; callers supply only the closed bundle and its plan. */
export async function writeRead(bundle:EvidenceBundle,writer?:Writer,priorPhrases:string[]=[]):Promise<ComposedRead>{
  const fallback=composeRead(bundle,priorPhrases);if(!writer||!fallback.sections.length)return fallback;
  try{
    const output=await writer({bundle,plan:fallback}) as ComposedRead;
    if(!output||!Array.isArray(output.sections)||output.sections.length!==fallback.sections.length)return fallback;
    const known=new Map(fallback.sections.flatMap(s=>s.claims).map(c=>[c.id,c]));
    const seenSections=new Set<string>(),seenClaims=new Set<string>(),prose:string[]=[...priorReadPhrases(bundle),...priorPhrases];
    const accepted=output.sections.every(s=>{
      const section=fallback.sections.find(original=>original.key===s.key);
      if(!section||seenSections.has(s.key)||!Array.isArray(s.claims)||s.claims.length!==section.claims.length)return false;
      seenSections.add(s.key);
      return s.claims.every(c=>{
      const original=known.get(c.id);
      if(seenClaims.has(c.id)||!section.claims.some(claim=>claim.id===c.id)||typeof c.text!=='string'
        ||c.text.length>2400||prose.some(text=>repeatsReadText(text,c.text)))return false;
      seenClaims.add(c.id);prose.push(c.text);
      return original&&JSON.stringify(c.sourceIds)===JSON.stringify(original.sourceIds)
        &&JSON.stringify(c.dimensions)===JSON.stringify(original.dimensions)&&JSON.stringify(c.threads)===JSON.stringify(original.threads)
        &&c.evidenceLevel===original.evidenceLevel&&validateClaim(c,bundle);
    });});
    if(!accepted||!output.sections.length)return fallback;
    // Do not trust model-provided free-standing paragraphs/disclosures or metadata.
    return {...fallback,writer:'external',sections:output.sections.map(s=>({...s,
      title:known.get(s.claims[0].id)!.title,text:s.claims.map(c=>c.text).join('\n\n'),evidence:disclosure(s.claims,bundle)}))};
  }catch{return fallback;}
}
