import { PGlite } from '@electric-sql/pglite';
import { ltree } from '@electric-sql/pglite/contrib/ltree';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite({ extensions: { ltree, uuid_ossp } });
await db.exec(`
 create role authenticated; create role anon; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.role() returns text language sql as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
 grant usage on schema auth to authenticated,anon; grant execute on all functions in schema auth to authenticated,anon;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid,name text,bucket_id text);
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 grant usage on schema public to authenticated; alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
 alter default privileges in schema public grant usage,select on sequences to authenticated;
`);
for (const file of (
  await readdir(new URL('../supabase/migrations/', import.meta.url))
).sort()) {
  try {
    await db.exec(
      await readFile(
        new URL('../supabase/migrations/' + file, import.meta.url),
        'utf8',
      ),
    );
  } catch (e) {
    console.error('Migration failed:', file, e.message);
    process.exit(1);
  }
}
console.log('All committed migrations apply.');
const realtimeMigration = await readFile(new URL('../supabase/migrations/20260928000000_outing_realtime.sql', import.meta.url), 'utf8');
await db.exec(realtimeMigration);
assert.deepEqual((await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).rows.map(r=>r.tablename), ['outing_logistics','outing_members','outing_messages','outings']);
assert.deepEqual((await db.query("select pubinsert,pubupdate,pubdelete,pubtruncate from pg_publication where pubname='supabase_realtime'")).rows[0], {pubinsert:true,pubupdate:true,pubdelete:false,pubtruncate:false});
console.log('Passed repeatable four-table Realtime publication with delete/truncate disabled.');
const host = '10000000-0000-4000-8000-000000000001',
  guest = '10000000-0000-4000-8000-000000000002',
  other = '10000000-0000-4000-8000-000000000003';
const outing = '20000000-0000-4000-8000-000000000001';
for (const [i, id] of [host, guest, other].entries())
  await db.query(`insert into auth.users values($1);`, [id]);
