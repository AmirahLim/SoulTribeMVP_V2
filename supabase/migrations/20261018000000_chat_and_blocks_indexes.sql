-- outing_messages had only outing_messages_pkey on id. Chat is not a lookup by id.
-- The only read is OutingContext: outing_id equality, created_at descending, limit 50.
--
-- blocks_pkey is (blocker_id, blocked_id). That serves the leading column and the
-- equality pair in geo.filter_local_online_ids / filter_local_area_ids:
--   (blocker_id = actor and blocked_id = candidate)
--   or (blocker_id = candidate and blocked_id = actor)
-- The matches and bond routes instead load every row involving the viewer:
--   blocker_id = uid or blocked_id = uid
-- The trailing column of the primary key does not serve blocked_id = uid, so
-- blocked_id gets its own index.
--
-- reports has only reports_pkey on id. The same .or() shape runs on reporter_id
-- and reported_id from matches and bond. Those indexes are recommended, not
-- added here: with today's row counts the planner still sequential-scans reports
-- after creating them, so they would cost writes and buy nothing.
begin;

create index if not exists outing_messages_outing_id_created_at_idx
  on public.outing_messages (outing_id, created_at desc);

create index if not exists blocks_blocked_id_idx
  on public.blocks (blocked_id);

commit;
