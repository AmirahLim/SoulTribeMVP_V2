begin;
create or replace function public.package_onboarding_answers(raw jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  nested jsonb := '{}'::jsonb;
  baseline jsonb := '{}'::jsonb;
  group_choices jsonb;
begin
  if raw is null or jsonb_typeof(raw) is distinct from 'object' then
    return raw;
  end if;
  if jsonb_typeof(raw->'baselineV2') = 'object' then
    nested := raw->'baselineV2';
  end if;
  baseline := nested;
  if not (baseline ? 'intent') and (raw ? 'intent' or raw ? 'q1Finding') then
    baseline := baseline || jsonb_build_object('intent', coalesce(raw->'intent', raw->'q1Finding'));
  end if;
  if not (baseline ? 'clicks') and (raw ? 'clicks' or raw ? 'q2Feelings') then
    baseline := baseline || jsonb_build_object('clicks', coalesce(raw->'clicks', raw->'q2Feelings'));
  end if;
  if not (baseline ? 'groupChoices') then
    group_choices := coalesce(raw->'groupChoices', baseline->'groupChoices');
    if group_choices is null and jsonb_typeof(coalesce(raw->'group', raw->'q3GroupSize')) = 'string' and btrim(coalesce(raw->>'group', raw->>'q3GroupSize', '')) <> '' then
      group_choices := jsonb_build_array(coalesce(raw->>'group', raw->>'q3GroupSize'));
    end if;
    if group_choices is not null then
      baseline := baseline || jsonb_build_object('groupChoices', group_choices);
    end if;
  end if;
  if not (baseline ? 'desiredQualities') and (raw ? 'desiredQualities' or raw ? 'q8Qualities') then
    baseline := baseline || jsonb_build_object('desiredQualities', coalesce(raw->'desiredQualities', raw->'q8Qualities'));
  end if;
  if not (baseline ? 'connectionChoice') and raw ? 'connectionChoice' then
    baseline := baseline || jsonb_build_object('connectionChoice', raw->'connectionChoice');
  end if;
  if not (baseline ? 'planningChoice') and (raw ? 'planningChoice' or raw ? 'q5PlanningRhythm') then
    baseline := baseline || jsonb_build_object('planningChoice', coalesce(raw->'planningChoice', raw->'q5PlanningRhythm'));
  end if;
  if not (baseline ? 'outings') and (raw ? 'outings' or raw ? 'q6Outings') then
    baseline := baseline || jsonb_build_object('outings', coalesce(raw->'outings', raw->'q6Outings'));
  end if;
  if not (baseline ? 'travelKm') and raw ? 'travelKm' then
    baseline := baseline || jsonb_build_object('travelKm', raw->'travelKm');
  end if;
  if not (baseline ? 'lifeContexts') and raw ? 'lifeContexts' then
    baseline := baseline || jsonb_build_object('lifeContexts', raw->'lifeContexts');
  end if;
  return raw || jsonb_build_object(
    'baselineV2', baseline,
    'q1Finding', coalesce(raw->'q1Finding', baseline->'intent'),
    'q2Feelings', coalesce(raw->'q2Feelings', baseline->'clicks'),
    'q5PlanningRhythm', coalesce(raw->'q5PlanningRhythm', baseline->'planningChoice'),
    'q6Outings', coalesce(raw->'q6Outings', baseline->'outings'),
    'q8Qualities', coalesce(raw->'q8Qualities', baseline->'desiredQualities'),
    'connectionChoice', coalesce(raw->'connectionChoice', baseline->'connectionChoice'),
    'planningChoice', coalesce(raw->'planningChoice', baseline->'planningChoice'),
    'travelKm', coalesce(raw->'travelKm', baseline->'travelKm')
  );
end;
$$;
revoke all on function public.package_onboarding_answers(jsonb) from public;
grant execute on function public.package_onboarding_answers(jsonb) to authenticated;

create or replace function public.save_profile_bundle(p_profile jsonb, p_answers jsonb, p_traits jsonb, p_interests integer[] default null)
returns void language plpgsql security invoker set search_path=public as $$
declare t text; patch jsonb; col text; columns_sql text; actor uuid:=auth.uid(); answered_count integer;
begin
 if actor is null then raise exception 'Authentication required'; end if;
 if p_profile is not null then
  insert into profiles(id,handle,display_name,home_area,birth_year,avatar_url,bio)
  values(actor,p_profile->>'handle',p_profile->>'display_name',p_profile->>'home_area',(p_profile->>'birth_year')::int,p_profile->>'avatar_url',p_profile->>'bio')
  on conflict(id) do update set handle=excluded.handle,display_name=excluded.display_name,home_area=excluded.home_area,birth_year=excluded.birth_year,avatar_url=excluded.avatar_url,bio=excluded.bio;
 end if;
 perform 1 from profiles where id=actor for update;
 if not found then raise exception 'Profile required'; end if;
 insert into profile_answers(user_id) values(actor) on conflict do nothing;
 update profile_answers set
  onboarding=case when p_answers ? 'onboarding' then public.package_onboarding_answers(p_answers->'onboarding') else onboarding end,
  deep_profile=case when p_answers ? 'deep_profile' then p_answers->'deep_profile' else deep_profile end,
  completed_categories=case when p_answers ? 'completed_categories' then array(select jsonb_array_elements_text(p_answers->'completed_categories')::integer) else completed_categories end,
  updated_at=now() where user_id=actor;
 for t,patch in select * from jsonb_each(p_traits) loop
  if t not in ('trait_personality','trait_communication','trait_social_rhythm','trait_intent','trait_emotional','trait_experience','trait_geography','trait_lifestyle') then raise exception 'Unsupported trait table'; end if;
  if t='trait_geography' then
   insert into trait_geography(user_id,home_area) select actor,home_area from profiles where id=actor on conflict do nothing;
  else
   execute format('insert into %I(user_id) values($1) on conflict do nothing',t) using actor;
  end if;
  columns_sql:='';
  for col in select jsonb_object_keys(patch) loop
   if col in ('user_id','answered','updated_at') or not exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name=col) then raise exception 'Unsupported trait field'; end if;
   columns_sql:=columns_sql || case when columns_sql='' then '' else ',' end || format('%I = x.%I',col,col);
  end loop;
  if columns_sql<>'' then
   execute format('update %I set %s,updated_at=now() from jsonb_populate_record(null::%I,$1) x where %I.user_id=$2',t,columns_sql,t,t) using patch,actor;
  end if;
  execute format('select count(*) from %I r, jsonb_each(to_jsonb(r)) j where r.user_id=$1 and j.key not in (''user_id'',''answered'',''updated_at'',''depth'',''open_to_hosting'',''fri_night'',''sat_night'') and j.value not in (''null''::jsonb,''[]''::jsonb,''{}''::jsonb)',t) into answered_count using actor;
  execute format('update %I set answered=$1 where user_id=$2',t) using answered_count,actor;
 end loop;
 if p_interests is not null then
  delete from user_interests where user_id=actor;
  insert into user_interests(user_id,node_id,affinity) select actor,id,'curious' from interest_nodes where id=any(p_interests) and approved=true;
 end if;
 update profiles set profile_version=profile_version+1 where id=actor;