async function as(id) {
  await db.exec(
    `reset role; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='${id}'; set role authenticated;`,
  );
}
async function fails(sql, pattern, params = []) {
  await assert.rejects(db.query(sql, params), pattern);
}
for (const [i, id] of [host, guest, other].entries()) {
  await as(id);
  await db.query(`select save_profile_bundle($1,'{}','{}',null)`, [
    {
      handle: 'member_' + i,
      display_name: 'Member ' + i,
      home_area: 'Singapore',
      birth_year: 1995,
    },
  ]);
}
await as(host);
await fails(`update profiles set tier='host_plus' where id=$1`, /Protected/, [
  host,
]);
await fails(`update profiles set status='banned' where id=$1`, /Protected/, [
  host,
]);
await db.query(
  `insert into outings(id,host_id,title,pitch,activity_category,area,starts_at,duration_minutes,budget_band,orientation,setting,max_participants,visibility,state) values($1,$2,'Coffee plan','Coffee together in a public cafe','coffee','Central',now()+interval '1 day',60,1,'either','quiet',2,'requestable','open')`,
  [outing, host],
);
assert.equal(
  (
    await db.query(
      `select count(*)::int n from outing_members where outing_id=$1`,
      [outing],
    )
  ).rows[0].n,
  1,
);
await fails(
  `insert into outing_members(outing_id,user_id,state) values($1,$2,'accepted')`,
  /approval/,
  [outing, guest],
);
await db.query(
  `insert into outing_members(outing_id,user_id,state) values($1,$2,'invited')`,
  [outing, guest],
);
await db.query(
  `insert into outing_logistics values($1,'Public cafe','Meet by the entrance','public',now())`,
  [outing],
);
await as(guest);
assert.equal((await db.query(`select * from outing_logistics`)).rows.length, 0);
await fails(
  `insert into outing_messages(outing_id,author_id,body) values($1,$2,'hello')`,
  /row-level security/,
  [outing, guest],
);
await db.query(
  `update outing_members set state='accepted' where outing_id=$1 and user_id=$2`,
  [outing, guest],
);
assert.equal((await db.query(`select * from outing_logistics`)).rows.length, 1);
await db.query(
  `insert into outing_messages(outing_id,author_id,body) values($1,$2,'See you there')`,
  [outing, guest],
);
await as(other);
await db.query(
  `insert into outing_members(outing_id,user_id,state) values($1,$2,'requested')`,
  [outing, other],
);
await fails(
  `update outing_members set state='accepted' where outing_id=$1 and user_id=$2`,
  /Invalid membership/,
  [outing, other],
);
await as(host);
await fails(
  `update outing_members set state='accepted' where outing_id=$1 and user_id=$2`,
  /OUTING_FULL/,
  [outing, other],
);
await as(guest);
await db.query(
  `update outing_members set state='withdrawn' where outing_id=$1 and user_id=$2`,
  [outing, guest],
);
assert.equal((await db.query(`select * from outing_logistics`)).rows.length, 0);
assert.equal((await db.query(`select * from outing_messages`)).rows.length, 0);
await as(host);
await db.query(
  `update outing_members set state='accepted' where outing_id=$1 and user_id=$2`,
  [outing, other],
);
// Private answer ownership and transactional rollback.
await db.query(`select save_profile_bundle(null,$1,$2,null)`, [
  { deep_profile: { private: 'owner text' } },
  { trait_personality: { extraversion: 0.3 } },
]);
await fails(`select save_profile_bundle(null,$1,$2,null)`, /Unsupported/, [
  { deep_profile: { private: 'should roll back' } },
  { profiles: { status: 'banned' } },
]);
assert.equal(
  (
    await db.query(
      `select deep_profile from profile_answers where user_id=$1`,
      [host],
    )
  ).rows[0].deep_profile.private,
  'owner text',
);
await as(guest);
assert.equal(
  (await db.query(`select * from profile_answers where user_id=$1`, [host]))
    .rows.length,
  0,
);
await as(other);
await fails(
  `insert into rhythm_checks(outing_id,author_id,about_id,would_meet_again) values($1,$2,$3,5)`,
  /Shared attendance/,
  [outing, other, host],
);
await db.query(`insert into blocks(blocker_id,blocked_id) values($1,$2)`, [
  other,
  host,
]);
assert.equal(
  (await db.query(`select * from profiles where id=$1`, [host])).rows.length,
  0,
);
assert.equal((await db.query(`select * from outing_messages`)).rows.length, 0);
await as(host);
assert.equal(
  (await db.query(`select * from profiles where id=$1`, [other])).rows.length,
  0,
);
await db.query(`update outings set state='cancelled' where id=$1`, [outing]);
assert.ok(
  (await db.query(`select * from outing_history where outing_id=$1`, [outing]))
    .rows.length > 0,
);
console.log(
  'Passed consent, capacity, membership revocation, account protection, bilateral block, private answers, rollback, reflection eligibility and retained history checks.',
);
// Baseline v2 security and transactional persistence.
const newcomer='10000000-0000-4000-8000-000000000004';
await db.exec('reset role');
await db.query('insert into auth.users values($1)',[newcomer]);
const token='a'.repeat(64);
const draft={version:2,step:6,intent:['Close circle'],clicks:['Our humour just lands'],group:'1:1',contact:0,planning:.5,opening:1,outings:['Analog Photo Walks','Indie Cinema'],handle:'newcomer',area:'Bedok',travel:'Nearby'};
await db.exec("set role anon; set request.jwt.claim.sub='';");
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[draft])).rows[0].valid,true);
draft.groupChoices=['1:1','Big energy'];
draft.q4Revision=2;
draft.desiredQualities=['Curious','Reliable','Open-minded'];
draft.opening=null;
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[draft])).rows[0].valid,true);
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...draft,desiredQualities:[]}])).rows[0].valid,false);
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...draft,desiredQualities:['Reliable','Reliable']}])).rows[0].valid,false);
await fails('select * from onboarding_drafts',/permission denied/);
await db.query('select save_onboarding_draft($1,$2)',[token,draft]);
await fails('select save_onboarding_draft($1,$2)',/Invalid draft/,[token,{...draft,groupChoices:['1:1','Small circle','Big energy']}]);
await fails('select save_onboarding_draft($1,$2)',/Invalid draft/,[token,{...draft,groupChoices:['1:1','1:1']}]);
assert.equal((await db.query('select read_onboarding_draft($1) d',['b'.repeat(64)])).rows[0].d,null);
await fails('select save_onboarding_draft($1,$2)',/Invalid draft/,[token,{...draft,outings:['invalid']}]);
await fails('select claim_onboarding_draft($1,$2,$3)',/permission denied/,[token,'New Member',1995]);
await as(newcomer);
await fails('select claim_onboarding_draft($1,$2,$3)',/adult birth year/,[token,'New Member',2020]);
await db.query('select claim_onboarding_draft($1,$2,$3)',[token,'New Member',1995]);
const savedVersion=(await db.query('select profile_version from profiles where id=$1',[newcomer])).rows[0].profile_version;
assert.equal((await db.query('select er_opening_pace from trait_emotional where user_id=$1',[newcomer])).rows[0].er_opening_pace,null);
assert.deepEqual((await db.query('select onboarding from profile_answers where user_id=$1',[newcomer])).rows[0].onboarding.baselineV2.desiredQualities,draft.desiredQualities);
assert.equal((await db.query('select group_size_pref from trait_experience where user_id=$1',[newcomer])).rows[0].group_size_pref,null);
assert.deepEqual((await db.query('select onboarding from profile_answers where user_id=$1',[newcomer])).rows[0].onboarding.baselineV2.groupChoices,['1:1','Big energy']);
await db.query('select claim_onboarding_draft($1,$2,$3)',[token,'New Member',1995]);
assert.equal((await db.query('select profile_version from profiles where id=$1',[newcomer])).rows[0].profile_version,savedVersion);
assert.equal((await db.query('select count(*)::int n from user_interests where user_id=$1',[newcomer])).rows[0].n,2);
assert.equal((await db.query('select contact_frequency_self from trait_communication where user_id=$1',[newcomer])).rows[0].contact_frequency_self,null);
assert.equal((await db.query('select depth from trait_intent where user_id=$1',[newcomer])).rows[0].depth,null);
assert.equal((await db.query('select count(*)::int n from trait_personality where user_id=$1',[newcomer])).rows[0].n,0);
await as(guest);
await fails('select claim_onboarding_draft($1,$2,$3)',/already saved/,[token,'Other Member',1995]);
assert.equal((await db.query('select read_onboarding_draft($1) d',[token])).rows[0].d,null);
console.log('Passed baseline draft isolation, validation, adult eligibility, atomic claim, idempotence and unknown trait preservation.');
const sixUser='10000000-0000-4000-8000-000000000005';
await db.exec('reset role');
await db.query('insert into auth.users values($1)',[sixUser]);
const six={...draft,flowVersion:3,step:7,handle:'six_member',desiredQualities:['Other'],qualityOther:'Patient',outings:['Water Sports','Other'],outingOther:'Stargazing',connectionChoice:'Other',connectionOther:'When we have something to share',planningChoice:'Other',planningOther:'It depends',punctualityChoice:'On time',punctualityOther:'',contact:null,planning:null};
await db.exec("set role anon; set request.jwt.claim.sub='';");
await db.query('select save_onboarding_draft($1,$2)',['c'.repeat(64),six]);
const customStart={...six,intent:['Other'],intentOther:'A walking companion',clicks:['Other'],clicksOther:'We make things together'};
const international = {...six,setupRevision:1,area:'Fitzroy',country:'Australia',ageBand:'25–34',ageOther:'',travelKm:50};
const lifeContextDraft={...international,setupRevision:2,ageBand:'',lifeContexts:['Slow Living','Family Life']};
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[lifeContextDraft])).rows[0].valid,true);
for(const lifeContexts of [[],['Slow Living','Slow Living'],['Slow Living','Family Life','Wild & Free','Adventure Era'],['Unknown']]) {
 assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...lifeContextDraft,lifeContexts}])).rows[0].valid,false);
}
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[international])).rows[0].valid,true);
for (const patch of [{ageBand:'Other',ageOther:'17'},{travelKm:51},{travelKm:1.5},{country:''},{ageBand:''}]) {
 assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...international,...patch}])).rows[0].valid,false);
}
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...six,desiredQualities:['Depth','Spiritual']}])).rows[0].valid,true);
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[customStart])).rows[0].valid,true);
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...customStart,intentOther:' '}])).rows[0].valid,false);
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...six,desiredQualities:['Free-spirit','Intellectually curious','Ambitious','Reliable','Other']}])).rows[0].valid,true);
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...six,desiredQualities:['Free-spirit','Intellectually curious','Ambitious','Reliable','Other','Playful']}])).rows[0].valid,false);
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...six,punctualityChoice:'',punctualityOther:''}])).rows[0].valid,true);
await fails('select save_onboarding_draft($1,$2)',/Invalid draft/,['c'.repeat(64),{...six,contact:1}]);
await fails('select save_onboarding_draft($1,$2)',/Invalid draft/,['c'.repeat(64),{...six,qualityOther:'x'.repeat(121)}]);
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...six,qualityOther:' '}])).rows[0].valid,false);
await as(sixUser);
await db.query('select claim_onboarding_draft($1,$2,$3)',['c'.repeat(64),'Six Member',1995]);
const sixSaved=(await db.query('select onboarding from profile_answers where user_id=$1',[sixUser])).rows[0].onboarding.baselineV2;
assert.equal(sixSaved.qualityOther,'Patient');assert.equal(sixSaved.outingOther,'Stargazing');assert.equal(sixSaved.punctualityChoice,'On time');
assert.equal((await db.query('select contact_frequency_expect from trait_communication where user_id=$1',[sixUser])).rows[0].contact_frequency_expect,null);
assert.equal((await db.query('select planning_horizon from trait_social_rhythm where user_id=$1',[sixUser])).rows[0].planning_horizon,null);
assert.equal((await db.query('select count(*)::int n from user_interests where user_id=$1',[sixUser])).rows[0].n,1);
console.log('Passed six-question custom text preservation, canonical rhythm validation and unknown custom signal tests.');
// Old private answers never become a public projection without the new disclosure.
await db.query('update profile_answers set onboarding=$1 where user_id=$2',[{baselineV2:lifeContextDraft},sixUser]);
assert.deepEqual((await db.query('select life_contexts from profiles where id=$1',[sixUser])).rows[0].life_contexts,[]);
await db.query('update profile_answers set onboarding=$1 where user_id=$2',[{baselineV2:{...lifeContextDraft,lifeContextsPublic:true}},sixUser]);
assert.deepEqual((await db.query('select life_contexts from profiles where id=$1',[sixUser])).rows[0].life_contexts,['Slow Living','Family Life']);
await fails('update profile_answers set onboarding=$1 where user_id=$2',/Invalid life phases/,[{baselineV2:{...lifeContextDraft,lifeContextsPublic:true,lifeContexts:['Unknown']}},sixUser]);
await db.query('update profile_answers set onboarding=$1 where user_id=$2',[{baselineV2:{...lifeContextDraft,lifeContextsPublic:false}},sixUser]);
assert.deepEqual((await db.query('select life_contexts from profiles where id=$1',[sixUser])).rows[0].life_contexts,[]);
console.log('Passed life phase disclosure, public projection, validation and withdrawal checks.');
// Isolated local regression fixtures; never run against production.
await as(sixUser);
await db.query('update profile_answers set onboarding=$1 where user_id=$2',[{baselineV2:{lifeContexts:['Slow Living'],lifeContextsPublic:false}},sixUser]);
await fails('update profiles set life_contexts=$1 where id=$2',/explicit consent/,[['Slow Living'],sixUser]);
for(const consent of [false,null,'true']) {
 await db.query('update profile_answers set onboarding=$1 where user_id=$2',[{baselineV2:{lifeContexts:['Slow Living'],lifeContextsPublic:consent}},sixUser]);
 assert.deepEqual((await db.query('select life_contexts from profiles where id=$1',[sixUser])).rows[0].life_contexts,[]);
}
const phases=['Slow Living','Family Life','Adventure Era'];
await db.query('update profile_answers set onboarding=$1 where user_id=$2',[{baselineV2:{lifeContexts:phases,lifeContextsPublic:true}},sixUser]);
assert.deepEqual((await db.query('select life_contexts from profiles where id=$1',[sixUser])).rows[0].life_contexts,phases);
for(const invalid of [[...phases,'Wild & Free'],['Slow Living','Slow Living'],['Unknown'],[null]]) {
 await fails('update profile_answers set onboarding=$1 where user_id=$2',/Invalid life phases/,[{baselineV2:{lifeContexts:invalid,lifeContextsPublic:true}},sixUser]);
}
await fails('update profiles set life_contexts=$1 where id=$2',/explicit consent/,[['Wild & Free'],sixUser]);
await db.query('delete from profile_answers where user_id=$1',[sixUser]);
assert.deepEqual((await db.query('select life_contexts from profiles where id=$1',[sixUser])).rows[0].life_contexts,[]);
await db.exec('reset role');
for(let repeat=0;repeat<2;repeat++) {
 await db.exec(await readFile(new URL('../supabase/migrations/20260926000000_public_life_context.sql',import.meta.url),'utf8'));
}
assert.equal((await db.query("select has_function_privilege('anon','guard_public_life_context()','EXECUTE') allowed")).rows[0].allowed,false);
console.log('Passed direct-write consent protection, strict boolean consent, three-phase limit, withdrawal/deletion and repeatable migration.');
// New public answer sharing is opt-in and never backfills previous answers.
assert.equal((await db.query("select count(*)::int n from profiles where public_onboarding <> '{}'::jsonb")).rows[0].n,0);
await as(sixUser);
const sharing={...lifeContextDraft,lifeContextsPublic:false,answersPublic:true};
await db.query('insert into profile_answers(user_id,onboarding) values($1,$2)',[sixUser,{baselineV2:{...sharing,answersPublic:false}}]);
await fails('update profiles set public_onboarding=$1 where id=$2',/explicit sharing consent/,[{intent:['Close circle']},sixUser]);
await db.query('update profile_answers set onboarding=$1 where user_id=$2',[{baselineV2:sharing},sixUser]);
let publicAnswers=(await db.query('select public_onboarding from profiles where id=$1',[sixUser])).rows[0].public_onboarding;
assert.deepEqual(publicAnswers.desiredQualities,sharing.desiredQualities);
assert.deepEqual(publicAnswers.groupChoices,sharing.groupChoices);
assert.equal(publicAnswers.area,undefined);assert.equal(publicAnswers.ageBand,undefined);assert.equal(publicAnswers.lifeContexts,undefined);
await fails('update profile_answers set onboarding=$1 where user_id=$2',/Complete and review/,[{baselineV2:{...sharing,outings:['Invalid']}},sixUser]);
for(const consent of [false,'true',null]) {
 await db.query('update profile_answers set onboarding=$1 where user_id=$2',[{baselineV2:{...sharing,answersPublic:consent}},sixUser]);
 assert.deepEqual((await db.query('select public_onboarding from profiles where id=$1',[sixUser])).rows[0].public_onboarding,{});
}
await db.exec('reset role');
for(let i=0;i<2;i++)await db.exec(await readFile(new URL('../supabase/migrations/20260927000000_public_onboarding_preferences.sql',import.meta.url),'utf8'));
console.log('Passed explicit public-answer consent, exact allowed-field projection, withdrawal, direct-write protection and repeatability.');
// Early Read corrections remain exact and private even when answers are shared.
await as(sixUser);
const corrected={...sharing,earlyReadFeedback:{qualities:{status:'not_quite',text:'My private correction',basis:'["Reliable"]'}}};
await db.query('update profile_answers set onboarding=$1 where user_id=$2',[{baselineV2:corrected},sixUser]);
assert.deepEqual((await db.query('select onboarding from profile_answers where user_id=$1',[sixUser])).rows[0].onboarding.baselineV2.earlyReadFeedback,corrected.earlyReadFeedback);
assert.equal((await db.query('select public_onboarding from profiles where id=$1',[sixUser])).rows[0].public_onboarding.earlyReadFeedback,undefined);
console.log('Passed exact private Early Read correction persistence with no public projection.');

