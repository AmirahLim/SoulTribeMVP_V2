import {describe,it,expect,vi} from 'vitest';
import {createOpenAIWriter,BRAND_VOICE,optionalReadWriter} from '../readEngine/openaiWriter';
import {buildEvidence} from '../readEngine/evidence';
import {composeRead,writeRead} from '../readEngine/compose';
const bundle=buildEvidence({onboarding:{baselineV2:{intent:['Close circle']}}},'early');
const plan=composeRead(bundle);
describe('disabled-by-default external writer contract (mock requests only)',()=>{
  it('uses the founder voice and requires a durable spending reservation before any request',async()=>{
    const fetcher=vi.fn(),budget={reserve:vi.fn().mockResolvedValue(null),settle:vi.fn()};
    const writer=createOpenAIWriter({apiKey:'local-test-only',model:'mock-model',budget,fetcher});
    expect(await writeRead(bundle,writer)).toEqual(plan);
    expect(fetcher).not.toHaveBeenCalled();
    expect(BRAND_VOICE).toContain('poetic, deep, behavioral interpreter');
    expect(BRAND_VOICE).toContain('at least two paragraphs');
    expect(BRAND_VOICE).toContain('repeating user inputs literally');
    expect(optionalReadWriter()).toBeUndefined();
  });
  it('requests no provider storage and rebuilds immutable evidence, recording actual reported tokens',async()=>{
    const budget={reserve:vi.fn().mockResolvedValue('local-reservation'),settle:vi.fn()};
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',usage:{input_tokens:123,output_tokens:45},
      output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({sections:plan.sections.map(s=>({key:s.key,claims:s.claims.map(c=>({id:c.id,text:c.text}))}))})}]}]})));
    const writer=createOpenAIWriter({apiKey:'local-test-only',model:'mock-model',budget,fetcher});
    const result=await writeRead(bundle,writer);
    expect(result.writer).toBe('external');
    expect(result.sections[0].evidence).toEqual(plan.sections[0].evidence);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).store).toBe(false);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).input[1].content).toContain('You are a poetic, deep, behavioral interpreter');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).input[1].content).toContain('"dimension":"intent"');
    expect(budget.settle).toHaveBeenCalledWith('local-reservation',{inputTokens:123,outputTokens:45});
  });
  it('does not retry or release an ambiguous paid reservation',async()=>{
    const budget={reserve:vi.fn().mockResolvedValue('local-reservation'),settle:vi.fn()};
    const fetcher=vi.fn().mockRejectedValue(new Error('timeout'));
    expect(await writeRead(bundle,createOpenAIWriter({apiKey:'local-test-only',model:'mock-model',budget,fetcher}))).toEqual(plan);
    expect(fetcher).toHaveBeenCalledTimes(1);expect(budget.settle).not.toHaveBeenCalled();
  });
  it('rejects duplicated sections and claims even with valid source references',async()=>{
    const b=buildEvidence({onboarding:{baselineV2:{intent:['Close circle'],groupChoices:['Small circle']}}},'early');
    const fallback=composeRead(b);
    const result=await writeRead(b,async()=>({...fallback,sections:[fallback.sections[0],fallback.sections[0]]}));
    expect(result).toEqual(fallback);
  });
});
