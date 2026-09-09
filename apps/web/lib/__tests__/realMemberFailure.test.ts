import {it, expect, vi, afterEach} from 'vitest';
vi.mock('../supabase', () => ({checkIsSupabaseConfigured:()=>true,
  getSupabaseBrowserClient:()=>({
    auth:{getSession:async()=>({data:{session:{user:{id:'test-viewer'},access_token:'test-only'}}})},
    rpc:async()=>({data:[],error:null}),
  })}));
import {getRankedMatches, mixedCandidateSource, demoCandidateSource} from '../matching';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
it.each(['mixed','demo','real'])('authenticated %s mode propagates server failure without demo fallback', async mode => {
  vi.stubEnv('NEXT_PUBLIC_CANDIDATE_MODE',mode);
  const mixed=vi.spyOn(mixedCandidateSource,'getScoredMatches');
  const demo=vi.spyOn(demoCandidateSource,'getCandidates');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Server matching is unconfigured'}),{status:500})));
  await expect(getRankedMatches({id:'test-viewer',deepProfile:{}} as any)).rejects.toThrow('Server matching is unconfigured');
  expect(mixed).not.toHaveBeenCalled();expect(demo).not.toHaveBeenCalled();
});