// Real handoff shape (setupRevision=2), using isolated local fixtures only.
await db.exec('reset role');
const handoffMigration=await readFile(new URL('../supabase/migrations/20260929000000_complete_onboarding_handoff.sql',import.meta.url),'utf8');
await db.exec(handoffMigration); await db.exec(handoffMigration);
const handoffUser='10000000-0000-4000-8000-000000000006';
await db.query('insert into auth.users values($1)',[handoffUser]);
await as(handoffUser);
const existingIdentity={handle:'handoff_member',display_name:'handoff_member',home_area:'Bedok',birth_year:1995,avatar_url:'avatars/member-photo.webp',bio:'Existing introduction'};
await db.query('select save_profile_bundle($1,$2,$3,null)',[existingIdentity,{deep_profile:{selfDescriptionOpen:'Existing exact words'},completed_categories:[5]},{trait_emotional:{er_opening_pace:.75},trait_personality:{extraversion:.25}}]);
const modern={...lifeContextDraft,handle:existingIdentity.handle,lifeContextsPublic:true};
const handoffToken='d'.repeat(64);
await db.query('select save_onboarding_draft($1,$2)',[handoffToken,modern]);
assert.equal((await db.query('select read_onboarding_handoff($1) h',[handoffToken])).rows[0].h.claimed,false);
await as(guest);
assert.equal((await db.query('select read_onboarding_handoff($1) h',[handoffToken])).rows[0].h,null);
await fails('select save_onboarding_draft($1,$2)',/unavailable/,[handoffToken,modern]);
await fails('select claim_onboarding_draft($1,$2,$3)',/another account/,[handoffToken,'Wrong account',1995]);
await as(handoffUser);
await db.query('select claim_onboarding_draft($1,$2,$3)',[handoffToken,'Must not overwrite identity',1990]);
const committed=(await db.query('select onboarding,deep_profile,completed_categories from profile_answers where user_id=$1',[handoffUser])).rows[0];
assert.deepEqual(committed.onboarding.baselineV2,modern);
assert.equal(committed.deep_profile.selfDescriptionOpen,'Existing exact words');
assert.deepEqual(committed.completed_categories,[5]);
const keptIdentity=(await db.query('select handle,display_name,birth_year,avatar_url,bio,home_area,profile_version from profiles where id=$1',[handoffUser])).rows[0];
for(const key of ['handle','display_name','birth_year','avatar_url','bio'])assert.equal(keptIdentity[key],existingIdentity[key]);
assert.equal(keptIdentity.home_area,modern.area);
assert.equal(Number((await db.query('select er_opening_pace from trait_emotional where user_id=$1',[handoffUser])).rows[0].er_opening_pace),.75);
assert.equal(Number((await db.query('select extraversion from trait_personality where user_id=$1',[handoffUser])).rows[0].extraversion),.25);
assert.equal((await db.query('select read_onboarding_handoff($1) h',[handoffToken])).rows[0].h.claimed,true);
await db.query('select claim_onboarding_draft($1,$2,$3)',[handoffToken,null,null]);
assert.equal((await db.query('select profile_version from profiles where id=$1',[handoffUser])).rows[0].profile_version,keptIdentity.profile_version);

