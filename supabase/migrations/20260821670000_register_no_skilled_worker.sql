-- Add Norway's skilled worker residence permit. Norway now has 3 visa types.
--
-- THE HAZARD ON THIS PAGE, AND WHY THE EXTRACTION IS BOUNDED
--
-- /work-immigration/skilled-workers/ is 30,600 characters and does NOT describe
-- one permit. UDI concatenates several worker categories behind a "what type of
-- work will you be doing?" selector — skilled workers, athletes and coaches,
-- seafarers, employees on assignment — and the normalizer flattens them into one
-- text stream.
--
-- That is a trap for extraction. The first salary figure in the flattened text,
-- NOK 341,373 per year, belongs to ATHLETES AND COACHES. Quoting it as the
-- skilled worker pay threshold would have been verbatim, would have passed
-- excerpt verification, and would have been wrong — the excerpt check proves a
-- quote is ON the page, not that it is about the right thing.
--
-- So the skilled-worker block was located by its own heading and bounded before
-- anything was quoted: characters 4,079 to 14,533. Within those bounds there is
-- NO salary figure at all. UDI states the pay rule qualitatively — "must not be
-- poorer than is normal in norway" — and that is what is recorded.
--
-- URL FORM
--
-- The bare URL is larger than the ?c= variant here (30,864 vs 28,621), as with
-- the study permit and unlike the visitor visa. Measured, not assumed, for the
-- third time on this site. The clean URL is registered.
--
-- The section links themselves were only reachable via ?c=ind on the parent
-- work-immigration page, which is how skilled-workers/ was found at all.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NO'),
  'no-skilled-worker', 'work',
  'Skilled worker residence permit', 'skilled-worker',
  'Work in Norway as a skilled worker on a concrete job offer, with completed '
    'vocational training, higher education, or equivalent special '
    'qualifications.',
  'active', 'unverified', '2026-08-22'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements', 'Utlendingsdirektoratet (UDI)', 1,
  'https://www.udi.no/en/want-to-apply/work-immigration/skilled-workers/',
  'https://www.udi.no/en/want-to-apply/work-immigration/skilled-workers/',
  'Skilled workers', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'NO'
where t.visaai_id = 'no-skilled-worker'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'no-skilled-worker';
  if n < 1 then raise exception 'Skilled worker source not registered.'; end if;
end $$;
