begin;

drop policy if exists host_policy_public_read on public.host_policy;
drop policy if exists outings_public_read on public.outings;
drop policy if exists profiles_public_read on public.profiles;
drop policy if exists match_scores_read on public.match_scores;

revoke execute on function public.can_interact_with(uuid) from anon;
revoke execute on function public.create_pitch(jsonb, uuid[]) from anon;
revoke execute on function public.has_outing_context(uuid) from anon;
revoke execute on function public.package_onboarding_answers(jsonb) from anon;
revoke execute on function public.save_profile_bundle(jsonb, jsonb, jsonb, integer[]) from anon;

commit;
