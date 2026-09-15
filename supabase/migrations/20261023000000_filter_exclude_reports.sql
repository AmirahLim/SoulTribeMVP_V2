begin;
-- Matching already treats blocks and reports as one gate (BLOCKED_OR_REPORTED).
-- The spatial and area ID filters excluded only blocks, so a reported member
-- still occupied a slot in the 200-cap and was scored before softGate dropped
-- them. Mirror the existing block not-exists in both directions. Any report
-- row is excluded, matching gates.ts which does not read reports.state.
-- Whether dismissed or actioned reports should stop excluding is a product
-- decision; this migration does not pick it.

create index if not exists reports_reporter_id_reported_id_idx
  on public.reports (reporter_id, reported_id);

create index if not exists reports_reported_id_reporter_id_idx
  on public.reports (reported_id, reporter_id);

create or replace function geo.filter_local_online_ids(p_radius_meters integer default 5000)
returns table(user_id uuid)
language plpgsql
stable
security definer
set search_path = geo, public, pg_temp as $$
declare
  actor uuid := auth.uid();
  origin_lng double precision;
  origin_lat double precision;
begin
  if actor is null then
    raise exception 'Not authenticated';
  end if;
  if p_radius_meters is null or p_radius_meters < 100 or p_radius_meters > 50000 then
    raise exception 'Radius must be between 100 and 50000 meters';
  end if;
  select longitude, latitude into origin_lng, origin_lat
  from geo.live_presence
  where live_presence.user_id = actor
    and is_online
    and longitude is not null
    and latitude is not null
    and updated_at > now() - interval '15 minutes';
  if origin_lng is null then
    return;
  end if;
  return query
  select p.user_id
  from geo.live_presence p
  where p.user_id <> actor
    and p.is_online
    and p.longitude is not null
    and p.latitude is not null
    and p.updated_at > now() - interval '15 minutes'
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = actor and b.blocked_id = p.user_id)
         or (b.blocker_id = p.user_id and b.blocked_id = actor)
    )
    and not exists (
      select 1 from public.reports r
      where (r.reporter_id = actor and r.reported_id = p.user_id)
         or (r.reporter_id = p.user_id and r.reported_id = actor)
    )
    and geo.distance_meters(origin_lng, origin_lat, p.longitude, p.latitude) <= p_radius_meters
  order by geo.distance_meters(origin_lng, origin_lat, p.longitude, p.latitude)
  limit 200;
end $$;

create or replace function geo.filter_local_area_ids()
returns table(user_id uuid)
language plpgsql
stable
security definer
set search_path = geo, public, pg_temp as $$
declare
  actor uuid := auth.uid();
  origin_area text;
begin
  if actor is null then
    raise exception 'Not authenticated';
  end if;
  select btrim(home_area) into origin_area
  from public.profiles
  where id = actor;
  if origin_area is null or origin_area = '' then
    return;
  end if;
  return query
  select p.id
  from public.profiles p
  where p.id <> actor
    and p.status = 'active'
    and btrim(p.home_area) = origin_area
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = actor and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = actor)
    )
    and not exists (
      select 1 from public.reports r
      where (r.reporter_id = actor and r.reported_id = p.id)
         or (r.reporter_id = p.id and r.reported_id = actor)
    )
  order by p.created_at desc
  limit 200;
end $$;

commit;
