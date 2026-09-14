begin;

-- behavior.matrix is derived from trait_personality and trait_experience, and the
-- sync trigger fires on delete as well as insert and update. It rebuilt the derived
-- row unconditionally, which made two things wrong.
--
-- Deleting a profile cascades to the trait rows, fires this trigger, and the rebuild
-- then failed matrix_user_id_fkey because the profile it references was already gone.
-- That aborted the whole delete, so no member could be removed and no erasure request
-- could be honoured:
--
--   ERROR: 23503: insert or update on table "matrix" violates foreign key constraint
--     "matrix_user_id_fkey"
--   DETAIL: Key (user_id)=(...) is not present in table "profiles".
--
-- Separately, deleting the last trait row left a matrix row of nulls behind rather
-- than removing it, so a member with no traits still carried a matching row.
create or replace function behavior.sync_from_traits()
returns trigger language plpgsql security definer set search_path = behavior, public, pg_temp as $$
declare
  personality public.trait_personality%rowtype;
  experience public.trait_experience%rowtype;
  actor uuid := coalesce(new.user_id, old.user_id);
begin
  -- The member is going away and the cascade takes the matrix row with it. Rebuilding
  -- it here would only recreate the row the delete is removing, against a profile that
  -- no longer exists.
  if not exists (select 1 from public.profiles where id = actor) then
    return coalesce(new, old);
  end if;

  select * into personality from public.trait_personality where user_id = actor;
  select * into experience from public.trait_experience where user_id = actor;

  -- No source rows left, so the derived row goes too instead of persisting as nulls.
  if personality.user_id is null and experience.user_id is null then
    delete from behavior.matrix where user_id = actor;
    return coalesce(new, old);
  end if;

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

commit;
