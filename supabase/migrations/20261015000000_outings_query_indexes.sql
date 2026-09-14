-- public.outings had no index beyond outings_pkey, so every query that is not a
-- lookup by id reads the whole table, and so does every RLS predicate evaluated
-- on top of it.
--
-- What actually filters and orders this table:
--   host_id equality   fetchUserPitches, the host pitch query in outingsStore,
--                      the host pitch list on a member's profile page, and the
--                      outings_update and outings_delete policies.
--   state equality/IN  fetchRadarOutings (state='open'), the outings_public_read
--                      policy, and the third branch of outings_select.
--   starts_at order    the host pitch list on a member's profile page, which is
--                      host_id = ? and state in (...) order by starts_at limit 6.
--   id equality        every remaining read, update and delete, already served
--                      by outings_pkey.
-- visibility appears only inside an OR branch of outings_select alongside state,
-- never on its own, so it does not earn an index. is_member_of(id) is already
-- served by outing_members_pkey on (outing_id, user_id).
begin;

-- Leading equality on host_id, then starts_at in the order the profile page asks
-- for, so that query gets its filter, its sort and its limit from one index.
create index if not exists outings_host_id_starts_at_idx
  on public.outings (host_id, starts_at);

-- Partial, because state is low cardinality and today every row is 'open': a
-- plain index on state would be ignored, correctly. Restricting it to the states
-- the app actually asks for keeps it small and selective as completed and
-- cancelled outings accumulate, which is when it starts to matter. state leads so
-- the equality is an index condition rather than a recheck against the heap.
create index if not exists outings_live_state_starts_at_idx
  on public.outings (state, starts_at)
  where state in ('open', 'confirmed');

commit;
