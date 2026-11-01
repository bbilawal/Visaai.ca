-- China: the 19th destination, admitted on the strength of a dateline that
-- also counts against it.
--
-- THE FRESHNESS ARGUMENT, BOTH WAYS
--
-- China was first assessed on 2026-08-24 and recorded as `needs_deeper_research`
-- with the note that it "reads better than almost anything else probed and fails
-- the check that matters most" — its richest English page last references 2021.
--
-- That verdict was made against the wrong page and with an incomplete check.
-- probe-authority.ts looks for a dateline in META TAGS; these guides print
-- theirs in the BODY, on the line under the title. Read properly, the three
-- service guides registered here publish `2023-03-27`, `2021-04-01` and
-- `2021-04-01` — real publication dates, which is more than Austria's
-- migration.gv.at, Singapore's MOM pages or the US ESTA pages give us.
--
-- So China is BETTER evidenced than several countries already live, and the
-- evidence says the guides are three to five years old. Both facts are recorded
-- in `page_dates` and in each extraction's freshness_note rather than one being
-- used to argue away the other. A dateline is only worth having if the number
-- on it is read.
--
-- WHAT IS DELIBERATELY NOT REGISTERED
--
-- The visa letters themselves. These guides use C, F, G, J1, J2, L, M, Q1, Q2,
-- R, S1, S2, X1, X2 and Z constantly and define none of them — the definitions
-- live in the Entry-Exit Regulations, a separate instrument. Every requirement
-- quotes the letter as the authority uses it and glosses none, because a gloss
-- would be VisaAI describing Chinese visa law rather than quoting it.
--
-- Visa ISSUANCE abroad, which is done by embassies and consulates and is a
-- different authority. These three guides cover what happens after entry.

update public.visa_countries
   set support_state             = 'supported',
       immigration_authority     = 'National Immigration Administration (NIA)',
       immigration_authority_url = 'https://en.nia.gov.cn/',
       official_visa_url         = 'https://en.nia.gov.cn/n147423/n147478/n147715/index.html',
       official_languages        = array['zh','en'],
       fee_currency              = 'CNY',
       data_quality              = 'unverified',
       last_verified_at          = '2026-08-26'::timestamptz
 where code = 'CN';

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'CN'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-26'::timestamptz
from (values
  ('cn-permanent-residence', 'permanent_residence',
   'Approval of Foreign Nationals'' Eligibility for Permanent Residence in China',
   'permanent-residence',
   'Chinese permanent residence across its seven eligibility limbs — investment, senior position, outstanding contribution, family of those three, spouse, dependent child and elderly relative — each with its own document set, plus the four grounds on which the status can later be cancelled.'),
  ('cn-residence-permit', 'other',
   'Issuance of Residence Permit for Foreigners',
   'residence-permit',
   'The Chinese residence permit in its five types — work, student, journalist, reunion and private affairs — fixed by the visa the holder entered on, with a 30-day post-entry application deadline and maximum validities that differ by type and by seniority.'),
  ('cn-visa-extension-change-reissuance', 'other',
   'Visa Extension, Change and Reissuance for Foreigners',
   'visa-extension-change-reissuance',
   'Extending, changing or replacing an ordinary Chinese visa after entry: apply seven days before expiry, with maximum extensions of 30 or 180 days depending on the visa letter, capped by the original duration of stay.')
) as v(visaai_id, category, official_name, slug, purpose)
on conflict (visaai_id) do update set
  official_name    = excluded.official_name,
  purpose          = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'National Immigration Administration (NIA)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('cn-permanent-residence',
   'https://en.nia.gov.cn/n147423/n147478/n147715/c158291/content.html',
   'Guidelines for Approval of Foreign Nationals'' Eligibility for Permanent Residence in China'),
  ('cn-residence-permit',
   'https://en.nia.gov.cn/n147423/n147478/n147715/c158270/content.html',
   'Service Guide on Issuance of Residence Permit for Foreigners'),
  ('cn-visa-extension-change-reissuance',
   'https://en.nia.gov.cn/n147423/n147478/n147715/c158249/content.html',
   'Guide on Visa Extension, Change and Reissuance for Foreigners')
) as v(visaai_id, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

-- The guide index, registered against the COUNTRY. It is what enumerates the
-- five service guides server-side, and it is the thing that must keep working
-- for China's catalogue claim to stay true.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, null, 'index',
  'National Immigration Administration (NIA)', 1,
  'https://en.nia.gov.cn/n147423/n147478/index.html',
  'https://en.nia.gov.cn/n147423/n147478/index.html',
  'NIA — Guidelines for Foreigners (server-rendered service-guide index)', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_countries c
where c.code = 'CN'
on conflict do nothing;

do $$
declare n_country integer; n_type integer; n_source integer; n_index integer;
begin
  select count(*) into n_country from public.visa_countries
   where code = 'CN' and support_state = 'supported'
     and immigration_authority is not null and fee_currency = 'CNY';
  if n_country <> 1 then
    raise exception 'CN is not registered as a supported country with an authority and a CNY tariff (found %)', n_country;
  end if;

  select count(*) into n_type from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'CN' and t.lifecycle_state = 'active';
  if n_type <> 3 then
    raise exception 'China registers 3 of the 5 guides its index enumerates in this batch, found %', n_type;
  end if;

  select count(*) into n_source from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id like 'cn-%' and s.active;
  if n_source <> 3 then
    raise exception 'Expected 3 active route sources for China, found %', n_source;
  end if;

  select count(*) into n_index from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id
   where c.code = 'CN' and s.visa_type_id is null and s.role = 'index' and s.active;
  if n_index <> 1 then
    raise exception 'China must register its enumerable guide index as a country-level source; found %', n_index;
  end if;

  raise notice 'China registered: 3 routes, 3 sources + 1 index, awaiting sync';
end $$;
