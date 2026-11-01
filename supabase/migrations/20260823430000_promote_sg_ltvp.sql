-- Promote Singapore's Long-Term Visit Pass: 17 requirements.
-- Singapore reaches 8 published pages; the registry reaches 56.
--
-- A DEADLINE THAT EXPIRES BEFORE THE APPLICANT KNOWS THE PROCESS EXISTS
--
-- "6 weeks instead of 6 months."
--
-- A Singapore citizen's foreign spouse waits up to six months for an LTVP
-- decision -- unless the couple completed the free Pre-Marriage LTVP Assessment
-- BEFORE marrying, in which case six weeks. The action that saves four and a
-- half months costs nothing, takes minutes, and is only available to people who
-- have no reason yet to be reading immigration pages. Nothing done after the
-- wedding recovers it.
--
-- That is the clearest case this registry has found of a decision whose window
-- closes before the applicant enters the funnel, and it is the reason this route
-- was worth registering ahead of several easier ones.
--
-- ICA ALSO SAYS THE QUIET PART: "marriage does not guarantee ltvp approval."
-- Stored verbatim, because the assumption it corrects is close to universal.
--
-- TWO DIFFERENT PASSES SHARE THIS NAME
--
-- MOM issues a Long-Term Visit Pass to family members of WORK PASS holders who
-- do not qualify for a Dependant's Pass -- referenced tonight by the
-- sg-dependants-pass extraction. ICA issues THIS one to family members of
-- CITIZENS AND PERMANENT RESIDENTS. Different authority, different eligibility,
-- same three letters. The visa type name says whose it is, because a reader who
-- lands on the wrong one gets a plausible and wrong answer.
--
-- A MOM RULE PUBLISHED ON AN ICA PAGE, WITH A PENALTY THAT IS NOT REFUSAL
--
-- Existing AND FORMER Work Permit holders must obtain the Controller of Work
-- Passes' approval before marrying a citizen or PR -- civil, religious or
-- customary, in Singapore or overseas. "if they fail to do so, their privileges
-- to work in singapore could be withdrawn. they may also be prevented from
-- entering singapore for a period of time."
--
-- The penalty for missing a marriage formality is losing the right to work.
-- Stored here because this is where ICA publishes it.
--
-- TWO CLOCKS AFTER APPROVAL, BOTH FATAL
--
--   * Formalities must finish before the in-principle approval expires, "otherwise
--     the application will be considered withdrawn".
--   * Payment must be made within 14 days of ICA verifying the documents,
--     "otherwise the application will be withdrawn".
--
-- And the approval itself "is not an immigration pass and does not confer any
-- valid stay" -- so an applicant waiting on formalities still needs a separate
-- immigration pass to be in the country.
--
-- PARENTS YES, PARENTS-IN-LAW NO. One of seven categories, and the only one
-- ICA states as an exclusion.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'sg-long-term-visit-pass' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'sg-long-term-visit-pass'
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

-- The pre-marriage assessment is the highest-value fact on this route, and it is
-- only useful if it renders EARLY. Assert it is ordered ahead of everything that
-- happens after the wedding, and that its parameters still carry both figures.
do $$
declare pages int; pmla int; after_marriage int; w int; m int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'SG';
  if pages <> 8 then raise exception 'Expected 8 publishable Singaporean pages, found %.', pages; end if;

  select display_order,
         (parameters ->> 'processing_with_pmla_weeks')::int,
         (parameters ->> 'processing_without_pmla_months')::int
    into pmla, w, m
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-long-term-visit-pass' and r.requirement_code = 'pmla_before_marriage';

  if pmla is null then raise exception 'The pre-marriage assessment requirement is missing.'; end if;
  if w is distinct from 6 or m is distinct from 6 then
    raise exception 'PMLA parameters lost their figures (weeks=%, months=%).', w, m;
  end if;

  select min(display_order) into after_marriage
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-long-term-visit-pass'
     and r.requirement_code in ('sponsor_must_hold_singpass', 'submission_fee', 'pay_within_14_days');

  if after_marriage is null or pmla >= after_marriage then
    raise exception 'The pre-marriage assessment (%) must render before the post-marriage steps (%).', pmla, after_marriage;
  end if;
end $$;

commit;
