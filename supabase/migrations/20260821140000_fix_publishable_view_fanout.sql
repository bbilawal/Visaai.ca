-- Fix a cartesian fan-out in visa_publishable_pages.
--
-- THE DEFECT
--
-- The view joins visa_types to BOTH visa_requirements and visa_sources:
--
--   left join public.visa_requirements r on r.visa_type_id = t.id
--   left join public.visa_sources      s on s.visa_type_id = t.id
--
-- Two independent one-to-many joins from the same row multiply. Each
-- requirement appears once per source, so the grouped
-- `count(r.id) filter (...)` counts the product, not the requirements.
--
-- It was invisible while every visa type had zero requirements — 0 x 6 is 0 —
-- and surfaced the moment the first real extraction landed: Canada's visitor
-- visa has 17 official requirements and 6 sources, and the view reported
-- **102**.
--
-- That number is not internal. The visa page renders it to the applicant
-- ("VisaAI tracks N official requirements for it") and the metadata
-- description uses it. It would have shipped as a visibly absurd claim on the
-- first page the product ever published.
--
-- `source_count` was already `count(distinct s.id)` and was correct throughout,
-- which is why only one of the two counts was wrong.
--
-- THE FIX
--
-- `count(distinct r.id)`. The HAVING clause counts the same way, so the
-- publication gate itself was never wrong about WHETHER to publish — only
-- about the number it reported.

create or replace view public.visa_publishable_pages
with (security_invoker = true) as
select
  c.code                              as country_code,
  c.slug                              as country_slug,
  c.name                              as country_name,
  t.id                                as visa_type_id,
  t.visaai_id,
  t.slug                              as visa_slug,
  t.official_name,
  t.category,
  -- DISTINCT: r fans out across s. See the note above.
  count(distinct r.id) filter (where r.status = 'active' and r.officially_required)
                                      as official_requirement_count,
  count(distinct s.id) filter (where s.active)
                                      as source_count,
  max(greatest(coalesce(t.last_verified_at, 'epoch'::timestamptz),
               coalesce(c.last_verified_at, 'epoch'::timestamptz)))        as last_verified_at
from public.visa_countries c
join public.visa_types t on t.country_id = c.id
left join public.visa_requirements r on r.visa_type_id = t.id
left join public.visa_sources s on s.visa_type_id = t.id
where c.support_state = 'supported'
  and t.lifecycle_state = 'active'
group by c.code, c.slug, c.name, t.id, t.visaai_id, t.slug, t.official_name, t.category
having count(distinct r.id) filter (where r.status = 'active' and r.officially_required) > 0
   and count(distinct s.id) filter (where s.active) > 0;

comment on view public.visa_publishable_pages is
  'The ONLY definition of an indexable visa page: supported country, active '
  'visa type, at least one active official requirement, at least one active '
  'official source. Sitemap, renderer and quality report all read this. '
  'Counts are DISTINCT — requirements and sources are independent one-to-many '
  'joins from visa_types and fan out against each other.';
