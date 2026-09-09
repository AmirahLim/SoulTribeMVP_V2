import {type ReadDraft} from './earlyRead';
import {groupChoices} from './sixQuestionOnboarding';
/** Early Read only. Distinct from the later profile/Tribal Pass voice. Never invent traits or leak custom text. */
export function earlyReadSummary(d:ReadDraft):string {
 const first=d.intent.includes('Close circle')?'You’re looking for a close circle where familiar faces become part of everyday life.':d.intent.includes('People to do things with')?'You’re looking for people to share the doing, not just the talking.':'';
 const second=d.clicks.includes('We skip the small talk')?'You value conversations that get past the surface.':d.clicks.includes('Our humour just lands')?'Shared humour is one of your signs that a connection is clicking.':d.clicks.includes('Comfortable silence feels easy')?'You appreciate the ease of being together without filling every silence.':'';
 const third=groupChoices(d).includes('1:1')?'One-to-one time is one of the settings you want to make room for.':groupChoices(d).includes('Small circle')?'You’ve made room for small-circle moments, where everyone has a place in the conversation.':d.planningChoice==='Same day'?'You like leaving room for a plan that comes together on the day.':'';
 const opening=[first,second,third].filter(Boolean).join(' ');
 const planning=d.planningChoice==='About a week'?'Plans tend to land better when they have a place in the week first.'
  :d.planningChoice==='A few days'?'A little notice seems to help an invitation settle among the rest of life.'
  :d.planningChoice==='Same day'?'An open afternoon can still become the meeting.'
  :'';
 const outings=Array.isArray(d.outings)&&d.outings.length?'The outings you chose give the first meetings somewhere to happen, without having to carry the whole friendship in conversation.'
  :'';
 const secondParagraph=[planning,outings].filter(Boolean).join(' ');
 if(!opening&&!secondParagraph)return 'Your notes below draw only on the answers you shared. You can correct any reading that misses the mark.';
 return [opening,secondParagraph].filter(Boolean).join('\n\n');
}
