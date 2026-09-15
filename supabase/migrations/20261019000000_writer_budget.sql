-- Writer spend is a service-role ledger. Caps live in the table so they can
-- change without a deploy. Reserve holds a worst-case estimate (1 input byte =
-- 1 token, plus max_output_tokens) until settle or a 2-minute reclaim.
--
-- Same privacy shape as avatar_backfill: RLS on, no policies, member roles
-- revoked. Remaining budget is never returned to a client.
begin;

create table if not exists public.writer_model_rates (
  version text primary key,
  model text not null,
  input_usd_micros_per_million integer not null check (input_usd_micros_per_million >= 0),
  output_usd_micros_per_million integer not null check (output_usd_micros_per_million >= 0),
  effective_at timestamptz not null default now()
);

create table if not exists public.writer_budget_limits (
  id boolean primary key default true check (id),
  global_period text not null check (global_period = 'calendar_month_utc'),
  global_cap_usd_micros bigint not null check (global_cap_usd_micros >= 0),
  member_window interval not null,
  member_cap_usd_micros bigint not null check (member_cap_usd_micros >= 0)
);

create table if not exists public.writer_reservations (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  model text not null,
  rate_version text not null references public.writer_model_rates(version),
  input_usd_micros_per_million integer not null check (input_usd_micros_per_million >= 0),
  output_usd_micros_per_million integer not null check (output_usd_micros_per_million >= 0),
  reserved_usd_micros bigint not null check (reserved_usd_micros >= 0),
  input_tokens integer,
  output_tokens integer,
  settled_usd_micros bigint,
  status text not null check (status in ('reserved', 'settled', 'reclaimed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  settled_at timestamptz,
  check (
    (status = 'reserved'
      and input_tokens is null
      and output_tokens is null
      and settled_usd_micros is null
      and settled_at is null)
    or (status = 'settled'
      and input_tokens is not null and input_tokens >= 0
      and output_tokens is not null and output_tokens >= 0
      and settled_usd_micros is not null and settled_usd_micros >= 0
      and settled_at is not null)
    or (status = 'reclaimed'
      and settled_usd_micros is null)
  )
);

create index if not exists writer_reservations_period_idx
  on public.writer_reservations (created_at)
  where status in ('reserved', 'settled');

create index if not exists writer_reservations_viewer_period_idx
  on public.writer_reservations (viewer_id, created_at)
  where status in ('reserved', 'settled');

-- Starting gpt-4o-mini list price, copied onto each reservation at reserve time.
insert into public.writer_model_rates (
  version, model, input_usd_micros_per_million, output_usd_micros_per_million, effective_at
) values (
  'openai/gpt-4o-mini/2026-09-15', 'gpt-4o-mini', 150000, 600000, timestamptz '2026-09-15'
) on conflict (version) do nothing;

insert into public.writer_budget_limits (
  id, global_period, global_cap_usd_micros, member_window, member_cap_usd_micros
) values (
  true, 'calendar_month_utc', 25000000, interval '24 hours', 1000000
) on conflict (id) do nothing;

alter table public.writer_model_rates enable row level security;
alter table public.writer_budget_limits enable row level security;
alter table public.writer_reservations enable row level security;
revoke all on public.writer_model_rates from anon, authenticated;
revoke all on public.writer_budget_limits from anon, authenticated;
revoke all on public.writer_reservations from anon, authenticated;
grant all on public.writer_model_rates, public.writer_budget_limits, public.writer_reservations
  to service_role;

create or replace function public.reserve_writer_budget(
  p_viewer uuid,
  p_model text,
  p_input_bytes integer,
  p_max_output_tokens integer
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limits public.writer_budget_limits%rowtype;
  v_rate public.writer_model_rates%rowtype;
  v_reserved bigint;
  v_global bigint;
  v_member bigint;
  v_id uuid;
begin
  if p_viewer is null or p_model is null or btrim(p_model) = ''
     or p_input_bytes is null or p_input_bytes < 0
     or p_max_output_tokens is null or p_max_output_tokens < 0 then
    return null;
  end if;
  perform pg_advisory_xact_lock(871991);
  update public.writer_reservations
     set status = 'reclaimed'
   where status = 'reserved' and expires_at <= now();
  select * into v_limits from public.writer_budget_limits where id;
  if not found then
    return null;
  end if;
  select * into v_rate
    from public.writer_model_rates
   where model = p_model
   order by effective_at desc
   limit 1;
  if not found then
    return null;
  end if;
  v_reserved := ceil(p_input_bytes::numeric * v_rate.input_usd_micros_per_million / 1000000)
              + ceil(p_max_output_tokens::numeric * v_rate.output_usd_micros_per_million / 1000000);
  select coalesce(sum(case
           when status = 'settled' then settled_usd_micros
           else reserved_usd_micros
         end), 0)
    into v_global
    from public.writer_reservations
   where status in ('reserved', 'settled')
     and created_at >= date_trunc('month', timezone('utc', now()));
  if v_global + v_reserved > v_limits.global_cap_usd_micros then
    return null;
  end if;
  select coalesce(sum(case
           when status = 'settled' then settled_usd_micros
           else reserved_usd_micros
         end), 0)
    into v_member
    from public.writer_reservations
   where viewer_id = p_viewer
     and status in ('reserved', 'settled')
     and created_at > now() - v_limits.member_window;
  if v_member + v_reserved > v_limits.member_cap_usd_micros then
    return null;
  end if;
  insert into public.writer_reservations (
    viewer_id, model, rate_version,
    input_usd_micros_per_million, output_usd_micros_per_million,
    reserved_usd_micros, status, expires_at
  ) values (
    p_viewer, p_model, v_rate.version,
    v_rate.input_usd_micros_per_million, v_rate.output_usd_micros_per_million,
    v_reserved, 'reserved', now() + interval '2 minutes'
  ) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.settle_writer_budget(
  p_reservation uuid,
  p_input_tokens integer,
  p_output_tokens integer
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.writer_reservations%rowtype;
  v_cost bigint;
begin
  if p_reservation is null
     or p_input_tokens is null or p_input_tokens < 0
     or p_output_tokens is null or p_output_tokens < 0 then
    raise exception 'Writer settle requires non-negative integer token counts';
  end if;
  perform pg_advisory_xact_lock(871991);
  select * into v_row from public.writer_reservations where id = p_reservation for update;
  if not found or v_row.status <> 'reserved' then
    return;
  end if;
  v_cost := ceil(p_input_tokens::numeric * v_row.input_usd_micros_per_million / 1000000)
          + ceil(p_output_tokens::numeric * v_row.output_usd_micros_per_million / 1000000);
  update public.writer_reservations
     set input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         settled_usd_micros = v_cost,
         status = 'settled',
         settled_at = now()
   where id = p_reservation;
end
$$;

revoke all on function public.reserve_writer_budget(uuid, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.settle_writer_budget(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_writer_budget(uuid, text, integer, integer) to service_role;
grant execute on function public.settle_writer_budget(uuid, integer, integer) to service_role;

commit;