// Mid-transaction failure must retain the complete draft and previous profile.
const edited={...modern,planningChoice:'About a week',planningOther:'',planning:.75};
await db.query('select save_onboarding_draft($1,$2)',['e'.repeat(64),edited]);
await db.exec(`reset role;
 create function fail_handoff_test() returns trigger language plpgsql as $$begin raise exception 'Injected trait failure'; end$$;
 create trigger fail_handoff_test before update on trait_social_rhythm for each row execute function fail_handoff_test();`);
await as(handoffUser);
await fails('select claim_onboarding_draft($1,$2,$3)',/Injected trait failure/,['e'.repeat(64),null,null]);
assert.deepEqual((await db.query('select onboarding from profile_answers where user_id=$1',[handoffUser])).rows[0].onboarding,committed.onboarding);
assert.equal((await db.query('select profile_version from profiles where id=$1',[handoffUser])).rows[0].profile_version,keptIdentity.profile_version);
assert.equal((await db.query('select read_onboarding_handoff($1) h',['e'.repeat(64)])).rows[0].h.claimed,false);
await db.exec('reset role; drop trigger fail_handoff_test on trait_social_rhythm; drop function fail_handoff_test();');
await as(handoffUser);
await db.query('select claim_onboarding_draft($1,$2,$3)',['e'.repeat(64),null,null]);
assert.deepEqual((await db.query('select onboarding from profile_answers where user_id=$1',[handoffUser])).rows[0].onboarding.baselineV2,edited);
await db.query('select save_onboarding_draft($1,$2)',['f'.repeat(64),modern]);
await db.query('update profiles set profile_version=profile_version+1 where id=$1',[handoffUser]);
await fails('select claim_onboarding_draft($1,$2,$3)',/profile changed/,['f'.repeat(64),null,null]);

