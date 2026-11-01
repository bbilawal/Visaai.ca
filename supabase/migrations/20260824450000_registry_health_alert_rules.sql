-- Give the alert engine something to watch.
--
-- The engine has been live and ticking every five minutes — AlertScheduler
-- enqueues a BullMQ job, AlertRunProcessor evaluates due rules, notifies and
-- records events — with ZERO rules configured and ZERO events ever fired. It
-- was infrastructure that had never once alerted about anything, which is the
-- same shape as an eval harness that has never run and a monitor that had never
-- diffed a page.
--
-- Nothing to watch was the honest reason: the metric registry covered applicant
-- funnels and revenue, and nothing described whether the SOURCE data underneath
-- was sound. `registry-metrics.service.ts` adds that, and these are the rules on
-- it.
--
-- WHY THESE FOUR
--
-- Each one corresponds to a failure this system has actually had, not to a
-- number that was easy to graph:
--
--   provenance defects   the product's central promise. Every published
--                        requirement is bound to a verbatim excerpt from a
--                        specific source version; one that is not should wake
--                        somebody. Threshold is > 0 because the acceptable
--                        count is zero, not "few".
--
--   parse errors         B-23 hid eight real New Zealand failures for two runs.
--                        Fires above 2 rather than above 0: a single transient
--                        failure is noise, and an alert that cries wolf is an
--                        alert people mute. Client-rendered pages are NOT
--                        counted here (B-28) precisely so this stays actionable.
--
--   pages disappearing   a half-applied migration or a broken view drops pages
--                        silently, and the public site simply gets smaller. 50
--                        is a floor under the current 58, chosen to catch a
--                        collapse rather than a single deliberate removal.
--
--   review queue growth  the promotion workflow depends on a human, and until
--                        2026-08-24 there was no screen for them. 150 is well
--                        above today's 125 so it reports a queue nobody is
--                        working, not the queue existing.
--
-- Thresholds are judgement, and they are wrong until they have fired once and
-- been argued with. They are written here so that argument happens against a
-- recorded number rather than against nobody's opinion.

alter table public.analytics_alert_rule
  alter column created_by drop not null;

comment on column public.analytics_alert_rule.created_by is
  'The user who created the rule. NULL means the platform provisioned it — a '
  'system rule has no human author, and inventing one would misattribute it.';

insert into public.analytics_alert_rule
  (name, metric_key, metric, query, conditions, combine, recipients,
   notify_user_ids, enabled, state, created_by)
select * from (values
  (
    'Registry: published requirement without provenance',
    'registry', 'requirements_without_provenance',
    '{"grain":"day","range":"7d"}'::jsonb,
    '[{"target":{"kind":"total"},"op":"gt","value":0}]'::jsonb,
    'all', array[]::text[], array[]::uuid[], true, 'ok', null::uuid
  ),
  (
    'Registry: sync parse errors',
    'registry', 'parse_errors',
    '{"grain":"day","range":"7d"}'::jsonb,
    '[{"target":{"kind":"total"},"op":"gt","value":2}]'::jsonb,
    'all', array[]::text[], array[]::uuid[], true, 'ok', null::uuid
  ),
  (
    'Registry: published pages dropped',
    'registry', 'publishable_pages',
    '{"grain":"day","range":"7d"}'::jsonb,
    '[{"target":{"kind":"total"},"op":"lt","value":50}]'::jsonb,
    'all', array[]::text[], array[]::uuid[], true, 'ok', null::uuid
  ),
  (
    'Registry: review queue not being worked',
    'registry', 'changes_awaiting_review',
    '{"grain":"day","range":"7d"}'::jsonb,
    '[{"target":{"kind":"total"},"op":"gt","value":150}]'::jsonb,
    'all', array[]::text[], array[]::uuid[], true, 'ok', null::uuid
  )
) as v(name, metric_key, metric, query, conditions, combine, recipients,
       notify_user_ids, enabled, state, created_by)
where not exists (
  select 1 from public.analytics_alert_rule r where r.name = v.name
);

do $$
declare n integer;
begin
  select count(*) into n
    from public.analytics_alert_rule
   where enabled and metric_key = 'registry';

  if n < 4 then
    raise exception 'expected 4 enabled registry rules, found %', n;
  end if;

  raise notice '% registry health rule(s) enabled', n;
end $$;
