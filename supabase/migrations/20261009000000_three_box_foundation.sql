begin;
-- Three isolated boxes: account (stable identity), behavior (0–100 matrix),
-- geo (live presence). Matching must filter spatially before scoring.
-- Live pings are Realtime broadcasts, not disk rows.

create schema if not exists account;
create schema if not exists behavior;
create schema if not exists geo;

grant usage on schema account to authenticated, service_role;
grant usage on schema behavior to authenticated, service_role;
grant usage on schema geo to authenticated, service_role;
revoke all on schema account from anon, public;
revoke all on schema behavior from anon, public;
revoke all on schema geo from anon, public;

do $postgis$
begin
  execute 'create extension if not exists postgis';
exception
  when others then null;
end
$postgis$;

-- Box 1: rarely changing account details. Phone never lives on public.profiles.
create table if not exists account.details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  username text not null,
  avatar_url text,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  updated_at timestamptz not null default now()
);

-- Box 2: cheap integer traits for matching. Not a public profile surface.
create table if not exists behavior.matrix (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  social_energy smallint check (social_energy between 0 and 100),
  spontaneity smallint check (spontaneity between 0 and 100),
  openness smallint check (openness between 0 and 100),
  conscientiousness smallint check (conscientiousness between 0 and 100),
  agreeableness smallint check (agreeableness between 0 and 100),
  emotional_stability smallint check (emotional_stability between 0 and 100),
  intensity smallint check (intensity between 0 and 100),
  updated_at timestamptz not null default now()
);

-- Box 3: live coordinates. Clients may write only their own row.
create table if not exists geo.live_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  longitude double precision check (longitude between -180 and 180),
  latitude double precision check (latitude between -90 and 90),
  is_online boolean not null default false,
  updated_at timestamptz not null default now(),
  check ((longitude is null) = (latitude is null))
);

create index if not exists live_presence_online_idx
  on geo.live_presence (is_online) where is_online;

alter table account.details enable row level security;
alter table behavior.matrix enable row level security;
alter table geo.live_presence enable row level security;

drop policy if exists account_details_own on account.details;
create policy account_details_own on account.details
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists behavior_matrix_own on behavior.matrix;
create policy behavior_matrix_own on behavior.matrix
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists live_presence_own on geo.live_presence;
create policy live_presence_own on geo.live_presence
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on account.details to authenticated;
grant select, insert, update, delete on behavior.matrix to authenticated;
grant select, insert, update, delete on geo.live_presence to authenticated;
grant all on account.details, behavior.matrix, geo.live_presence to service_role;

create or replace function account.sync_from_profile()
returns trigger language plpgsql security definer set search_path = account, public, pg_temp as $$
begin
  insert into account.details(user_id, username, avatar_url)
  values (new.id, new.handle, new.avatar_url)
  on conflict (user_id) do update
    set username = excluded.username,
        avatar_url = excluded.avatar_url,
        updated_at = now();
  return new;
end $$;

drop trigger if exists account_sync_from_profile on public.profiles;
create trigger account_sync_from_profile
after insert or update of handle, avatar_url on public.profiles
for each row execute function account.sync_from_profile();

create or replace function behavior.unit_to_score(value numeric)
returns smallint language sql immutable as $$
  select case when value is null then null else round(value * 100)::smallint end;
$$;

create or replace function behavior.sync_from_traits()
returns trigger language plpgsql security definer set search_path = behavior, public, pg_temp as $$
declare
  personality public.trait_personality%rowtype;
  experience public.trait_experience%rowtype;
  actor uuid := coalesce(new.user_id, old.user_id);
begin
  select * into personality from public.trait_personality where user_id = actor;
  select * into experience from public.trait_experience where user_id = actor;
  insert into behavior.matrix(
    user_id, social_energy, spontaneity, openness, conscientiousness,
    agreeableness, emotional_stability, intensity
  ) values (
    actor,
    behavior.unit_to_score(personality.extraversion),
    behavior.unit_to_score(coalesce(experience.novelty, personality.novelty_seeking)),
    behavior.unit_to_score(personality.openness),
    behavior.unit_to_score(personality.conscientiousness),
    behavior.unit_to_score(personality.agreeableness),
    behavior.unit_to_score(personality.emotional_stability),
    behavior.unit_to_score(personality.intensity_easygoing)
  )
  on conflict (user_id) do update set
    social_energy = excluded.social_energy,
    spontaneity = excluded.spontaneity,
    openness = excluded.openness,
    conscientiousness = excluded.conscientiousness,
    agreeableness = excluded.agreeableness,
    emotional_stability = excluded.emotional_stability,
    intensity = excluded.intensity,
    updated_at = now();
  return coalesce(new, old);
