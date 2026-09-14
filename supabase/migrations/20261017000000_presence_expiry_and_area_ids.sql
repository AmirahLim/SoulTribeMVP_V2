begin;
-- Currently present means a live point written in the last 15 minutes. There is
-- no heartbeat writer: expiry is evaluated here on read so a stale is_online flag
-- cannot keep someone in the matching pool.
--
-- Members who deny geolocation stay matchable through the same home_area label.
-- That pool is IDs only. It does not invent coordinates or write centroids into
-- geo.live_presence, which remains live GPS.

create index if not exists live_presence_online_fresh_idx
  on geo.live_presence (updated_at)
  where is_online and longitude is not null and latitude is not null;

create index if not exists profiles_home_area_active_idx
  on public.profiles (home_area)
  where status = 'active';

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
    and geo.distance_meters(origin_lng, origin_lat, p.longitude, p.latitude) <= p_radius_meters
  order by geo.distance_meters(origin_lng, origin_lat, p.longitude, p.latitude)
  limit 200;
end $$;

-- Same-label neighbours for a viewer without a fresh live point, and for
-- candidates who have a home_area but no GPS. Never returns coordinates.
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
  order by p.created_at desc
  limit 200;
end $$;

create or replace function public.filter_local_online_ids(p_radius_meters integer default 5000)
returns table(user_id uuid)
language sql
stable
security definer
set search_path = geo, public, pg_temp as $$
  select geo.filter_local_online_ids(p_radius_meters);
$$;

create or replace function public.filter_local_area_ids()
returns table(user_id uuid)
language sql
stable
security definer
set search_path = geo, public, pg_temp as $$
  select geo.filter_local_area_ids();
$$;

revoke all on function geo.filter_local_area_ids() from public, anon;
revoke all on function public.filter_local_area_ids() from public, anon;
grant execute on function public.filter_local_area_ids() to authenticated;
grant execute on function geo.filter_local_area_ids() to authenticated;

commit;
