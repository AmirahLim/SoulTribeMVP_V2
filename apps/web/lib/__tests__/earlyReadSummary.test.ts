import {it,expect} from 'vitest';
import {earlyReadSummary} from '../earlyReadSummary';
import {emptyDraft} from '../sixQuestionOnboarding';
it('gives preference-grounded Early Read sentences without exposing custom text',()=>{
 const d={...emptyDraft(),intent:['Close circle'],clicks:['We skip the small talk'],group:'1:1',groupChoices:['1:1'],qualityOther:'Secret words'};
 const summary=earlyReadSummary(d);
 expect(summary).toContain('close circle');expect(summary).toContain('past the surface');
 expect(summary.split('.').filter(Boolean).length).toBeGreaterThanOrEqual(3);
 expect(summary).not.toContain('Secret words');
});