end $$;

drop trigger if exists behavior_sync_personality on public.trait_personality;
create trigger behavior_sync_personality
after insert or update or delete on public.trait_personality
for each row execute function behavior.sync_from_traits();

drop trigger if exists behavior_sync_experience on public.trait_experience;
create trigger behavior_sync_experience
after insert or update or delete on public.trait_experience
for each row execute function behavior.sync_from_traits();

create or replace function geo.distance_meters(
  lng1 double precision, lat1 double precision,
  lng2 double precision, lat2 double precision
) returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- IDs only. Never return coordinates. auth.uid() is the only allowed viewer.
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
    and latitude is not null;
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
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = actor and b.blocked_id = p.user_id)
         or (b.blocker_id = p.user_id and b.blocked_id = actor)
    )
    and geo.distance_meters(origin_lng, origin_lat, p.longitude, p.latitude) <= p_radius_meters
  order by geo.distance_meters(origin_lng, origin_lat, p.longitude, p.latitude)
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

create or replace function public.upsert_live_presence(
  p_longitude double precision,
  p_latitude double precision,
  p_is_online boolean default true
) returns void
language plpgsql
security definer
set search_path = geo, public, pg_temp as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Not authenticated';
  end if;
  if p_is_online and (p_longitude is null or p_latitude is null) then
    raise exception 'Online presence requires coordinates';
  end if;
  insert into geo.live_presence(user_id, longitude, latitude, is_online, updated_at)
  values (actor, p_longitude, p_latitude, coalesce(p_is_online, false), now())
  on conflict (user_id) do update set
    longitude = excluded.longitude,
    latitude = excluded.latitude,
    is_online = excluded.is_online,
    updated_at = now();
end $$;

create or replace function behavior.compatibility_score(a uuid, b uuid)
returns numeric
language sql
stable
security definer
set search_path = behavior, pg_temp as $$
  select case
    when x.user_id is null or y.user_id is null then null
    else 1 - (
      (
        coalesce(abs(x.social_energy - y.social_energy), 0) +
        coalesce(abs(x.spontaneity - y.spontaneity), 0) +
        coalesce(abs(x.openness - y.openness), 0) +
        coalesce(abs(x.conscientiousness - y.conscientiousness), 0) +
        coalesce(abs(x.agreeableness - y.agreeableness), 0) +
        coalesce(abs(x.emotional_stability - y.emotional_stability), 0) +
        coalesce(abs(x.intensity - y.intensity), 0)
      )::numeric / 700
    )
  end
  from behavior.matrix x
  join behavior.matrix y on true
  where x.user_id = a and y.user_id = b;
$$;

revoke all on function geo.filter_local_online_ids(integer) from public, anon;
revoke all on function public.filter_local_online_ids(integer) from public, anon;
revoke all on function public.upsert_live_presence(double precision, double precision, boolean) from public, anon;
revoke all on function behavior.compatibility_score(uuid, uuid) from public, anon, authenticated;
grant execute on function public.filter_local_online_ids(integer) to authenticated;
grant execute on function public.upsert_live_presence(double precision, double precision, boolean) to authenticated;
grant execute on function geo.filter_local_online_ids(integer) to authenticated;
grant execute on function geo.distance_meters(double precision, double precision, double precision, double precision) to authenticated;

-- Durable outing notices stay on disk. Ephemeral live pings must not.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.outing_notifications'::regclass
      and conname = 'outing_notifications_not_live_ping'
  ) then
    alter table public.outing_notifications
      add constraint outing_notifications_not_live_ping
      check (message is null or message not ilike 'live ping:%');
  end if;
end $$;

-- Live coordinates must never join the Realtime publication.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'geo'
  ) then
    raise exception 'geo tables must not be in supabase_realtime';
  end if;
end $$;

insert into account.details(user_id, username, avatar_url)
select id, handle, avatar_url from public.profiles
on conflict (user_id) do nothing;

insert into behavior.matrix(
  user_id, social_energy, spontaneity, openness, conscientiousness,
  agreeableness, emotional_stability, intensity
)
select
  p.id,
  behavior.unit_to_score(tp.extraversion),
  behavior.unit_to_score(coalesce(te.novelty, tp.novelty_seeking)),
  behavior.unit_to_score(tp.openness),
  behavior.unit_to_score(tp.conscientiousness),
  behavior.unit_to_score(tp.agreeableness),
  behavior.unit_to_score(tp.emotional_stability),
  behavior.unit_to_score(tp.intensity_easygoing)
from public.profiles p
left join public.trait_personality tp on tp.user_id = p.id
left join public.trait_experience te on te.user_id = p.id
on conflict (user_id) do nothing;
commit;
