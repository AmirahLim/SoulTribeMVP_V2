begin;
-- candidatePoolSize only flips availability and geography gates below 15.
-- That is two outcomes per pair per activity, not a continuous score input.
-- Key the directed cache on that boolean so a small-pool row cannot be
-- served once the pool is large enough for those gates to run.

alter table public.match_scores
  add column if not exists small_pool boolean not null default false;

alter table public.match_scores drop constraint if exists match_scores_pkey;
alter table public.match_scores add primary key (user_a, activity_key, user_b, small_pool);

commit;
