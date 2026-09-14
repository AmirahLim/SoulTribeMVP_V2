-- Six legacy profiles still hold their whole photo inline in profiles.avatar_url,
-- and the account.details trigger copies those bytes again. The photos belong in
-- the private avatars bucket, but a bucket object cannot be written from SQL: the
-- bytes live behind the Storage API, and inserting into storage.objects would only
-- record an object that does not exist. A script performs the upload and records
-- the outcome here.
--
-- This table holds the original inline photo verbatim. It is the audit trail and,
-- until it is dropped after a retention window, the only rollback source. It is
-- therefore member photograph data and never readable by a member session.
begin;

create table if not exists public.avatar_backfill (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  original_avatar_url text not null,
  declared_mime text not null,
  decoded_bytes integer not null check (decoded_bytes > 0),
  decoded_sha256 text not null check (decoded_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null,
  state text not null default 'pending' check (state in (
    'pending','verified','switched','decode_failed','mime_unsupported','too_large','target_conflict'
  )),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists avatar_backfill_state_idx on public.avatar_backfill(state);

-- Service role only. No policy is defined, so row level security denies every
-- authenticated and anonymous read even where default privileges granted them.
alter table public.avatar_backfill enable row level security;
revoke all on public.avatar_backfill from anon, authenticated;
grant all on public.avatar_backfill to service_role;

create or replace function public.touch_avatar_backfill()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists avatar_backfill_touch on public.avatar_backfill;
create trigger avatar_backfill_touch before update on public.avatar_backfill
for each row execute function public.touch_avatar_backfill();

commit;
