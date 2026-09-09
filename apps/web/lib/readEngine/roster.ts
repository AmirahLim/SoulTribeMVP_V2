import type {EvidenceBundle} from './evidence';
import {pairClaims} from './relational';
import {validateClaim,type ReadClaim} from './compose';

/** Diversify emphasis using available evidence across this shortlist, not identities.
 * Identical evidence cannot honestly guarantee unique meaning. Never invent a rub.
 */
export function rosterReadings(bundles:Map<string,EvidenceBundle>){
 const pools=new Map([...bundles].map(([id,b])=>[id,pairClaims(b).filter(c=>validateClaim(c,b))]));
 const frequency=new Map<string,number>(),used=new Map<string,number>();
 for(const pool of pools.values())for(const c of pool)frequency.set(c.id,(frequency.get(c.id)??0)+1);
 const select=(pool:ReadClaim[],n:number)=>{
   const sorted=[...pool].sort((a,b)=>(used.get(a.text)??0)-(used.get(b.text)??0)
     ||(b.priority-(frequency.get(b.id)??0))-(a.priority-(frequency.get(a.id)??0))||a.id.localeCompare(b.id));
   const selected:ReadClaim[]=[];
   for(const c of sorted){
     if(selected.some(s=>s.dimensions.some(d=>c.dimensions.includes(d))))continue;
     selected.push(c);used.set(c.text,(used.get(c.text)??0)+1);
     if(selected.length===n)break;
   }
   return selected.map(c=>c.text).join('\n\n');
 };
 return new Map([...pools].map(([id,pool])=>[id,{
   hasEvidence:pool.some(c=>c.tone==='click'||c.tone==='context'),
   click_text:select(pool.filter(c=>c.tone==='click'),2)||select(pool.filter(c=>c.tone==='context'),2)||'There is not enough shared, visible evidence to explain a connection yet. This is not a mismatch.',
   friction_text:select(pool.filter(c=>c.tone==='friction'),2)||'No specific friction is supported by the information you have both shared so far.',
 }]));
}