// A pre-auth modern draft creates a profile exactly once after verified sign-in.
const newHandoffUser='10000000-0000-4000-8000-000000000007';
await db.exec('reset role'); await db.query('insert into auth.users values($1)',[newHandoffUser]);
const newAnswers={...modern,handle:'new_handoff',displayName:'New handoff member'};
await db.exec("set role anon; set request.jwt.claim.sub='';");
await db.query('select save_onboarding_draft($1,$2)',['a1'.repeat(32),newAnswers]);
await fails('select claim_onboarding_draft($1,$2,$3)',/permission denied/,['a1'.repeat(32),newAnswers.displayName,1995]);
await as(newHandoffUser);
await db.query('select claim_onboarding_draft($1,$2,$3)',['a1'.repeat(32),newAnswers.displayName,1995]);
assert.deepEqual((await db.query('select onboarding from profile_answers where user_id=$1',[newHandoffUser])).rows[0].onboarding.baselineV2,newAnswers);
assert.equal((await db.query('select read_onboarding_handoff($1) h',['a1'.repeat(32)])).rows[0].h.claimed,true);
await fails('select claim_onboarding_draft_before_handoff($1,$2,$3)',/permission denied/,['a1'.repeat(32),newAnswers.displayName,1995]);
console.log('Passed modern new/existing-member handoff, literal transfer, identity and unasked-trait preservation, owner isolation, rollback, retry, stale-edit protection and migration repeatability.');
// Reproduce the actual production drift: the trigger exists but its prerequisite
// columns do not. These are disposable local fixtures, never production DDL.
await db.exec('reset role; alter table profiles drop column is_demo; alter table outings drop column is_demo; alter table outing_members drop column is_demo;');
await as(handoffUser);
await fails('update profiles set home_area=home_area where id=$1',/record "new" has no field "is_demo"/,[handoffUser]);
await db.exec('reset role');
const guardBefore=(await db.query("select pg_get_functiondef('protect_account_fields()'::regprocedure) body")).rows[0].body;
const schemaRepair=await readFile(new URL('../supabase/migrations/20260930000000_restore_demo_flag_schema.sql',import.meta.url),'utf8');
await db.exec(schemaRepair);
await db.exec("set request.jwt.claim.role='';");
await db.query('update profiles set is_demo=true where id=$1',[other]);
await db.exec(schemaRepair);
assert.equal((await db.query('select is_demo from profiles where id=$1',[other])).rows[0].is_demo,true);
assert.equal((await db.query("select pg_get_functiondef('protect_account_fields()'::regprocedure) body")).rows[0].body,guardBefore);
await as(handoffUser);
await db.query('select save_onboarding_draft($1,$2)',['b1'.repeat(32),modern]);
await db.query('select claim_onboarding_draft($1,$2,$3)',['b1'.repeat(32),null,null]);
assert.deepEqual((await db.query('select onboarding from profile_answers where user_id=$1',[handoffUser])).rows[0].onboarding.baselineV2,modern);
await fails('update profiles set is_demo=true where id=$1',/Protected/,[handoffUser]);
await fails("update profiles set tier='host_plus' where id=$1",/Protected/,[handoffUser]);
await fails("update profiles set status='banned' where id=$1",/Protected/,[handoffUser]);
assert.equal((await db.query("select count(*)::int n from profile_answers where user_id=$1",[other])).rows[0].n,0);
console.log('Passed production missing-is_demo reproduction, additive repair, member handoff, unchanged account guard/RLS and repeatability without rewriting flags.');
// A different draft handle is not ownership evidence, nor a request to rename
// the authenticated account. Preserve literal answers and all account identities.
const differentHandle={...modern,handle:'member_1'};
const mismatchToken='c1'.repeat(32);
await db.query('select save_onboarding_draft($1,$2)',[mismatchToken,differentHandle]);
await fails('select claim_onboarding_draft($1,$2,$3)',/Use your existing profile handle/,[mismatchToken,null,null]);
await db.exec('reset role');
const identityRepair=await readFile(new URL('../supabase/migrations/20261001000000_preserve_onboarding_account_identity.sql',import.meta.url),'utf8');
await db.exec(identityRepair);await db.exec(identityRepair);
await as(guest);
await fails('select claim_onboarding_draft($1,$2,$3)',/another account/,[mismatchToken,null,null]);
await as(handoffUser);
const claimed=(await db.query('select claim_onboarding_draft($1,$2,$3) payload',[mismatchToken,null,null])).rows[0].payload;
assert.deepEqual(claimed,differentHandle);
const identityAnswers=(await db.query('select onboarding from profile_answers where user_id=$1',[handoffUser])).rows[0].onboarding;
assert.deepEqual(identityAnswers.baselineV2,differentHandle);
assert.equal(identityAnswers.handle,existingIdentity.handle);
assert.equal((await db.query('select handle from profiles where id=$1',[handoffUser])).rows[0].handle,existingIdentity.handle);
assert.equal((await db.query('select handle from profiles where id=$1',[guest])).rows[0].handle,'member_1');
assert.equal((await db.query('select read_onboarding_handoff($1) h',[mismatchToken])).rows[0].h.claimed,true);
const versionAfterIdentityRepair=(await db.query('select profile_version from profiles where id=$1',[handoffUser])).rows[0].profile_version;
await db.query('select claim_onboarding_draft($1,$2,$3)',[mismatchToken,null,null]);
assert.equal((await db.query('select profile_version from profiles where id=$1',[handoffUser])).rows[0].profile_version,versionAfterIdentityRepair);
// Stale-write and anonymous access protections survive the identity repair.
await fails('select claim_onboarding_draft($1,$2,$3)',/profile changed/,['f'.repeat(64),null,null]);
await db.exec("reset role; set request.jwt.claim.sub=''; set request.jwt.claim.role='anon'; set role anon;");
await fails('select claim_onboarding_draft($1,$2,$3)',/permission denied/,[mismatchToken,null,null]);
console.log('Passed mismatched-handle reproduction and repair, exact literal payload, unchanged account handles, owner isolation, idempotent retry and unchanged stale-write/authentication checks.');
// The production-shaped case: a pre-auth draft and an existing account with no
// baseline yet. It must attach by authenticated id, not its typed handle.
await db.exec("reset role; set request.jwt.claim.role='';");
const returningUser='10000000-0000-4000-8000-000000000008';
await db.query('insert into auth.users values($1)',[returningUser]);
await as(returningUser);
await db.query('select save_profile_bundle($1,$2,$3,null)',[{handle:'returning_member',display_name:'Returning member',birth_year:1995,home_area:'Bedok'},{},{}]);
await db.exec("reset role; set request.jwt.claim.sub=''; set request.jwt.claim.role='anon'; set role anon;");
await db.query('select save_onboarding_draft($1,$2)',['d1'.repeat(32),differentHandle]);
await as(returningUser);
await db.query('select claim_onboarding_draft($1,$2,$3)',['d1'.repeat(32),null,null]);
assert.equal((await db.query('select handle from profiles where id=$1',[returningUser])).rows[0].handle,'returning_member');
assert.deepEqual((await db.query('select onboarding from profile_answers where user_id=$1',[returningUser])).rows[0].onboarding.baselineV2,differentHandle);
console.log('Passed anonymous-draft Google-return shape for an existing account with no baseline and a different typed handle.');


