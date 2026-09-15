import {describe,it,expect,vi} from 'vitest';
import {createOpenAIWriter,createWriterBudget,BRAND_VOICE,optionalReadWriter} from '../readEngine/openaiWriter';
import {buildEvidence} from '../readEngine/evidence';
import {composeRead,writeRead} from '../readEngine/compose';
const bundle=buildEvidence({onboarding:{baselineV2:{intent:['Close circle']}}},'early');
const plan=composeRead(bundle);
const viewer='10000000-0000-4000-8000-000000000001';
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
  it('does not settle when the provider reports non-integer usage',async()=>{
    const budget={reserve:vi.fn().mockResolvedValue('local-reservation'),settle:vi.fn()};
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',usage:{input_tokens:1.5,output_tokens:4},
      output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({sections:plan.sections.map(s=>({key:s.key,claims:s.claims.map(c=>({id:c.id,text:c.text}))}))})}]}]})));
    await writeRead(bundle,createOpenAIWriter({apiKey:'local-test-only',model:'mock-model',budget,fetcher}));
    expect(budget.settle).not.toHaveBeenCalled();
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
describe('durable writer budget',()=>{
  it('returns deterministic prose when a reservation would exceed the global cap',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:null,error:null});
    const writer=createOpenAIWriter({
      apiKey:'local-test-only',model:'gpt-4o-mini',fetcher:vi.fn(),
      budget:createWriterBudget({rpc},viewer),
    });
    expect(await writeRead(bundle,writer)).toEqual(plan);
    expect(rpc).toHaveBeenCalledWith('reserve_writer_budget',expect.objectContaining({p_viewer:viewer,p_model:'gpt-4o-mini'}));
    expect(rpc.mock.calls.some(call=>call[0]==='settle_writer_budget')).toBe(false);
  });
  it('records settled tokens so a second reservation sees the reduced remaining budget',async()=>{
    let held=0,spent=0;
    const cost=210;
    const rpc=vi.fn(async(fn:string,args:{p_input_tokens?:number;p_output_tokens?:number})=>{
      if(fn==='reserve_writer_budget'){
        if(held+spent+cost>300)return {data:null,error:null};
        held+=cost;
        return {data:'res-'+held,error:null};
      }
      held=0;
      spent+=Math.ceil((args.p_input_tokens??0)*150000/1e6)+Math.ceil((args.p_output_tokens??0)*600000/1e6);
      return {data:null,error:null};
    });
    const budget=createWriterBudget({rpc},viewer);
    expect(await budget.reserve({model:'gpt-4o-mini',inputBytes:1000,maxOutputTokens:100})).toBe('res-210');
    await budget.settle('res-210',{inputTokens:0,outputTokens:0});
    expect(await budget.reserve({model:'gpt-4o-mini',inputBytes:1000,maxOutputTokens:100})).toBe('res-210');
  });
  it('does not write a settle row for malformed usage',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:'res-1',error:null});
    const budget=createWriterBudget({rpc},viewer);
    await budget.settle('res-1',{inputTokens:Number.NaN,outputTokens:4});
    await budget.settle('res-1',{inputTokens:-1,outputTokens:4});
    await budget.settle('res-1',{inputTokens:1.5,outputTokens:4});
    expect(rpc).not.toHaveBeenCalled();
  });
});
