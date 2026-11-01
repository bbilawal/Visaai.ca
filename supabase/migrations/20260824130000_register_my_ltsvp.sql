-- Register Malaysia's Long-Term Social Visit Pass -- Malaysia's second route,
-- and the registry's first pass that lets a spouse WORK WITHOUT CONVERTING.
--
-- THE FINDING
--
-- "the pass holder is permitted to work, engage in business, or undertake
-- professional employment without the need to convert to an employment pass or
-- visit pass (temporary employment)."
--
-- Every other family route in this registry either bars work outright or routes
-- the holder to a separate work pass. Singapore's Dependant's Pass, registered
-- hours ago, is the sharp comparison: a DP holder who wants to work needs an
-- Employment Pass, an S Pass or a DP-Work Permit, applied for by an employer,
-- and getting an EP ends the dependency. Malaysia endorses the permission onto
-- the existing pass and the spouse keeps it.
--
-- The permission is not automatic, though. It is a separate endorsement, it
-- needs a job offer and a stamped employment contract, and the application must
-- be lodged BY THE APPLICANT IN PERSON TOGETHER WITH THE MALAYSIAN SPOUSE.
--
-- NAZIRAN: AN AUTHORITY PUBLISHING ITS OWN INSPECTION REGIME
--
-- "naziran is carried out as a verification activity to ensure that holders of
-- immigration facilities comply with the prescribed conditions. the
-- implementation of naziran may involve visits to the registered address or
-- premises, observation, interviews with relevant parties and review of
-- documents submitted to the department."
--
-- Home visits, observation and interviews, and the findings feed back into
-- approval and extension decisions. No other authority in this registry
-- publishes its post-grant inspection practice on the route page. It is stored
-- as a condition rather than as background, because it is a thing that will
-- happen to the holder.
--
-- CHILDREN OF CITIZENS: UNDER SEVEN
--
-- "applicants must be under 7 years old." A hard age ceiling on the
-- child-of-a-citizen category that has no counterpart in any other family route
-- here -- Singapore's Dependant's Pass runs to 21, Ireland's and Norway's to 18.
--
-- THE PAGE STATES ITS WORK RULES TWICE
--
-- Two blocks -- "conditions and regulations for permission to work" and "terms
-- and conditions of work permit for a citizen spouse" -- cover the same subject
-- in different words, almost certainly an English rendering alongside a
-- translated one. The registry's method for a page that renders requirements
-- twice applies: the blocks were diffed first. They are near-duplicates with no
-- selector between them, so no bound is declared and each requirement quotes
-- the block its wording comes from rather than mixing the two.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'MY'),
  'my-long-term-social-visit-pass', 'spouse_partner',
  'Long-Term Social Visit Pass',
  'long-term-social-visit-pass',
  'Live in Malaysia long-term as the foreign spouse of a Malaysian citizen, or in one of the Immigration Department''s other long-stay categories, with the option of working on the same pass.',
  'active', 'unverified', '2026-08-24'::timestamptz
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
  c.id, t.id, v.role,
  'Jabatan Imigresen Malaysia (Immigration Department of Malaysia)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.imi.gov.my/index.php/en/main-services/pass/visitor-pass/social-visit-pass/long-term-social-visit-pass/',
   'Long Term Social Visit Pass')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'my-long-term-social-visit-pass'
join public.visa_countries c on c.id = t.country_id and c.code = 'MY'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'my-long-term-social-visit-pass' and s.active;
  if n <> 1 then raise exception 'Expected 1 active Immigration Department source, found %.', n; end if;
end $$;