// Isolated fixtures only: username privacy, availability, uniqueness, and RLS.
await db.exec('reset role');
const usernameMigration=await readFile(new URL('../supabase/migrations/20261002000000_public_username.sql',import.meta.url),'utf8');
await db.exec(usernameMigration);
await as(host);
assert.equal((await db.query('select display_name=handle as aligned from profiles where id=$1',[host])).rows[0].aligned,true);
await db.query("update profiles set display_name='Private OAuth Name' where id=$1",[host]);
assert.equal((await db.query('select display_name from profiles where id=$1',[host])).rows[0].display_name,'member_0');
assert.equal((await db.query("select username_available(' MEMBER_0 ') as available")).rows[0].available,true);
await as(guest);
assert.equal((await db.query("select username_available('MEMBER_0') as available")).rows[0].available,false);
await fails("update profiles set handle='member_0' where id=$1",/unique|duplicate/,[guest]);
await fails("update profiles set handle='Member_0' where id=$1",/check constraint/,[guest]);
await db.exec("reset role; set request.jwt.claim.sub=''; set role anon");
for(const [value,wanted] of [['member_0',false],['never_reserved_test',true],['ab',false],['mail@example.com',false],['%',false],[null,false]]) {
 assert.equal((await db.query('select username_available($1) as available',[value])).rows[0].available,wanted);
}
await fails('select * from profiles',/permission denied|row-level security/);
await db.exec('reset role');
assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.profiles'::regclass")).rows[0].relrowsecurity,true);
console.log('Passed public username privacy, repeatable migration, anonymous boolean-only lookup, owner exclusion, invalid inputs, atomic uniqueness and unchanged RLS.');
// Provenance uses isolated local fixtures; never inserts production member answers.
await db.exec('reset role');
const provenanceSql=await readFile(new URL('../supabase/migrations/20261003000000_answer_provenance.sql',import.meta.url),'utf8');
const cacheSql=await readFile(new URL('../supabase/migrations/20261004000000_match_explanation_cache.sql',import.meta.url),'utf8');
const beforeAnswers=(await db.query('select user_id,onboarding from profile_answers order by user_id')).rows;
await db.exec(provenanceSql);await db.exec(cacheSql);
assert.deepEqual((await db.query('select user_id,onboarding from profile_answers order by user_id')).rows,beforeAnswers);
const catalog=JSON.parse(await readFile(new URL('../apps/web/lib/onboardingQuestionCatalog.json',import.meta.url),'utf8'));
assert.deepEqual((await db.query('select onboarding_question_catalog_v1() catalog')).rows[0].catalog,catalog);
await as(host);
const provenanceToken='e7'.repeat(32);
const provenanceDraft={...modern,handle:'member_0',answerContractVersion:1,submittedStep:1};
await db.query('select save_onboarding_draft($1,$2)',[provenanceToken,provenanceDraft]);
let saved=(await db.query('select read_onboarding_draft($1) draft',[provenanceToken])).rows[0].draft;
const intentRecord=saved.answerRecords['friendship.intent'];
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...provenanceDraft,answerRecords:{padding:'x'.repeat(9000)}}])).rows[0].valid,true);
assert.equal((await db.query('select validate_baseline_draft($1,true) valid',[{...provenanceDraft,answerRecords:{padding:'x'.repeat(33000)}}])).rows[0].valid,false);
assert.equal(intentRecord.questionId,'friendship.intent');
assert.equal(intentRecord.questionVersion,1);
assert.equal(intentRecord.timestampSource,'database_received');
assert.ok(Date.parse(intentRecord.submittedAt));
assert.deepEqual(intentRecord.answer.intent,provenanceDraft.intent);
assert.deepEqual(Object.keys(saved.answerRecords),['friendship.intent']);
assert.equal(intentRecord.selections[0].optionId,'friendship.intent.01');
// Client-forged records are stripped, unchanged records preserve server timestamps.
await db.query('select save_onboarding_draft($1,$2)',[provenanceToken,{...provenanceDraft,answerRecords:{fake:{questionVersion:999}}}]);
saved=(await db.query('select read_onboarding_draft($1) draft',[provenanceToken])).rows[0].draft;
assert.deepEqual(saved.answerRecords,{'friendship.intent':intentRecord});
await db.query('select save_onboarding_draft($1,$2)',[provenanceToken,{...provenanceDraft,submittedStep:2}]);
saved=(await db.query('select read_onboarding_draft($1) draft',[provenanceToken])).rows[0].draft;
assert.deepEqual(Object.keys(saved.answerRecords).sort(),['friendship.clicks','friendship.intent']);
await db.query('select claim_onboarding_draft($1,$2,$3)',[provenanceToken,null,null]);
const transferred=(await db.query('select onboarding from profile_answers where user_id=$1',[host])).rows[0].onboarding.baselineV2;
assert.deepEqual(transferred.answerRecords,saved.answerRecords);
const fullToken='e8'.repeat(32);
const fullDraft={...modern,handle:'member_0',answerContractVersion:1,connectionChoice:'About once a week',connectionOther:'',planningChoice:'About a week',planningOther:'',contact:.5,planning:.75};
for(let step=1;step<=7;step++)await db.query('select save_onboarding_draft($1,$2)',[fullToken,{...fullDraft,submittedStep:step}]);
const fullSaved=(await db.query('select read_onboarding_draft($1) draft',[fullToken])).rows[0].draft;
assert.equal(Object.keys(fullSaved.answerRecords).length,catalog.length);
await db.query('select claim_onboarding_draft($1,$2,$3)',[fullToken,null,null]);
assert.deepEqual((await db.query('select onboarding from profile_answers where user_id=$1',[host])).rows[0].onboarding.baselineV2.answerRecords,fullSaved.answerRecords);
await as(guest);
assert.equal((await db.query('select read_onboarding_draft($1) draft',[provenanceToken])).rows[0].draft,null);
await db.exec('reset role');
// No explanation storage is exposed directly to either authenticated participant.
await as(host);await fails('select * from match_explanations',/permission denied/);
await db.exec('reset role');
await db.query('delete from blocks where blocker_id in ($1,$2) or blocked_id in ($1,$2)',[host,guest]);
await db.query('delete from reports where reporter_id in ($1,$2) or reported_id in ($1,$2)',[host,guest]);
await db.query("update profiles set status='active' where id in ($1,$2)",[host,guest]);
const insertCache=async(a=host,b=guest)=>db.query(`insert into match_explanations(user_a,user_b,click_text,friction_text,generated_by,version_a,version_b,revision_a,revision_b,input_hash)
 select a.id,b.id,'local test','local test','test',a.profile_version,b.profile_version,a.explanation_revision,b.explanation_revision,'test'
 from profiles a,profiles b where a.id=$1 and b.id=$2 on conflict(user_a,user_b) do update set revision_a=excluded.revision_a,revision_b=excluded.revision_b`,[a,b]);
