-- Read-only view: derived last-activity per application.
-- greatest() across every child timestamp that signals user activity.
-- No writes to applications; reminders + dashboard read from here.
-- security_invoker enforces the querying user's RLS on the base tables, so the
-- web client (user session) only ever sees its own applications' activity.
-- The reminder job uses the service role, which bypasses RLS as intended.
create or replace view public.application_activity
  with (security_invoker = true) as
select
  a.id as application_id,
  a.user_id,
  greatest(
    a.created_at,
    coalesce(p.last_updated_at, a.created_at),
    coalesce(d.max_created, a.created_at),
    coalesce(g.max_generated, a.created_at),
    coalesce(v.max_calculated, a.created_at),
    coalesce(s.max_session, a.created_at)
  ) as last_active_at
from public.applications a
left join public.application_profiles p on p.application_id = a.id
left join (
  select application_id, max(created_at) as max_created
  from public.documents group by application_id
) d on d.application_id = a.id
left join (
  select application_id, max(generated_at) as max_generated
  from public.generated_documents group by application_id
) g on g.application_id = a.id
left join (
  select application_id, max(calculated_at) as max_calculated
  from public.vri_scores group by application_id
) v on v.application_id = a.id
left join (
  -- submission_sessions has no created/updated column; started_at and
  -- completed_at are the lifecycle timestamps that signal user activity.
  select application_id, max(greatest(started_at, completed_at)) as max_session
  from public.submission_sessions group by application_id
) s on s.application_id = a.id;

comment on view public.application_activity is
  'Derived last-activity per application (Epic B). Read-only, no write-path.';
