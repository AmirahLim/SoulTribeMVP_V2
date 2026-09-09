'use client';
import React from 'react';
import {BondReadCheck} from './profile/BondReadCheck';
import Link from 'next/link';
import {Caveat} from 'next/font/google';
import s from './BondScrapbook.module.css';
import type {ComposedRead} from '../lib/readEngine/compose';
const handwriting=Caveat({subsets:['latin'],weight:['400','600']});
export type BondThread={key:string;status:'known'|'unknown';headline?:string;phrase?:string;mechanism?:string;evidence?:ComposedRead['sections'][number]['evidence']};
export type BondNotes={candidate:{id:string;displayName:string;bio?:string;homeArea?:string};clickText:string;rubText:string;threads:BondThread[];sharpen:{questionId:string;prompt:string;href:string}[];overall:{provisional:boolean};composedRead?:ComposedRead;readHash?:string;writerVersion?:string};
export const bondObjects:Record<string,{label:string;object:string;action:string;inside:string;tile:number}>={
personality:{label:'Social Energy',object:'linen',action:'Pull up a chair',inside:'Around the same table',tile:0},
communication:{label:'How You Connect',object:'cassette',action:'Turn over the cassette',inside:'Side B · between the messages',tile:1},
intent:{label:'Friendship Style',object:'velvet',action:'Unfasten the bracelet',inside:'The ties you are looking for',tile:2},
emotional:{label:'Emotional Openness',object:'glassine',action:'Lift the translucent flap',inside:'What becomes visible with time',tile:3},
values:{label:'What Matters',object:'compass',action:'Open the compass case',inside:'The bearings beneath the bond',tile:4},
interests:{label:'Shared Interests',object:'record',action:'Slide out the record sleeve',inside:'Liner notes · your shared soundtrack',tile:5},
social_rhythm:{label:'Social Rhythm',object:'calendar',action:'Turn the calendar page',inside:'Making room for each other',tile:6},
lifestyle:{label:'Everyday Life',object:'journal',action:'Open the everyday journal',inside:'Between the plans',tile:7},
experience:{label:'Outing Preferences',object:'ticket',action:'Unfold your ticket',inside:'Admit two · an outing that fits',tile:8},
geography:{label:'Where You’d Meet',object:'map',action:'Unfold the meeting map',inside:'Finding the middle ground',tile:9},
initiative:{label:'Social Initiative',object:'key',action:'Turn over the key tag',inside:'Who opens the door?',tile:10},
repair:{label:'Conflict & Repair',object:'stitch',action:'Look beneath the stitching',inside:'How a connection is mended',tile:11},
};
export function bondTone(t:BondThread){
if(t.status!=='known')return {style:s.unknown,label:'Still taking shape'};
if(t.mechanism==='alignment')return {style:s.aligned,label:'Common ground'};
if(t.mechanism==='complementarity')return {style:s.complementary,label:'Different, together'};
if(t.mechanism==='friction')return {style:s.friction,label:'Needs a little care'};
return {style:s.context,label:'Worth exploring'};
}
export function bondExcerpt(text:string){return text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || (text.length>160?text.slice(0,157)+'…':text);}
function ObjectArt({tile}:{tile:number}){return <div aria-hidden="true" className={s.objectArt} style={{backgroundPosition:`${(tile%3)*50}% ${Math.floor(tile/3)*100/3}%`}}/>;}
export function BondScrapbook({notes}:{notes:BondNotes}){
const rub=notes.rubText||'No specific friction is supported by the answers shared so far.';
const extra:BondThread[]=['initiative','repair'].filter(key=>!notes.threads.some(t=>t.key===key)).map(key=>({key,status:'unknown'}));
const synthesis=notes.composedRead?notes.composedRead.sections.map(section=>({title:section.title,text:section.text,observation:'',unknown:[] as string[],evidence:section.evidence.map(source=>({key:source.questionId,phrase:`${source.subject==='self'?'Your':'Their'} selection: ${source.selections.join(' · ')}`}))})):[];
return <div className={s.album}>
<nav className={s.tabs} aria-label="Member views"><Link href={`/people/${notes.candidate.id}`}>Their profile</Link><span aria-current="page">View Connection</span></nav>
<section className={s.overview} aria-labelledby="bond-title">
<p className={s.eyebrow}>You & {notes.candidate.displayName} · connection notes</p>
<p className={`${s.summaryHand} ${handwriting.className}`}>a little more about you two.</p>
<h1 id="bond-title">How the threads<br/><em>come together.</em></h1>
<div className={s.stringSummary}>
{synthesis[0]&&<h2>{synthesis[0].title}</h2>}
<svg className={s.stringSide} viewBox="0 0 32 300" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M29 0 C8 15 13 36 24 51 C38 73 5 82 10 108 C15 132 33 131 26 156 C17 188 4 193 10 219 C17 247 31 266 13 300" /></svg>
<p className={s.summaryLead}>{synthesis.slice(0,2).map(part=>part.text).filter(Boolean).join('\n\n')||'There is not enough shared evidence for a composed reading yet. Unmeasured threads are not a mismatch.'}</p>
<svg className={s.stringUnder} viewBox="0 0 700 64" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M0 45 C62 62 91 9 148 20 C206 31 162 62 238 52 C305 43 393 14 372 5 C345 -5 316 22 362 36 C406 50 445 42 472 56 C493 66 558 61 593 41 C628 18 655 37 700 4" /></svg>
</div>
{synthesis[0]&&<details className={s.evidence}><summary>What this reading draws on <span aria-hidden="true">+</span></summary>
{synthesis[0].evidence.map((item,index)=><p key={`${item.key}:${index}`}><strong>{item.key}:</strong> {item.phrase}</p>)}
</details>}
<details className={s.summaryExpand}><summary><span className={s.closedAction}>Read the full connection summary ↗</span><span className={s.openAction}>Show less ↙</span></summary>
<div className={s.synthesis}>{synthesis.slice(1).map((part,i)=><article key={part.title}>
<span className={`${s.chapter} ${handwriting.className}`}>0{i+1}</span><div><h2>{part.title}</h2>{part.observation&&<p className={s.observation}>{part.observation}.</p>}<p>{part.text}</p>
<details className={s.evidence}><summary>What this reading draws on <span aria-hidden="true">+</span></summary>
{part.evidence.map(t=><p key={t.key}><strong>{bondObjects[t.key]?.label||t.key}:</strong> {t.phrase}</p>)}
{!!part.unknown.length&&<p>Still unknown: {part.unknown.map(key=>bondObjects[key]?.label||key).join(', ')}. These are not counted as agreement.</p>}
</details></div></article>)}</div>
</details>
<p className={s.caveat}>{notes.overall.provisional?'An early read, not the whole story.':'An interpretation of the answers shared so far.'} These threads suggest possibilities, not a prediction of friendship.</p>
</section>
<div className={s.sectionTitle}><h2>Thread by thread</h2><p className={handwriting.className}>a collection of little discoveries</p></div>
<div className={s.collection}>{[...notes.threads,...extra].map((t,i)=>{
const o=bondObjects[t.key]||{label:t.key,object:'journal',tile:7,action:'Open the journal',inside:'A closer reading'};
const tone=bondTone(t);const unmeasured=extra.includes(t);
return <details id={`bond-${t.key}`} key={t.key} className={`${s.keepsake} ${s[o.object]} ${tone.style}`} data-object={o.object}>
<summary><ObjectArt tile={o.tile}/><div className={s.caption}><span className={s.index}>{String(i+1).padStart(2,'0')} /</span><h3>{o.label}</h3><p className={s.status}>{unmeasured?'Not yet measured':tone.label}</p><span className={`${s.action} ${handwriting.className}`}><span className={s.closedAction}>{o.action} ↗</span><span className={s.openAction}>Close this reading ↙</span></span></div></summary>
<div className={s.reveal}><p className={s.eyebrow}>{o.inside}</p><h4>{t.status==='known'?(t.headline||o.label):'Still taking shape'}</h4><p>{t.status==='known'?(t.phrase||'No further explanation is available yet.'):unmeasured?'This part is not yet available in your live bond reading. We won’t guess how either of you takes initiative or handles repair.':'Not enough shared, visible information to describe this thread. An empty space is not a mismatch.'}</p><span className={`${s.endnote} ${handwriting.className}`}>You & {notes.candidate.displayName}</span></div>
{t.status==='known'&&<details className={s.evidence}><summary>What this reading draws on</summary>
{t.evidence?.length?t.evidence.map(source=><p key={source.subject+source.questionId}>{source.subject==='self'?'Your':'Their'} selection: {source.selections.join(' · ')}<br/>{source.questionId} · {source.questionVersion===null?'Original question version not recorded':`Question version ${source.questionVersion}`}</p>):<p>{['emotional','repair'].includes(t.key)?'Only the comparison state is shared here. Individual answers require verified shared attendance.':'Previously saved trait measurements support this comparison. Original question versions are not available for these older measurements.'}</p>}
</details>}
</details>;})}</div>
<section className={s.care}><details className={s.careNote}><summary><p className={s.eyebrow}>Potential friction</p><h2>The places to<br/><em>handle with care.</em></h2><p>{bondExcerpt(rub)}</p><span className={`${s.action} ${handwriting.className}`}>Look a little closer ↗</span></summary><p className={s.full}>{rub}</p></details></section>
{!!notes.sharpen.length&&<section className={s.more}><h2>There’s more to the two of you.</h2><p>Keep adding to the picture, at your own pace.</p>{notes.sharpen.map(q=>q.href?<Link key={q.questionId} href={q.href}>{q.prompt} →</Link>:<p key={q.questionId}>{q.prompt}</p>)}</section>}
<BondReadCheck subjectId={notes.candidate.id} readHash={notes.readHash} writerVersion={notes.writerVersion}/>
</div>;
}