const cachedCount=async()=>Number((await db.query('select count(*) n from match_explanations where user_a=$1 or user_b=$1',[host])).rows[0].n);
for(const mutation of [
 "update trait_personality set answered=answered where user_id=$1",
 "update profile_answers set onboarding=onboarding where user_id=$1",
 "update profiles set profile_version=profile_version+1 where id=$1",
 "update profile_answers set onboarding=jsonb_set(onboarding,'{baselineV2,lifeContextsPublic}','false') where user_id=$1",
]) {
 await insertCache();await insertCache(guest,host);assert.equal(await cachedCount(),2);
 await db.query(mutation,[host]);assert.equal(await cachedCount(),0);
}
await insertCache();
await db.query('insert into blocks(blocker_id,blocked_id) values($1,$2)',[guest,host]);
assert.equal(await cachedCount(),0);
await assert.rejects(insertCache(),/Matching inputs changed/);
await db.query('delete from blocks where blocker_id=$1 and blocked_id=$2',[guest,host]);
await insertCache();
await db.query("insert into reports(reporter_id,reported_id,category) values($1,$2,'local test')",[guest,host]);
assert.equal(await cachedCount(),0);await assert.rejects(insertCache(),/Matching inputs changed/);
await db.query('delete from reports where reporter_id=$1 and reported_id=$2',[guest,host]);
await insertCache();
const stale=(await db.query('select * from match_explanations where user_a=$1 and user_b=$2',[host,guest])).rows[0];
await db.query('update profiles set explanation_revision=explanation_revision where id=$1',[host]);
await fails(`insert into match_explanations(user_a,user_b,click_text,friction_text,generated_by,version_a,version_b,revision_a,revision_b)
 values($1,$2,'local test','local test','test',$3,$4,$5,$6)`,/Matching inputs changed/,[host,guest,stale.version_a,stale.version_b,stale.revision_a,stale.revision_b]);
