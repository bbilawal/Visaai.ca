-- Re-promote Lebanon after correcting four excerpts and pairing eight fees.
--
-- WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT
--
-- Four requirements published a verbatim excerpt that was the WRONG SENTENCE:
--
--   cat5_non_activity_attestation        quoted "regarding (6):"
--   cat7_mfa_document_of_prior_service   quoted "regarding (8):"
--   fee_urgent_service                   quoted "important notes:"
--   fee_three_year_is_three_times_annual quoted the overstay-penalty note
--
-- Every one of those strings IS on the page. `verify-excerpts.ts` passed,
-- `verify-quotes-against-raw.ts` passed against the raw HTML, and this
-- migration's predecessor asserted provenance on all 97 rows — because all of
-- those checks ask the same question, "is this text there", and the answer was
-- yes every time. What none of them could ask is whether it is the RIGHT text.
--
-- The cause was mechanical: the excerpts are taken by LINE OFFSET out of the
-- fetcher's own output, which makes them exact by construction — but the
-- offsets themselves were chosen by eye against an unnumbered dump, and four
-- landed one or two lines away from their target.
--
-- `scripts/check-excerpt-shape.ts` now asks the different question, and this
-- migration asserts the specific corrections so they cannot silently revert.
--
-- EIGHT FEES ALSO CHANGED SHAPE
--
-- Lebanon's fee tables put the row label on one line and the price on the next,
-- so eight fee excerpts read `lbp 108,000,000` and said nothing about what they
-- bought. Two were WORD-FOR-WORD IDENTICAL — the cash-guarantee route and the
-- businessperson route are both LBP 54,000,000 — so each one's evidence
-- supported the other equally well. They now quote label and amount joined by
-- the declared elision, which is the honest form: it shows the cut.

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
  n_heading integer; n_bare integer; n_cat5 integer; n_cat7 integer;
  n_urgent integer; n_threetimes integer; n_paired integer; n_twin integer;
begin
  -- 96, not 97: the duplicated category-1 row label was retired.
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active';
  if n_active <> 96 then raise exception 'Expected 96 active LB requirements, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% LB requirement(s) lack provenance or a display quotation', n_bad; end if;

  -- THE GUARD, AS AN ASSERTION. A short excerpt ending in a colon and saying
  -- nothing about obligation is a section heading, and a heading points AT
  -- requirements rather than being one.
  select count(*) into n_heading from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active'
     and r.source_excerpt like '%:'
     and length(r.source_excerpt) <= 60
     and r.source_excerpt !~* '(must|need|require|should|may|at least|one of|either)';
  if n_heading > 0 then
    raise exception '% LB requirement(s) quote a section HEADING as their evidence', n_heading;
  end if;

  -- A fee excerpt made only of digits, separators and the currency does not say
  -- what it buys. Tightened from the previous migration's zero-only test.
  select count(*) into n_bare from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active' and r.kind = 'fee'
     and r.source_excerpt ~ '^[0-9 ,.]*lbp[0-9 ,.]*$';
  if n_bare > 0 then
    raise exception '% LB fee(s) quote a BARE AMOUNT with no indication of what it buys', n_bare;
  end if;

  -- No two live Lebanese requirements may rest on the identical short string.
  select count(*) into n_twin from (
    select r.source_excerpt
      from public.visa_requirements r
      join public.visa_types t on t.id = r.visa_type_id
      join public.visa_countries c on c.id = t.country_id
     where c.code = 'LB' and r.status = 'active' and length(r.source_excerpt) <= 80
     group by r.source_excerpt having count(*) > 1
  ) dupes;
  if n_twin > 0 then
    raise exception '% short excerpt(s) are shared by more than one live LB requirement', n_twin;
  end if;

  -- The four specific corrections.
  select count(*) into n_cat5 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-courtesy-residence' and r.status = 'active'
     and r.requirement_code = 'cat5_non_activity_attestation'
     and r.source_excerpt like '%attestation of non-activity%';
  select count(*) into n_cat7 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-courtesy-residence' and r.status = 'active'
     and r.requirement_code = 'cat7_mfa_document_of_prior_service'
     and r.source_excerpt like '%ministry of foreign affairs%';
  select count(*) into n_urgent from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-annual-residence' and r.status = 'active'
     and r.requirement_code = 'fee_urgent_service'
     and r.source_excerpt like '%4,900,000%';
  select count(*) into n_threetimes from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-annual-residence' and r.status = 'active'
     and r.requirement_code = 'fee_three_year_is_three_times_annual'
     and r.source_excerpt like '%three times the annual residence permit fee%';
  if n_cat5 <> 1 or n_cat7 <> 1 or n_urgent <> 1 or n_threetimes <> 1 then
    raise exception 'The four corrected excerpts must each be present (found %, %, %, %)',
      n_cat5, n_cat7, n_urgent, n_threetimes;
  end if;

  -- The eight fees that now carry their label with the figure.
  select count(*) into n_paired from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active' and r.kind = 'fee'
     and r.source_excerpt like '% ... %';
  if n_paired <> 8 then
    raise exception 'Expected 8 label-and-amount fee excerpts, found %', n_paired;
  end if;

  select count(*) into n_pages from public.visa_publishable_pages where country_code = 'LB';
  if n_pages <> 4 then raise exception 'Lebanon should publish 4 pages, found %', n_pages; end if;

  raise notice 'Lebanon RE-PROMOTED: 4 routes, % requirements, 4 excerpts corrected, 8 fees paired with their labels', n_active;
end $$;
