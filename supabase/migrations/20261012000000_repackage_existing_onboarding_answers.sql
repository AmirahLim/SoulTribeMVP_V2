begin;
-- Rewrite stored onboarding JSON into baselineV2 + aliases so existing members
-- appear in read sources. The trigger on profile_answers refreshes projections.
update public.profile_answers
set onboarding = public.package_onboarding_answers(onboarding)
where jsonb_typeof(onboarding) = 'object';
commit;
