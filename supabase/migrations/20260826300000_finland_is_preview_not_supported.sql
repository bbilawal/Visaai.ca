-- Finland has been marked `supported` while publishing nothing.
--
-- WHAT THE REGISTRY ACTUALLY HOLDS FOR FINLAND
--
--   5 visa types, 12 registered sources, 0 source versions, 0 requirements.
--
-- Not one Finnish page has ever been fetched from production egress. migri.fi
-- WAF-challenges the VPS — 403 on everything including robots.txt — so the sync
-- has never had anything to store. The types and the source URLs came from
-- research; the CONTENT never arrived.
--
-- `supported` is defined in the core migration as "VisaAI has verified data and
-- serves this destination". Finland has no verified data. New Zealand was held
-- at `preview` for having only ONE extracted visa type, on the reasoning that
-- claiming otherwise "would be the same unearned claim the registry exists to
-- prevent". Finland has zero, and carries the stronger claim. That is backwards.
--
-- WHY `preview` AND NOT `unsupported`
--
-- Finland is not out of scope, and the hub is not empty in the way an
-- unresearched country's would be. It carries a real authority, five real visa
-- types and twelve official source links — and those links work for a HUMAN,
-- because it is our datacentre IP that Migri refuses, not the public. Sending a
-- reader to Migri with the right route names is useful and true. Claiming we
-- have read Finland's requirements is neither.
--
-- This is the same judgement applied on 2026-08-26 to the eighteen countries
-- that could not be published: the label has to describe what is actually
-- there. It is applied here against our own favour rather than to justify a
-- refusal, which is the only way it stays a principle.

update public.visa_countries
   set support_state = 'preview'
 where code = 'FI'
   and not exists (
     select 1 from public.visa_publishable_pages p where p.country_code = 'FI'
   );

do $$
declare
  n_bad integer;
  r record;
begin
  -- THE INVARIANT THIS VIOLATED, now asserted for every country at once.
  -- Nothing in the schema prevented `supported` with zero publishable pages,
  -- which is how Finland sat mislabelled through several coverage reviews: the
  -- count of "supported destinations" read as coverage and one of them was
  -- empty.
  select count(*) into n_bad
    from public.visa_countries c
   where c.support_state = 'supported'
     and not exists (
       select 1 from public.visa_publishable_pages p where p.country_code = c.code
     );

  if n_bad > 0 then
    for r in
      select c.code, c.name from public.visa_countries c
       where c.support_state = 'supported'
         and not exists (
           select 1 from public.visa_publishable_pages p where p.country_code = c.code
         )
       order by c.code
    loop
      raise warning 'supported but publishes nothing: % (%)', r.name, r.code;
    end loop;
    raise exception
      '% country/countries claim support_state=supported while publishing no pages. '
      'A supported destination must publish at least one page, or the label is a claim '
      'nothing backs.', n_bad;
  end if;

  raise notice 'Finland held at preview; every supported country publishes at least one page.';
end $$;