end $$;

create or replace function public.claim_onboarding_draft(p_token text,p_display_name text,p_birth_year integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d onboarding_drafts; p jsonb; actor uuid:=auth.uid(); existing profiles;
 old_answers jsonb; contact_styles text[]; interest_ids integer[]; identity_patch jsonb; trait_patch jsonb; outing_settings text[];
begin
 if actor is null then raise exception 'Authentication required'; end if;
 perform 1 from auth.users where id=actor for update;
 select * into d from onboarding_drafts where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found or d.expires_at<=now() then raise exception 'Draft expired'; end if;
 if d.owner_id is not null and d.owner_id<>actor then raise exception 'Draft belongs to another account'; end if;
 if d.claimed_by=actor then return d.payload; end if;
 if d.claimed_by is not null then raise exception 'Draft already saved'; end if;
 if not(d.payload ? 'setupRevision') then
  return claim_onboarding_draft_before_handoff(p_token,p_display_name,p_birth_year);
 end if;
 if not coalesce(validate_baseline_draft(d.payload,true),false) then raise exception 'Complete your onboarding questions and profile details'; end if;
 p:=d.payload;
 select * into existing from profiles where id=actor for update;
 select onboarding into old_answers from profile_answers where user_id=actor;
 if existing.id is not null then
  if existing.status<>'active' then raise exception 'Profile cannot be updated'; end if;
  if old_answers ? 'baselineV2' and (d.owner_id is distinct from actor or d.base_profile_version is distinct from existing.profile_version) then
   raise exception 'Your profile changed. Reopen onboarding before saving changes';
  end if;
  p_display_name:=existing.display_name;
  p_birth_year:=coalesce(existing.birth_year,p_birth_year);
  identity_patch:=null;
 else
  identity_patch:=jsonb_build_object('handle',p->>'handle','display_name',btrim(p_display_name),'home_area',p->>'area','birth_year',p_birth_year);
 end if;
 if p_display_name is null or length(btrim(p_display_name)) not between 1 and 80 or p_birth_year is null
  or p_birth_year not between 1930 and extract(year from now())::int-18 then raise exception 'Enter your name and valid adult birth year'; end if;

 select coalesce(array_agg(style),'{}') into contact_styles from (values
 ('We skip the small talk','deep'),('Our humour just lands','banter')) m(label,style) where p->'clicks' ? label;
 select array_agg(id) into interest_ids from (values
 ('Specialty Coffee',101),('Food Hunts',104),('Gallery Hopping',106),('Pottery & Making',113),('Vinyl & Listening Bars',116),('Indie Gigs',107),('Indie Cinema',115),('Bookshops & Ideas',105),('Analog Photo Walks',117),('Nature & Trails',109),('Games Nights',111),('Neighbourhood Wanders',118)) m(label,id) where p->'outings' ? label;
 select coalesce(array_agg(value),'{}') into outing_settings from jsonb_array_elements_text(coalesce(p->'outings','[]'::jsonb)) value where value <> 'Other';
 trait_patch:=jsonb_build_object(
  'trait_intent',jsonb_build_object('intents',(p->'intent')-'Other'),
  'trait_communication',jsonb_build_object('conv_styles',contact_styles,'contact_frequency_expect',(p->>'contact')::numeric),
  'trait_social_rhythm',jsonb_build_object('planning_horizon',(p->>'planning')::numeric),
  'trait_experience',jsonb_build_object('settings',outing_settings,'group_size_pref',case when jsonb_array_length(coalesce(p->'groupChoices','[]'::jsonb))>1 then null else case p->>'group' when '1:1' then 0 when 'Small circle' then .333 when 'Social mix' then .667 else 1 end end),
  'trait_geography',jsonb_build_object('home_area',p->>'area','country',p->>'country','radius_km',(p->>'travelKm')::integer,'radius_minutes','{}'::jsonb));
 if existing.id is null or p->>'opening' is not null then
  trait_patch:=trait_patch||jsonb_build_object('trait_emotional',jsonb_build_object('er_opening_pace',(p->>'opening')::numeric));
 end if;
 if existing.id is not null then
  update profiles set home_area=p->>'area',birth_year=p_birth_year where id=actor;
 end if;
 perform save_profile_bundle(identity_patch,
  jsonb_build_object('onboarding',coalesce(old_answers,'{}'::jsonb)||jsonb_build_object(
   'baselineV2',p,'displayName',btrim(p_display_name),'handle',coalesce(existing.handle,p->>'handle'),'homeArea',p->>'area','birthYear',p_birth_year,
   'q1Finding',p->'intent','q2Feelings',p->'clicks','q3GroupSize',case when jsonb_array_length(coalesce(p->'groupChoices','[]'::jsonb))>1 then null else p->>'group' end,
   'q5PlanningRhythm',p->'planningChoice','q6Outings',p->'outings','q8Qualities',p->'desiredQualities',
   'connectionChoice',p->'connectionChoice','planningChoice',p->'planningChoice','travelKm',p->'travelKm','lifeContexts',p->'lifeContexts')),
  trait_patch,null);
 if p->>'flowVersion'='3' then
  insert into user_interests(user_id,node_id,affinity) select actor,id,'curious' from interest_nodes where approved and p->'outings' ? name and name<>'Other' on conflict do nothing;
 end if;
 insert into user_interests(user_id,node_id,affinity) select actor,id,'curious' from interest_nodes where id=any(interest_ids) and approved on conflict do nothing;
 update onboarding_drafts set owner_id=actor,claimed_by=actor,claimed_at=now() where token_hash=d.token_hash;
 insert into onboarding_funnel_events(event_type,step) values('profile_claimed',case when p->>'flowVersion'='3' then 7 else 6 end);
 return p;
end $$;

notify pgrst,'reload schema';
commit;
