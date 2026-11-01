-- Triage the swept government forms VisaAI demonstrably uses.
--
-- The weekly form sweep has discovered 265 official forms (169 IRCC, 96 USCIS)
-- and every one has sat at status 'new' since it ran. A queue nobody has ever
-- cleared is a queue nobody reads, which is exactly the failure
-- sweep.service.ts warns about in its own comments.
--
-- WHAT IS BEING MARKED, AND WHY ONLY THIS MUCH
--
-- Eight findings are marked 'added' because their form code is cited by an
-- ACTIVE visa requirement. That is a verifiable fact about this database, not
-- a judgement: the form is already part of a requirement an applicant is shown,
-- so "added" is simply true.
--
-- The other 257 are deliberately LEFT AT 'new'.
--
-- 'ignored' is terminal and means "a form for a route we do not serve". Most of
-- the remainder plainly are — Genealogy Index Search Request, Notice of Appeal
-- to the Board of Immigration Appeals, Agri-Food Pilot schedules. But some are
-- not obviously out of scope at all: IMM 0008 is the generic Canadian
-- application form and IMM 0104 covers education, employment and travel
-- history. Dismissing 257 government forms in an immigration product on a
-- keyword hunch, permanently, is not triage — it is clearing a queue by
-- deleting the question.
--
-- So this migration does the part that is provable and leaves the part that
-- needs a person. docs/operations/FORM_SWEEP_TRIAGE.md lists what remains.
--
-- WHAT THE CROSS-REFERENCE INCIDENTALLY CONFIRMED
--
-- The sweep and the form catalogue are complementary rather than redundant:
-- the catalogue holds IMM 1294, IMM 1295 and IMM 5257, which the sweep did NOT
-- find, while the sweep found eight the catalogue lists differently. The four
-- registry form URLs the sweep failed to corroborate were fetched individually
-- and all four return 200, so the gap is sweep coverage, not registry rot.

update public.template_sweep_findings f
set status = 'added',
    resolved_at = now(),
    note = 'Cited by an active visa requirement; already reaches applicants '
           'through the sourced registry. Marked automatically on 2026-08-21 '
           'by cross-referencing visa_requirements.official_form_code.'
where f.status = 'new'
  and exists (
    select 1
    from public.visa_requirements r
    where r.status = 'active'
      and r.official_form_code is not null
      and upper(replace(r.official_form_code, ' ', ''))
          = upper(replace(f.code, ' ', ''))
  );

do $$
declare added int; remaining int;
begin
  select count(*) into added from public.template_sweep_findings where status = 'added';
  select count(*) into remaining from public.template_sweep_findings where status = 'new';
  raise notice 'sweep triage: % marked added, % still awaiting a person', added, remaining;
end $$;
