begin;
-- match_scores stored one unordered pair (user_a < user_b). The engine is
-- directional: score(A,B) is not score(B,A). The cache key is therefore the
-- viewer, the subject, and the outing category the weights were taken from.
-- Matching-only numbers stay service-role; members cannot read another
-- person's directed score.

alter table public.match_scores add column if not exists activity_key text not null default '';
alter table public.match_scores add column if not exists scoring_version text not null default '';
alter table public.match_scores alter column resonance drop not null;
alter table public.match_scores alter column logistics drop not null;

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.match_scores'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%user_a%<%user_b%'
  loop
    execute format('alter table public.match_scores drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.match_scores drop constraint if exists match_scores_pkey;
alter table public.match_scores add primary key (user_a, activity_key, user_b);

drop policy if exists match_scores_read on public.match_scores;
revoke all on public.match_scores from anon, authenticated;
grant select, insert, update, delete on public.match_scores to service_role;

create or replace function public.invalidate_profile_explanations()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 delete from match_explanations where user_a=NEW.id or user_b=NEW.id;
 delete from match_scores where user_a=NEW.id or user_b=NEW.id;
 return NEW;
end $$;

commit;
