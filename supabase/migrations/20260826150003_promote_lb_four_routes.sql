-- Promote Lebanon's four routes. Lebanon reaches 4 live routes.
--
-- Four assertions beyond provenance.
--
--   NO FEE MAY BE A ROW OF ZEROS. The annual-residence page prints several fee
--   cells as `000000 lbp` and `0000,000 lbp` — the authority's own placeholders.
--   A fee requirement quoting one of those would publish a free residence
--   permit. This migration refuses to commit if any Lebanese fee excerpt is
--   nothing but zeros, spaces, commas and the currency.
--
--   THE PASSPORT FLOORS MUST STAY APART. Three years for the three-year permit,
--   two years for the two-year permit, one year for annual residence. Merging
--   them would tell somebody with a two-year passport they cannot apply for the
--   permit they are entitled to, or the reverse.
--
--   THE SCHOLARSHIP EXEMPTION COVERS BOTH DOCUMENTS. The source says a
--   scholarship holder is exempted from BOTH the admission statement and the
--   proof of funds. Quoted as covering one, it sends a funded student looking
--   for a bank statement they were excused.
--
--   COURTESY RESIDENCE IS FREE, AND MUST SAY SO. It is the only route in this
--   registry the authority states as free of charge, and a missing zero here
--   reads as an unpriced route rather than a free one.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id
   and c.code = 'LB'
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code = 'LB'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_bad integer; n_pages integer;
  n_zero_fee integer; n_three integer; n_two integer; n_one integer;
  n_scholarship integer; n_free integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active';
  if n_active <> 97 then raise exception 'Expected 97 active LB requirements, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% LB requirement(s) lack provenance or a display quotation', n_bad; end if;

  -- A fee excerpt made only of zeros, separators and the currency is a
  -- placeholder, not a price. The courtesy route's "granted for free" sentence
  -- is prose and is not caught by this, which is the point.
  select count(*) into n_zero_fee from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active' and r.kind = 'fee'
     and r.source_excerpt ~ '^[0 ,.]*lbp[0 ,.]*$';
  if n_zero_fee > 0 then
    raise exception '% Lebanese fee(s) quote a placeholder row of zeros as an amount', n_zero_fee;
  end if;

  -- The three passport floors, each exactly where it belongs.
  select count(*) into n_three from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-permanent-residence' and r.status = 'active'
     and r.requirement_code = 'three_year_passport_three_years'
     and r.source_excerpt like '%valid for at least three years%';
  select count(*) into n_two from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-permanent-residence' and r.status = 'active'
     and r.requirement_code = 'two_year_passport_two_years'
     and r.source_excerpt like '%valid for at least two years%';
  select count(*) into n_one from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-annual-residence' and r.status = 'active'
     and r.requirement_code = 'worker_family_passport_one_year'
     and r.source_excerpt like '%valid for a year at the least%';
  if n_three <> 1 or n_two <> 1 or n_one <> 1 then
    raise exception 'The three-, two- and one-year passport floors must each appear exactly once (found %, %, %)', n_three, n_two, n_one;
  end if;

  -- Both documents, or neither.
  select count(*) into n_scholarship from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-entry-visa' and r.status = 'active'
     and r.requirement_code = 'student_scholarship_exemption'
     and r.source_excerpt like '%exempted from both documents%';
  if n_scholarship <> 1 then
    raise exception 'The scholarship exemption must quote "exempted from both documents"; found %', n_scholarship;
  end if;

  select count(*) into n_free from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-courtesy-residence' and r.status = 'active'
     and r.requirement_code = 'granted_free'
     and r.source_excerpt like '%for free%'
     and (r.parameters->>'amount')::numeric = 0;
  if n_free <> 1 then
    raise exception 'Courtesy residence must publish that it is free, with a zero amount; found %', n_free;
  end if;

  select count(*) into n_pages from public.visa_publishable_pages where country_code = 'LB';
  if n_pages <> 4 then raise exception 'Lebanon should publish 4 pages, found %', n_pages; end if;

  raise notice 'Lebanon LIVE: 4 routes, % requirements', n_active;
end $$;
