import {describe,it,expect} from 'vitest';
import {DEMO_PROFILES,score} from '@soul-tribe/core';
import {activityKey,matchResultFromCache,readMatchScores,SCORING_VERSION,scoreCacheRow,writeMatchScores} from '../matchScoreCache';

function client(rows:Record<string,unknown>[]){
  return {
    from(){
      return {
        select:()=>({eq:()=>({eq:()=>({eq:()=>({in:async()=>({data:rows,error:null})})})})}),
        async upsert(writes:Record<string,unknown>[]){
          for(const write of writes){
            const i=rows.findIndex(row=>row.user_a===write.user_a&&row.user_b===write.user_b&&row.activity_key===write.activity_key);
            if(i>=0)rows[i]=write;else rows.push(write);
          }
          return {error:null};
        },
      };
    },
  };
}

describe('directed match score cache',()=>{
  it('stores opposite directions as different rows because score(A,B) is not score(B,A)',async()=>{
    const a=structuredClone(DEMO_PROFILES[0]);
    const b=structuredClone(DEMO_PROFILES[1]);
    a.communication={...a.communication!,contact_frequency_expect:1,contact_frequency_self:0.9,answered:10};
    b.communication={...b.communication!,contact_frequency_expect:0.2,contact_frequency_self:1,answered:10};
    const aToB=score(a,b),bToA=score(b,a);
    expect(aToB.fit_a_to_b).not.toBe(bToA.fit_a_to_b);
    const rows:Record<string,unknown>[]=[];
    const db=client(rows);
    await writeMatchScores(db as never,[
      scoreCacheRow({viewerId:a.profile.id,candidateId:b.profile.id,activity:'',versionA:1,versionB:1,result:aToB}),
      scoreCacheRow({viewerId:b.profile.id,candidateId:a.profile.id,activity:'',versionA:1,versionB:1,result:bToA}),
    ]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row=>String(row.user_a)))).toEqual(new Set([a.profile.id,b.profile.id]));
    const cached=await readMatchScores(db as never,a.profile.id,'',[b.profile.id]);
    const hit=cached.get(b.profile.id);
    expect(hit?.scoring_version).toBe(SCORING_VERSION);
    expect(matchResultFromCache(hit!,a,b).rank_score).toBe(aToB.rank_score);
  });
  it('treats a missing activity category as the empty cache key',()=>{
    expect(activityKey(undefined)).toBe('');
    expect(activityKey('coffee')).toBe('coffee');
  });
});
