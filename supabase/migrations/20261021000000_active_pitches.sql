begin;
-- Radar and hosted-pitch lists treated state='open' as live. Nothing moved
-- those rows to completed when starts_at passed, so yesterday's pitch stayed
-- on the radar. The view is the live set: not cancelled, not finished.
-- security_invoker keeps the existing outings RLS.

create or replace view public.active_pitches
  with (security_invoker = true) as
select
  id, host_id, title, pitch, activity_category, interest_node_id, area,
  starts_at, duration_minutes, budget_band, orientation, setting,
  max_participants, visibility, state, created_at, host_type,
  cover_image_url, cover_image_thumb_url, cover_image_alt,
  cover_photographer_name, cover_photographer_url, cover_download_location
from public.outings
where state in ('open', 'confirmed')
  and starts_at + make_interval(mins => duration_minutes) > now();

revoke all on public.active_pitches from anon, public;
grant select on public.active_pitches to authenticated, service_role;

commit;
