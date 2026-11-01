-- Promote Finland's residence permit for an employed person: 29 requirements.
-- Finland becomes the registry's TENTH destination and its first page.
--
-- WHY 29 IS HIGHER THAN THIS REGISTRY'S NORM
--
-- Six of them come from a SECOND page. Migri states the permit-specific rules
-- on the TTOL page and then writes, in its own words, "in addition, you must
-- meet the general requirements for obtaining a residence permit" -- conditions
-- it publishes on /en/first-residence-permit and states nowhere on the permit
-- page. A checklist built from the permit page alone would be one an applicant
-- could satisfy in full and still be refused on a published ground. So both
-- pages are registered sources, and each general condition quotes the page it
-- was actually read from.
--
-- FIRST PERMIT AND EXTENDED PERMIT ARE INTERLEAVED, AND THAT IS THE TRAP
--
-- Migri writes both in one flow: "first permit 750 € / extended permit 230 €",
-- two attachments carrying "this document is not needed if you apply for an
-- extended permit", and an income rule with a retrospective check that bites
-- only at extension. This visa type is the FIRST permit. Splitting those
-- sentences to keep only half would misquote the page, so the excerpts carry
-- both figures and the labels and parameters name which permit each belongs to.
--
-- OTHER THINGS EASY TO GET WRONG:
--   * The permit is granted for a FIELD OF EMPLOYMENT, not for one job. Within
--     the field the holder may hold several jobs and change employer; outside
--     it they may not work at all.
--   * A zero-hours or on-demand contract is an outright bar, not a weighting,
--     however much it happens to pay. Someone reading only the EUR 1,600 line
--     would never learn this.
--   * "Light entrepreneurs" invoicing through a service company are excluded --
--     and that arrangement looks like employment to the person doing it.
--   * A first permit must be applied for ABROAD. Migri's general page states
--     that applying from inside Finland "will usually get a negative decision",
--     so the place of application is a condition, not a formality.
--   * The 50% fringe-benefit cap is stored WITHOUT a currency. It is a share of
--     salary, and `visa-amounts.ts` prices any number that sits beside a
--     currency -- which is exactly how "SEK 2,026 stated for year" once reached
--     a page.
--
-- FRESHNESS
--
-- Neither page publishes a dateModified, so by the rule Germany forced, both
-- are "unknown" and never "fresh". What the permit page publishes instead is
-- stronger than a dateline: a processing-situation block updated monthly,
-- currently reporting July 2026 averages and counting applications since the
-- start of 2026. A page carrying last month's statistics is not stale, and the
-- income figure names its own year.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'fi-employed-person' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'fi-employed-person'
  and exists (select 1 from public.visa_requirements r
              where r.visa_type_id = t.id and r.status = 'active');

do $$
declare bad int;
begin
  select count(*) into bad from public.visa_requirements
  where status = 'active'
    and (source_version_id is null or source_excerpt is null or source_excerpt = ''
         or (kind = 'recommended' and officially_required));
  if bad > 0 then raise exception '% active requirement(s) lack provenance.', bad; end if;
end $$;

-- Finland must publish, and it must publish from BOTH pages: if the general
-- conditions silently failed to attach, the page would still look complete.
do $$
declare pages int; general int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'FI';
  -- Replay guard. Finland has never been fetched from production egress -- migri.fi
  -- WAF-challenges the VPS, 403 on everything including robots.txt -- so this
  -- promotion failed in production too, and 20260826300000 records the result:
  -- 5 visa types, 12 sources, 0 versions, 0 requirements, support_state 'preview'.
  -- On a database replaying the chain from empty the same is true, and stopping
  -- the whole chain over it helps nobody. Outside a replay (no fixture table)
  -- this stays fatal.
  if pages <> 1 then if to_regclass('public.visa_source_version_fixtures') is not null then raise warning 'Expected 1 publishable Finnish page, found %. (replay: Finland has never been fetched)', pages; else raise exception 'Expected 1 publishable Finnish page, found %.', pages; end if; end if;

  select count(*) into general
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  join public.visa_source_versions v on v.id = r.source_version_id
  join public.visa_sources s on s.id = v.source_id
  where t.visaai_id = 'fi-employed-person' and r.status = 'active' and s.role = 'eligibility';
  if general <> 6 then
    if to_regclass('public.visa_source_version_fixtures') is not null then raise warning 'Expected 6 requirements bound to the general-requirements page, found %. (replay: Finland has never been fetched)', general; else raise exception 'Expected 6 requirements bound to the general-requirements page, found %.', general; end if;
  end if;
end $$;

commit;
