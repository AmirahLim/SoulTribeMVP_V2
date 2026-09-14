-- A row that failed to decode has no byte count, no hash and no target path. The
-- first ledger migration required all three, which would have forced the script to
-- invent them. An audit trail must not contain fabricated hashes, so the columns
-- become optional and are instead required for the states that claim a stored
-- object. Existing rows satisfy this: verified and switched rows already hold them.
begin;

alter table public.avatar_backfill alter column decoded_bytes drop not null;
alter table public.avatar_backfill alter column decoded_sha256 drop not null;
alter table public.avatar_backfill alter column storage_path drop not null;

alter table public.avatar_backfill drop constraint if exists avatar_backfill_stored_states_measured;
alter table public.avatar_backfill add constraint avatar_backfill_stored_states_measured check (
  state not in ('verified','switched')
  or (decoded_bytes is not null and decoded_sha256 is not null and storage_path is not null)
);

commit;
