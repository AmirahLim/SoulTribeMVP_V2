begin;
-- Merge onboarding and Tribal Pass JSON so a partial save cannot erase
-- previously stored answers. Empty strings still withdraw a key that is present
-- in the patch; omitted keys are kept. Matching-only travelKm stays in onboarding JSON.
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
  onboarding=case when p_answers ? 'onboarding' then public.package_onboarding_answers(coalesce(onboarding,'{}'::jsonb) || (p_answers->'onboarding')) else onboarding end,
  deep_profile=case when p_answers ? 'deep_profile' then coalesce(deep_profile,'{}'::jsonb) || coalesce(p_answers->'deep_profile','{}'::jsonb) else deep_profile end,
  completed_categories=case when p_answers ? 'completed_categories' then (
    select coalesce(array_agg(distinct cat order by cat),'{}'::integer[])
    from unnest(
      coalesce(completed_categories,'{}'::integer[])
      || coalesce(array(select jsonb_array_elements_text(p_answers->'completed_categories')::integer),'{}'::integer[])
    ) cat
  ) else completed_categories end,
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

notify pgrst,'reload schema';
commit;