console.log('Passed provenance timestamps, IDs, catalog consistency, no backfill, exact atomic claim, RLS, bidirectional invalidation, safety denial and stale cache rejection.');
// 8a: isolated database fixtures, never run against production.
await as(host);
await db.query("update profile_answers set deep_profile=deep_profile||$1::jsonb where user_id=$2",[{repairFirst:'Ask how they saw it',repairNeed:'A clear apology',initiationChoice:'It goes both ways'},host]);
assert.equal((await db.query("select question_version from read_answer_sources where user_id=$1 and question_id='repair.first'",[host])).rows[0].question_version,1);
assert.deepEqual((await db.query('select answers from trait_repair where user_id=$1',[host])).rows[0].answers,{'repair.first':['Ask how they saw it'],'repair.need':['A clear apology']});
await assert.rejects(db.query("update profile_answers set deep_profile=deep_profile||$1::jsonb where user_id=$2",[{repairFirst:'invented option'},host]),/Unknown selection/);
await assert.rejects(db.query("update profile_answers set deep_profile=deep_profile||$1::jsonb where user_id=$2",[{repairNeed:'A clear apology · We agree on a practical change · They understand what bothered me'},host]),/Too many selections/);
await as(guest);
assert.equal((await db.query("select * from read_answer_sources where user_id=$1 and thread='repair'",[host])).rows.length,0);
assert.equal((await db.query('select * from trait_repair where user_id=$1',[host])).rows.length,0);
assert.equal((await db.query("select * from read_answer_sources where user_id=$1 and thread='initiative'",[host])).rows.length,1);
await assert.rejects(db.query('select * from peer_observations'),/permission denied/);
await assert.rejects(db.query('select * from peer_read_checks'),/permission denied/);
await assert.rejects(db.query('select * from composed_read_cache'),/permission denied/);
await assert.rejects(db.query('select claim_composed_read($1,$2,\'profile\',\'h\',\'e\',\'w\',\'d\')',[guest,guest]),/permission denied/);
assert.deepEqual((await db.query('select read_peer_signals($1) result',[host])).rows[0].result,[]);
await assert.rejects(db.query('select submit_peer_observation($1,$2,$3,$4)',[outing,host,'peer.joining','started']),/Confirmed shared attendance/);
await assert.rejects(db.query('select submit_peer_observation($1,$2,$3,$4)',[outing,guest,'peer.joining','started']),/Observation unavailable/);
await db.exec('reset role');
await db.query('delete from composed_read_cache where viewer_id=$1',[host]);
const claimArgs=[host,host,'profile','evidence1','engine1','writer1','disclosure1'];
const lease=(await db.query('select claim_composed_read($1,$2,$3,$4,$5,$6,$7) result',claimArgs)).rows[0].result;
assert.equal(lease.state,'claimed');
assert.equal((await db.query('select claim_composed_read($1,$2,$3,$4,$5,$6,$7) result',claimArgs)).rows[0].result.state,'busy');
assert.equal((await db.query('select finish_composed_read($1,$2,$3,$4,$5,$6) result',[host,host,'profile','evidence1',lease.lease,{sections:[]}])).rows[0].result,true);
assert.equal((await db.query('select claim_composed_read($1,$2,$3,$4,$5,$6,$7) result',claimArgs)).rows[0].result.state,'hit');
const nextLease=(await db.query('select claim_composed_read($1,$2,$3,$4,$5,$6,$7) result',[...claimArgs.slice(0,3),'evidence2',...claimArgs.slice(4)])).rows[0].result;
assert.equal(nextLease.state,'claimed');
assert.equal((await db.query('select finish_composed_read($1,$2,$3,$4,$5,$6) result',[host,host,'profile','evidence1',lease.lease,{sections:[]}])).rows[0].result,false);
for(const name of ['20261005000000_read_engine.sql','20261006000000_peer_observations.sql','20261007000000_repair_scoring.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
await as(host);
await db.query("update profile_answers set deep_profile=deep_profile||$1::jsonb where user_id=$2",[{repairFirst:'Prefer not to say',repairNeed:'Prefer not to say'},host]);
assert.equal((await db.query('select * from trait_repair where user_id=$1',[host])).rows.length,0);
// Fresh, isolated test-only members and outings. Never used in a live database.
await db.exec("reset role; set request.jwt.claim.role='service_role'");
const observers=Array.from({length:5},(_,i)=>`30000000-0000-4000-8000-00000000000${i+1}`);
const peerOutings=Array.from({length:3},(_,i)=>`40000000-0000-4000-8000-00000000000${i+1}`);
for(const [i,id] of observers.entries()){
 await db.query('insert into auth.users values($1)',[id]);
 await db.query("insert into profiles(id,handle,display_name,home_area,birth_year) values($1,$2,'Isolated test member','Singapore',1990)",[id,'peer_fixture_'+i]);
}
for(const id of peerOutings){
 await db.query("insert into outings(id,host_id,title,pitch,activity_category,area,starts_at,duration_minutes,budget_band,orientation,setting,max_participants,state) values($1,$2,'Local test outing','An isolated local database fixture','coffee','Singapore',now()-interval '20 days',60,1,'either','quiet',6,'open')",[id,host]);
 for(const actor of observers){
  await as(host);await db.query("insert into outing_members(outing_id,user_id,role,state) values($1,$2,'guest','invited')",[id,actor]);
  await as(actor);await db.query("update outing_members set state='accepted' where outing_id=$1 and user_id=$2",[id,actor]);
 }
 await as(host);
 await db.query('insert into outing_records(outing_id,attended) values($1,$2)',[id,[host,...observers]]);
 await db.exec('reset role');
 for(const actor of [host,...observers])await db.query('insert into outing_presence_confirmations(outing_id,user_id) values($1,$2)',[id,actor]);
 await db.query("update outings set state='completed' where id=$1",[id]);
}
for(const [i,actor] of observers.entries())await db.query("insert into peer_observations(outing_id,observer_id,subject_id,question_id,option_id,created_at) values($1,$2,$3,'peer.joining','started',now()-interval '14 days')",[peerOutings[i%3],actor,host]);
await db.query("update peer_signal_releases set period_start=date_trunc('week',now())-interval '1 week',invalidated_at=null where subject_id=$1",[host]);
await as(host);
const released=(await db.query('select read_peer_signals($1) result',[host])).rows[0].result;
assert.equal(released.length,1);assert.equal(released[0].evidenceLevel,'PEER OBSERVATION');
assert.equal(JSON.stringify(released).includes('observer_id'),false);
await as(observers[0]);
await db.query('select submit_peer_observation($1,$2,$3,$4)',[peerOutings[0],host,'peer.joining',null]);
await as(host);
assert.deepEqual((await db.query('select read_peer_signals($1) result',[host])).rows[0].result,[]);
await db.exec('reset role');
await db.query("update peer_signal_releases set period_start=date_trunc('week',now())-interval '1 week' where subject_id=$1",[host]);
await as(host);
assert.deepEqual((await db.query('select read_peer_signals($1) result',[host])).rows[0].result,[]);
await assert.rejects(db.query('select * from read_phrase_history'),/permission denied/);
await db.exec('reset role');
// The latest abstention replaces, rather than revives, an older positive response.
await db.query("insert into peer_observations(outing_id,observer_id,subject_id,question_id,option_id,created_at) values($1,$2,$3,'peer.joining','started',now()-interval '14 days')",[peerOutings[0],observers[0],host]);
await db.query("insert into peer_observations(outing_id,observer_id,subject_id,question_id,option_id,created_at) values($1,$2,$3,'peer.joining','cannot_tell',date_trunc('week',now())-interval '1 day')",[peerOutings[1],observers[0],host]);
await db.query("update peer_signal_releases set period_start=date_trunc('week',now())-interval '1 week' where subject_id=$1",[host]);
await as(host);assert.deepEqual((await db.query('select read_peer_signals($1) result',[host])).rows[0].result,[]);
await db.exec('reset role');
const peerLease=(await db.query("select claim_composed_read($1,$2,'bond','peer-check','engine','writer','disclosure') result",[observers[0],host])).rows[0].result;
await db.query("select finish_composed_read($1,$2,'bond','peer-check',$3,$4)",[observers[0],host,peerLease.lease,{sections:[]}]);
await as(observers[0]);
assert.equal((await db.query("select can_submit_peer_read_check($1,'peer-check','writer') ok",[host])).rows[0].ok,true);
await db.query("select submit_peer_read_check($1,'peer-check','writer','mostly')",[host]);
await db.query('insert into blocks(blocker_id,blocked_id) values($1,$2)',[observers[0],host]);
assert.equal((await db.query("select can_submit_peer_read_check($1,'peer-check','writer') ok",[host])).rows[0].ok,false);
await assert.rejects(db.query("select submit_peer_read_check($1,'peer-check','writer','mostly')",[host]),/unavailable/);
await db.query("select submit_peer_read_check($1,'peer-check','writer',null)",[host]);
await db.exec('reset role');
for (let i = 0; i < 2; i++) {
  await db.exec(await readFile(new URL('../supabase/migrations/20261009000000_three_box_foundation.sql', import.meta.url), 'utf8'));
}
await as(host);
await db.query('select upsert_live_presence($1,$2,true)', [103.8198, 1.3521]);
await as(guest);
await db.query('select upsert_live_presence($1,$2,true)', [103.821, 1.353]);
await as(other);
await db.query('select upsert_live_presence($1,$2,true)', [0, 51.5]);
await as(guest);
assert.equal((await db.query('select user_id from geo.live_presence')).rows.length, 1);
assert.equal((await db.query('select user_id from geo.live_presence')).rows[0].user_id, guest);
assert.equal((await db.query('select * from account.details where user_id=$1', [host])).rows.length, 0);
await as(host);
assert.deepEqual(
  (await db.query('select user_id from filter_local_online_ids(5000) order by user_id')).rows.map((row) => row.user_id),
  [guest],
);
await db.exec('reset role');
await fails("insert into outing_notifications(user_id,outing_id,message) values($1,$2,'live ping: nearby')", /live_ping|check/, [host, outing]);
assert.equal(
  (await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='geo'")).rows.length,
  0,
);
await as(host);
assert.ok((await db.query('select username from account.details where user_id=$1', [host])).rows[0].username);
console.log('Passed three-box isolation, spatial-first local online filter, owner-only geo RLS, no live-ping disk writes and Realtime exclusion.');
// Account deletion must not resurrect a repair projection during cascading deletes.
await db.exec('reset role');
await db.query("insert into profile_answers(user_id,onboarding,deep_profile) values($1,'{}',$2)",[observers[4],{repairFirst:'Ask how they saw it',repairNeed:'A clear apology'}]);
assert.equal((await db.query('select * from trait_repair where user_id=$1',[observers[4]])).rows.length,1);
await db.query('delete from profiles where id=$1',[observers[4]]);
assert.equal((await db.query('select * from trait_repair where user_id=$1',[observers[4]])).rows.length,0);
console.log('Passed 8a question validation, source withdrawal, RLS, peer threshold release, immediate withdrawal suppression, private storage, atomic cache leases and migration repeatability.');
await db.close();
