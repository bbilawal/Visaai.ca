-- One more US source, and the reason is worth recording because it is a rule
-- about how sources bind, not a typo.
--
-- `us-transiting-the-united-states` quotes the USCIS "Extend Your Stay" page
-- for the single most consequential fact about transit that any readable DHS
-- page states: a person admitted in transit, on a C visa or without one, may
-- not apply to extend their stay. A missed connection cannot be regularised.
--
-- That page was registered against the VISITOR route only. `visa_sources` is
-- unique on (source_url, visa_type_id) precisely so a shared government page
-- can serve several routes with a row each, and the requirements generator
-- binds a quote to the version of the source registered FOR THAT VISA TYPE.
-- So the transit migration failed on a NOT NULL for source_version_id: the
-- page had an active version, just not one this route could see.
--
-- The failure is the design working. Silently accepting the visitor route's
-- version would attach a transit requirement to a source nobody registered for
-- transit, and the change monitor would then never tell the transit route when
-- that page changed.

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'application',
  'U.S. Citizenship and Immigration Services', 1,
  'https://www.uscis.gov/visit-the-united-states/extend-your-stay',
  'https://www.uscis.gov/visit-the-united-states/extend-your-stay',
  'Extend Your Stay', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id
where t.visaai_id = 'us-transiting-the-united-states'
on conflict do nothing;

do $$
declare n integer;
begin
  select count(*) into n
    from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id = 'us-transiting-the-united-states'
     and s.source_url = 'https://www.uscis.gov/visit-the-united-states/extend-your-stay';
  if n <> 1 then
    raise exception 'Expected exactly 1 extend-your-stay source on the transit route, found %', n;
  end if;
end $$;
