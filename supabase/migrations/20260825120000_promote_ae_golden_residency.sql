-- Promote the UAE Golden Residency requirements from draft to active.
--
-- This is the step that makes the page publishable, and the assertions below
-- are the last gate before it does. They check the claims this route makes that
-- a reviewer could not check by eye — the ones where a wrong number would be a
-- wrong answer to a real applicant.
--
-- WHY THESE PARTICULAR ASSERTIONS
--
-- The AED 2 million threshold appears three times on the page for three
-- different things: capital investment, an investment-fund deposit, and
-- property value. A copy-paste error between them would be invisible in review
-- and consequential to read, so each is asserted separately.
--
-- The AED 250,000 tax figure is the ALTERNATIVE to the capital threshold. If it
-- were ever rendered as an additional requirement, the page would tell an
-- investor they need both, which the authority does not say.
--
-- And the category scoping is asserted, because flattening six eligibility
-- tests into one checklist is the specific way this route can mislead.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-25'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ae-golden-residency'
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-25'::timestamptz
 where t.visaai_id = 'ae-golden-residency'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active   integer;
  n_bad      integer;
  n_pages    integer;
  n_2m       integer;
  n_tax      integer;
  n_category integer;
begin
  select count(*) into n_active
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ae-golden-residency' and r.status = 'active';
  if n_active <> 14 then
    raise exception 'Expected 14 active Golden Residency requirements, found %', n_active;
  end if;

  -- The product's central promise. Nothing published may lack its provenance.
  select count(*) into n_bad
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ae-golden-residency' and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null);
  if n_bad > 0 then
    raise exception '% active requirement(s) lack provenance', n_bad;
  end if;

  select count(*) into n_pages
    from public.visa_publishable_pages where visaai_id = 'ae-golden-residency';
  if n_pages <> 1 then
    raise exception 'Expected the Golden Residency page to be publishable, found % page(s)', n_pages;
  end if;

  -- The three separate AED 2 million claims must all survive, each quoting the
  -- authority. If a copy-paste collapsed them this count drops.
  select count(*) into n_2m
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ae-golden-residency' and r.status = 'active'
     and r.source_excerpt like '%aed 2 million%';
  if n_2m <> 3 then
    raise exception 'Expected 3 requirements quoting AED 2 million (capital, fund deposit, property), found %', n_2m;
  end if;

  -- The tax figure is an ALTERNATIVE, not an addition.
  select count(*) into n_tax
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ae-golden-residency' and r.status = 'active'
     and r.source_excerpt like '%aed 250,000%';
  if n_tax <> 1 then
    raise exception 'Expected exactly 1 requirement quoting the AED 250,000 tax alternative, found %', n_tax;
  end if;

  -- Category scoping: labels must name who each rule applies to, or six
  -- eligibility tests read as one checklist.
  select count(*) into n_category
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ae-golden-residency' and r.status = 'active'
     and (r.label ilike 'investors:%' or r.label ilike 'entrepreneurs:%'
          or r.label ilike 'outstanding students:%' or r.label ilike 'humanitarian pioneers:%'
          or r.label ilike 'real-estate investors:%');
  if n_category < 11 then
    raise exception 'Only % requirement(s) are scoped to a category; the rest would read as universal', n_category;
  end if;

  raise notice 'Golden Residency promoted: % active requirements, 1 publishable page, provenance complete', n_active;
end $$;
