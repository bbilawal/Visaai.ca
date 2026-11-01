-- Promote Singapore's S Pass: 21 requirements.
-- Singapore reaches 6 published pages; the registry reaches 54.
--
-- A LOWER BAR THAT COSTS THE EMPLOYER MORE
--
-- The Employment Pass key facts say "no foreign worker levy or quota required".
-- The S Pass says "yes. employers are subject to a quota and levy for s pass
-- employees", requires the employer to PROVIDE medical insurance where the EP
-- says they "can choose", and requires a Primary Care Plan bought and declared
-- before the pass can be issued for workers in large dormitories or CMP
-- sectors.
--
-- $3,300 against $5,600 -- and a firm at its dependency ratio ceiling cannot
-- hire another S Pass holder however qualified they are. The S Pass is
-- rationed; the Employment Pass is not. Neither page says that. It is only
-- visible with both registered, which is the argument for extracting a
-- country's routes together rather than one a month.
--
-- THREE SALARY REGIMES LIVE AT ONCE
--
-- The Employment Pass publishes two columns. The S Pass publishes three, and
-- each binds somebody today: $3,150 for renewals of passes expiring 1 Sep 2025
-- to 31 Aug 2026, $3,300 for new applications now, $3,600 from 1 Jan 2027. All
-- three are stored, including the one that expires in eight days, because
-- somebody is renewing against it.
--
-- Financial services runs its own three -- $3,650 / $3,800 / $4,000 at the
-- bottom -- and all three converge on $5,650 at age 45 and above. The increases
-- fall entirely on younger candidates in that sector, which is a fact about the
-- shape of the table that no single figure carries.
--
-- THE DEPENDANT'S PASS GAP, FROM THE OTHER SIDE
--
-- The Dependant's Pass needs $6,000. The S Pass qualifies at $3,300. MOM states
-- the $6,000 on the S PASS page, so this route carries the gap explicitly where
-- the Employment Pass left it to be inferred across two pages. Most S Pass
-- holders cannot bring a spouse.
--
-- A CEILING NOBODY EXPECTS
--
-- "the pass can only be valid up to 1 month before your passport expiry date."
-- A first S Pass runs up to two years, unless the passport says otherwise --
-- 14 months of passport is 13 months of pass.
--
-- AND AN AUTHORITY PUBLISHING ITS OWN APPROVAL RATE
--
-- "if the sat shows that the candidate is eligible, there is around a 90% chance
-- that the candidate will get a pass." Stored verbatim and attributed, because
-- a probability is exactly the kind of claim that turns into VisaAI's own
-- prediction if it is paraphrased.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'sg-s-pass' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'sg-s-pass'
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

-- Assert the three salary regimes are ordered, and that the S Pass floor really
-- is below the Employment Pass floor. If MOM ever raises the S Pass above the
-- EP, every comparison written above stops being true.
do $$
declare pages int; expiring numeric; current_ numeric; future numeric; ep numeric;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'SG';
  if pages <> 6 then raise exception 'Expected 6 publishable Singaporean pages, found %.', pages; end if;

  select (parameters ->> 'min_all_sectors')::numeric into expiring from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-s-pass' and r.requirement_code = 'qualifying_salary_expiring_regime';
  select (parameters ->> 'min_all_sectors')::numeric into current_ from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-s-pass' and r.requirement_code = 'qualifying_salary_current';
  select (parameters ->> 'min_all_sectors')::numeric into future from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-s-pass' and r.requirement_code = 'qualifying_salary_from_2027';

  if expiring is null or current_ is null or future is null then
    raise exception 'One of the three S Pass salary regimes lost its parameters.';
  end if;
  if not (expiring < current_ and current_ < future) then
    raise exception 'S Pass salary regimes are not ascending: %, %, %.', expiring, current_, future;
  end if;

  select (parameters ->> 'min_all_sectors')::numeric into ep from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-employment-pass' and r.requirement_code = 'ep_qualifying_salary_current';
  if ep is null then raise exception 'Employment Pass floor not found — cannot check the comparison.'; end if;
  if current_ >= ep then
    raise exception 'The S Pass floor (%) now meets the EP floor (%) — re-read both pages.', current_, ep;
  end if;
end $$;

commit;
