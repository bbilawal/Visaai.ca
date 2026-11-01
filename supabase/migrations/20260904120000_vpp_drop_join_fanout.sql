-- Stop `visa_publishable_pages` fanning out and de-duplicating on every read.
--
-- WHY
--
-- This is the hottest query in production. pg_stat_statements on 2026-09-04:
--
--     231,824 calls, 71 ms mean
--
-- which is roughly four and a half hours of cumulative database time, and it
-- sits in front of all 177 public visa pages plus the country hubs. Every page
-- view pays it.
--
-- The cost is structural rather than a missing index. The view joined
-- visa_requirements (2,625 rows) and visa_sources against each visa type at
-- once, producing a 5,425-row cartesian fan-out, and then undid that fan-out
-- with `count(DISTINCT ...) FILTER (...)`. So each read seq-scanned every
-- requirement in the database, sorted the exploded result, and grouped it back
-- down to 177 rows.
--
-- Counting in lateral subqueries instead means each count is an index lookup
-- keyed by visa_type_id, and nothing is ever duplicated to be de-duplicated.
--
-- MEASURED on production, same data, same 177 rows out:
--
--     before   ~17 ms   (19.3 / 14.5 / 17.5 across three runs)
--     after    ~3.4 ms  (3.7 / 3.3 / 3.4)
--
-- SEMANTICS ARE UNCHANGED, and that was checked rather than reasoned about:
-- `EXCEPT` in both directions between the old and new definitions returned zero
-- rows on production data, with 177 rows on each side.
--
-- The equivalence holds because `count(DISTINCT r.id) FILTER (...)` over the
-- fan-out is by construction the number of matching requirement rows for that
-- visa type -- the DISTINCT exists only to cancel the join -- and the same for
-- sources. `max(GREATEST(t.last_verified_at, c.last_verified_at))` collapses to
-- GREATEST because both columns are constant within a group.
--
-- security_invoker is re-stated deliberately. `create or replace view` does not
-- carry reloptions forward, and dropping it here would make this view read with
-- the owner's rights -- which is the exact shape of the cross-tenant leak that
-- 20260812 hardening was written to close. If you edit this view again, keep
-- that clause.

begin;

create or replace view public.visa_publishable_pages
with (security_invoker = true) as
  select
    c.code                    as country_code,
    c.slug                    as country_slug,
    c.name                    as country_name,
    t.id                      as visa_type_id,
    t.visaai_id,
    t.slug                    as visa_slug,
    t.official_name,
    t.category,
    rq.cnt                    as official_requirement_count,
    sc.cnt                    as source_count,
    greatest(
      coalesce(t.last_verified_at, '1970-01-01 00:00:00+00'::timestamptz),
      coalesce(c.last_verified_at, '1970-01-01 00:00:00+00'::timestamptz)
    )                         as last_verified_at
  from public.visa_countries c
  join public.visa_types t
    on t.country_id = c.id
  -- Lateral rather than a join + count(distinct): one index lookup per visa
  -- type, and no intermediate row is ever produced twice.
  join lateral (
    select count(*) as cnt
      from public.visa_requirements r
     where r.visa_type_id = t.id
       and r.status = 'active'
       and r.officially_required
  ) rq on true
  join lateral (
    select count(*) as cnt
      from public.visa_sources s
     where s.visa_type_id = t.id
       and s.active
  ) sc on true
  where c.support_state = 'supported'
    and t.lifecycle_state = 'active'
    -- Same gate as the old HAVING: a page publishes only when it has at least
    -- one official requirement AND at least one live source. A page with
    -- neither would be a claim we cannot evidence.
    and rq.cnt > 0
    and sc.cnt > 0;

comment on view public.visa_publishable_pages is
  'Visa types that may be published: supported country, active lifecycle, at '
  'least one active official requirement and one active source. Counts come '
  'from lateral subqueries -- see the migration header before rewriting this '
  'as a join, it was 5x slower that way and it is the hottest read in prod.';

do $$
declare
  v_opts text;
  v_rows integer;
begin
  select coalesce(array_to_string(c.reloptions, ','), '')
    into v_opts
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'visa_publishable_pages';

  if v_opts not like '%security_invoker=true%' then
    raise exception 'visa_publishable_pages lost security_invoker (reloptions: %)', v_opts;
  end if;

  select count(*) into v_rows from public.visa_publishable_pages;
  raise notice 'visa_publishable_pages: % publishable page(s)', v_rows;
end $$;

commit;
