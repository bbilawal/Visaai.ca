-- Promote the UAE Green and Blue Residence requirements from draft to active.
--
-- The assertions below check the claims a reviewer cannot verify by eye, and on
-- these two pages that means the figure collisions. Four different AED amounts
-- across two routes, several sharing a number while meaning different things:
--
--   Green,  skilled workers  AED  15,000  MONTHLY salary
--   Green,  freelancers      AED 360,000  ANNUAL income, previous two years
--   Blue,   influencers      AED   1 million  financial support GIVEN
--   Blue,   investors        AED   1 million  annual revenue ACHIEVED
--   Blue,   investors        AED   2 million  capital, fully owned
--
-- A wrong figure here is a wrong answer to somebody deciding whether they
-- qualify, and the two AED 1 million rules are not interchangeable: one is money
-- the applicant gave away, the other is money their company earned.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-25'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id in ('ae-green-residency', 'ae-blue-residency')
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-25'::timestamptz
 where t.visaai_id in ('ae-green-residency', 'ae-blue-residency')
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_green integer; n_blue integer; n_bad integer; n_pages integer;
  n_15k integer; n_360k integer; n_1m integer; n_2m integer; n_scoped integer;
begin
  select count(*) into n_green from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ae-green-residency' and r.status = 'active';
  if n_green <> 11 then raise exception 'Expected 11 active Green requirements, found %', n_green; end if;

  select count(*) into n_blue from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ae-blue-residency' and r.status = 'active';
  if n_blue <> 15 then raise exception 'Expected 15 active Blue requirements, found %', n_blue; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('ae-green-residency','ae-blue-residency')
     and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null
          or r.source_excerpt_display is null);
  if n_bad > 0 then
    raise exception '% active requirement(s) lack provenance or a display quotation', n_bad;
  end if;

  select count(*) into n_pages from public.visa_publishable_pages
   where visaai_id in ('ae-green-residency','ae-blue-residency');
  if n_pages <> 2 then raise exception 'Expected 2 publishable pages, found %', n_pages; end if;

  -- The figure collisions, each asserted separately.
  select count(*) into n_15k from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ae-green-residency' and r.status='active'
     and r.source_excerpt like '%aed 15,000%';
  if n_15k <> 1 then raise exception 'Expected 1 requirement quoting the AED 15,000 monthly salary, found %', n_15k; end if;

  select count(*) into n_360k from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ae-green-residency' and r.status='active'
     and r.source_excerpt like '%aed 360,000%';
  if n_360k <> 1 then raise exception 'Expected 1 requirement quoting the AED 360,000 annual income, found %', n_360k; end if;

  select count(*) into n_1m from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ae-blue-residency' and r.status='active'
     and r.source_excerpt like '%aed 1 million%';
  if n_1m <> 2 then
    raise exception 'Expected 2 distinct AED 1 million rules on Blue (support given, revenue achieved), found %', n_1m;
  end if;

  select count(*) into n_2m from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ae-blue-residency' and r.status='active'
     and r.source_excerpt like '%aed 2 million%';
  if n_2m <> 1 then raise exception 'Expected 1 requirement quoting the AED 2 million Blue capital floor, found %', n_2m; end if;

  -- Category scoping: without it, three eligibility tests read as one checklist.
  select count(*) into n_scoped from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('ae-green-residency','ae-blue-residency') and r.status='active'
     and (r.label ilike 'skilled workers:%' or r.label ilike 'freelancers:%'
          or r.label ilike 'investors%:%' or r.label ilike 'influencers:%'
          or r.label ilike 'scientists:%');
  if n_scoped < 19 then
    raise exception 'Only % requirement(s) are scoped to a category; the rest would read as universal', n_scoped;
  end if;

  raise notice 'Green (%) and Blue (%) promoted: 2 publishable pages, provenance and display quotations complete',
    n_green, n_blue;
end $$;
