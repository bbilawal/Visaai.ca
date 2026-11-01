-- Promote Hong Kong's residence as dependant: 16 requirements.
-- Hong Kong reaches 4 published pages; the registry reaches 62.
--
-- WHO YOUR SPONSOR IS DECIDES WHETHER YOUR PARENTS CAN COME
--
--   * Sponsor here on a visa -- employment (GEP, ASMTP, IANG, VPAS, TechTAS),
--     study, investment, training, or as an entrant under CIES, QMAS, the
--     second-generation scheme, the Top Talent Pass or the new CIES:
--     spouse or recognised partner, and unmarried children under 18.
--
--   * Sponsor who is a PERMANENT RESIDENT, or has the right to land or
--     unconditional stay: the same, PLUS "his/her parents aged 60 or above".
--
-- A work-visa holder can never bring a parent, however long they stay or
-- however much they earn. A permanent resident can, once the parent turns 60.
--
-- None of Hong Kong's three registered work routes says this, because each of
-- them describes only its own dependants. It takes the standalone route to see
-- that the answer depends on a property of the SPONSOR rather than of the
-- applicant -- and to see that "can I bring my mother?" has a yes buried seven
-- years of residence away.
--
-- AND IT CORRECTS WHAT THE WORK ROUTES IMPLY
--
-- `hk-general-employment-policy` and `hk-non-local-graduates` both record that
-- dependants "are not prohibited from taking up employment". True of them. The
-- whole rule has an exception:
--
--   "however, dependants of persons who have been admitted into the hksar to
--    study are prohibited from taking up employment in the hksar unless they
--    have obtained prior permission from the director of immigration."
--
-- A student's spouse is the one dependant in Hong Kong who must ask. Neither
-- work route is wrong; both are partial, and only the route that states the
-- rule for everybody can show that. Study, by contrast, is unconditional: "all
-- dependants do not require prior permission from the director of immigration
-- to study in the hksar."
--
-- TWO EXTENSION CLOCKS ON ONE PASS
--
-- Three months before expiry under a "specified scheme"; FOUR WEEKS for every
-- other dependant. A dependant who assumes the three-month window because a
-- colleague had it does not file early -- they file wrongly.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-24'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'hk-residence-as-dependant' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
where t.visaai_id = 'hk-residence-as-dependant'
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

-- The general work permission and its student exception must BOTH be present,
-- and the exception must render after the rule it qualifies. Losing the
-- exception tells a student's spouse they may work; losing the rule tells
-- everyone else they may not.
do $$
declare pages int; rule_ord int; exception_ord int; parent_age int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'HK';
  if pages <> 4 then raise exception 'Expected 4 publishable Hong Kong pages, found %.', pages; end if;

  select display_order into rule_ord from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-residence-as-dependant'
     and r.requirement_code = 'dependants_may_work' and r.status = 'active';
  select display_order into exception_ord from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-residence-as-dependant'
     and r.requirement_code = 'students_dependants_need_permission_to_work' and r.status = 'active';

  if rule_ord is null or exception_ord is null then
    raise exception 'The work rule (%) and its student exception (%) must both be active.',
      rule_ord, exception_ord;
  end if;
  if exception_ord <= rule_ord then
    raise exception 'The student exception (%) must render after the rule it qualifies (%).',
      exception_ord, rule_ord;
  end if;

  select (parameters ->> 'min_parent_age')::int into parent_age
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-residence-as-dependant'
     and r.requirement_code = 'parents_aged_60_or_above';
  if parent_age is distinct from 60 then
    raise exception 'The parent age floor is %, expected 60.', parent_age;
  end if;
end $$;

commit;
