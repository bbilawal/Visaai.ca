-- Promote Singapore's Overseas Networks & Expertise Pass: 23 requirements.
-- Singapore reaches 7 published pages; the registry reaches 55.
--
-- THE LADDER IS NOW COMPLETE, AND IT INVERTS
--
--   S Pass          $3,300/month    quota + levy       employer applies
--   Employment Pass $5,600/month    COMPASS 40 points  employer applies
--   ONE Pass       S$30,000/month   exempt from both   CANDIDATE may apply
--
-- The exemptions run OPPOSITE to the cost. The highest-paid pass is the one
-- freed from COMPASS, from Fair Consideration Framework job advertising, from
-- the levy and quota, and from the one-employer rule that defines the
-- Employment Pass. No MOM page draws that comparison; three routes in one
-- registry do.
--
-- IT UNDOES THE EMPLOYMENT PASS'S CENTRAL CONSTRAINT
--
-- An EP binds a person to one employer -- a new job is a new application. A ONE
-- Pass holder may "concurrently start, operate and work for multiple companies
-- at any one time" and needs "no need to reapply for a pass if you change jobs".
-- That is a different relationship to the state, not a better-paid version of
-- the same one.
--
-- AND IT RESTORES THE LETTER OF CONSENT
--
-- The Dependant's Pass promoted an hour ago records that the Letter of Consent
-- is gone: a DP holder who wants to work needs an EP, S Pass or DP-Work Permit.
-- That is true of the page it was read from, which covers dependants of EP and
-- S Pass holders. This page says "your spouse will be able to apply to work on
-- a letter of consent."
--
-- The LOC was not abolished. It was RESTRICTED to this pass. Two routes
-- extracted the same night is the only reason that reads as a distinction
-- rather than as a contradiction, and the Dependant's Pass file already says
-- its page does not cover ONE Pass families.
--
-- MOM PRINTS THE ARITHMETIC SO NOBODY HAS TO INFER IT
--
--   S$20,000 + S$10,000 = S$30,000  ->  NOT eligible
--   S$30,000 + S$5,000  = S$35,000  ->  eligible
--
-- Ireland's family route bars combining incomes between PEOPLE. This bars
-- combining them between JOBS held by one person.
--
-- TWO CURRENCIES ON ONE PAGE
--
-- The salary threshold is SGD. The employer-size thresholds are USD -- market
-- capitalisation US$500 million or annual revenue US$200 million. A country
-- level fee_currency was never going to carry that, which is why every figure
-- in this registry stores its own.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'sg-one-pass' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'sg-one-pass'
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

-- Assert the ladder. Every comparison in this file's commentary rests on
-- S Pass < Employment Pass < ONE Pass, and on the ONE Pass thresholds keeping
-- their currencies apart. If MOM moves any of them, this fails rather than
-- letting the prose go quietly stale.
do $$
declare pages int; s numeric; ep numeric; one numeric; usd_mcap numeric; cur text;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'SG';
  if pages <> 7 then raise exception 'Expected 7 publishable Singaporean pages, found %.', pages; end if;

  select (parameters ->> 'min_all_sectors')::numeric into s from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-s-pass' and r.requirement_code = 'qualifying_salary_current';
  select (parameters ->> 'min_all_sectors')::numeric into ep from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-employment-pass' and r.requirement_code = 'ep_qualifying_salary_current';
  select (parameters ->> 'amount')::numeric, parameters ->> 'currency' into one, cur
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-one-pass' and r.requirement_code = 'salary_past_employment';

  if s is null or ep is null or one is null then
    raise exception 'A rung of the ladder lost its parameters (s=%, ep=%, one=%).', s, ep, one;
  end if;
  if not (s < ep and ep < one) then
    raise exception 'The salary ladder is no longer ascending: s=%, ep=%, one=%.', s, ep, one;
  end if;
  if cur is distinct from 'SGD' then
    raise exception 'ONE Pass salary currency is %, expected SGD.', cur;
  end if;

  select (parameters ->> 'market_capitalisation')::numeric into usd_mcap
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-one-pass' and r.requirement_code = 'established_company_thresholds'
     and parameters ->> 'currency' = 'USD';
  if usd_mcap is distinct from 500000000 then
    raise exception 'The USD company threshold is % — the two currencies on this page must stay distinct.', usd_mcap;
  end if;
end $$;

commit;
