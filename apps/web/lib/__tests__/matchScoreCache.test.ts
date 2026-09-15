import {describe,it,expect} from 'vitest';
import {DEMO_PROFILES,score} from '@soul-tribe/core';
import {activityKey,matchResultFromCache,readMatchScores,SCORING_VERSION,scoreCacheRow,writeMatchScores} from '../matchScoreCache';

function client(rows:Record<string,unknown>[]){
  return {
    from(){
      return {
        select(){
          const filters:Record<string,unknown>={};
          const q={
            eq(key:string,value:unknown){filters[key]=value;return q;},
            async in(_key:string,ids:string[]){
              return {
                data:rows.filter((row)=>
                  row.user_a===filters.user_a
                  &&row.activity_key===filters.activity_key
                  &&row.scoring_version===filters.scoring_version
                  &&row.small_pool===filters.small_pool
                  &&ids.includes(String(row.user_b))),
                error:null,
              };
            },
          };
          return q;
        },
        async upsert(writes:Record<string,unknown>[],opts:{onConflict:string}){
          expect(opts.onConflict).toBe('user_a,activity_key,user_b,small_pool');
          for(const write of writes){
            const i=rows.findIndex((row)=>
              row.user_a===write.user_a&&row.user_b===write.user_b
              &&row.activity_key===write.activity_key&&row.small_pool===write.small_pool);
            if(i>=0)rows[i]=write;else rows.push(write);
          }
          return {error:null};
        },
      };
    },
  };
}

function mismatchedPair(){
  const a=structuredClone(DEMO_PROFILES[0]);
  const b=structuredClone(DEMO_PROFILES[1]);
  a.social_rhythm={...a.social_rhythm!,availability:['sat_midday'],fri_night:false,sat_night:false};
  b.social_rhythm={...b.social_rhythm!,availability:['sun_evening'],fri_night:false,sat_night:false};
  return {a,b};
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
    const key=activityKey(undefined,40);
    await writeMatchScores(db as never,[
      scoreCacheRow({viewerId:a.profile.id,candidateId:b.profile.id,activity:key.activity,smallPool:key.smallPool,versionA:1,versionB:1,result:aToB}),
      scoreCacheRow({viewerId:b.profile.id,candidateId:a.profile.id,activity:key.activity,smallPool:key.smallPool,versionA:1,versionB:1,result:bToA}),
    ]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row=>String(row.user_a)))).toEqual(new Set([a.profile.id,b.profile.id]));
    const cached=await readMatchScores(db as never,a.profile.id,key.activity,key.smallPool,[b.profile.id]);
    const hit=cached.get(b.profile.id);
    expect(hit?.scoring_version).toBe(SCORING_VERSION);
    expect(matchResultFromCache(hit!,a,b).rank_score).toBe(aToB.rank_score);
  });
  it('treats a missing activity category as the empty cache key and pool size 8 as small-pool',()=>{
    expect(activityKey(undefined)).toEqual({activity:'',smallPool:false});
    expect(activityKey('coffee')).toEqual({activity:'coffee',smallPool:false});
    expect(activityKey('coffee',8).smallPool).toBe(true);
    expect(activityKey('coffee',40).smallPool).toBe(false);
    expect(activityKey('coffee',14).smallPool).toBe(true);
    expect(activityKey('coffee',15).smallPool).toBe(false);
  });
  it('does not serve a small-pool gate decision once the pool is large enough for those gates',async()=>{
    const {a,b}=mismatchedPair();
    const small=score(a,b,{candidatePoolSize:8});
    const large=score(a,b,{candidatePoolSize:40});
    expect(small.gate_reasons.includes('NO_SHARED_AVAILABILITY_SLOT')).toBe(false);
    expect(large.gate_reasons.includes('NO_SHARED_AVAILABILITY_SLOT')).toBe(true);
    expect(small.gated).not.toBe(large.gated);
    const rows:Record<string,unknown>[]=[];
    const db=client(rows);
    const smallKey=activityKey('',8);
    const largeKey=activityKey('',40);
    await writeMatchScores(db as never,[
      scoreCacheRow({viewerId:a.profile.id,candidateId:b.profile.id,activity:smallKey.activity,smallPool:smallKey.smallPool,versionA:1,versionB:1,result:small}),
    ]);
    const largeHits=await readMatchScores(db as never,a.profile.id,largeKey.activity,largeKey.smallPool,[b.profile.id]);
    expect(largeHits.size).toBe(0);
    const smallHits=await readMatchScores(db as never,a.profile.id,smallKey.activity,smallKey.smallPool,[b.profile.id]);
    expect(matchResultFromCache(smallHits.get(b.profile.id)!,a,b).gated).toBe(small.gated);
    await writeMatchScores(db as never,[
      scoreCacheRow({viewerId:a.profile.id,candidateId:b.profile.id,activity:largeKey.activity,smallPool:largeKey.smallPool,versionA:1,versionB:1,result:large}),
    ]);
    expect(rows).toHaveLength(2);
    const largeCached=await readMatchScores(db as never,a.profile.id,largeKey.activity,largeKey.smallPool,[b.profile.id]);
    expect(matchResultFromCache(largeCached.get(b.profile.id)!,a,b).gated).toBe(large.gated);
    const smallAgain=await readMatchScores(db as never,a.profile.id,smallKey.activity,smallKey.smallPool,[b.profile.id]);
    await writeMatchScores(db as never,[
      scoreCacheRow({viewerId:a.profile.id,candidateId:b.profile.id,activity:smallKey.activity,smallPool:smallKey.smallPool,versionA:1,versionB:1,result:small}),
    ]);
    expect(smallAgain.size).toBe(1);
    expect(rows).toHaveLength(2);
  });
  it('reuses the same-pool row on a second write so caching is not disabled',async()=>{
    const {a,b}=mismatchedPair();
    const rows:Record<string,unknown>[]=[];
    const db=client(rows);
    for(const size of [8,40]){
      const key=activityKey('',size);
      const result=score(a,b,{candidatePoolSize:size});
      const row=scoreCacheRow({viewerId:a.profile.id,candidateId:b.profile.id,activity:key.activity,smallPool:key.smallPool,versionA:1,versionB:1,result});
      await writeMatchScores(db as never,[row]);
      const first=await readMatchScores(db as never,a.profile.id,key.activity,key.smallPool,[b.profile.id]);
      expect(first.size).toBe(1);
      const before=rows.length;
      await writeMatchScores(db as never,[row]);
      const second=await readMatchScores(db as never,a.profile.id,key.activity,key.smallPool,[b.profile.id]);
      expect(second.size).toBe(1);
      expect(rows.length).toBe(before);
    }
  });
});
