-- Promote the final three Austrian routes. Austria reaches 11 live routes.
--
-- Three assertions beyond provenance:
--
--   Other key workers must keep BOTH language options. The page accepts German
--   at A1-B1 or English at A2-B1, and dropping the English half would tell an
--   applicant they need German when they do not.
--
--   Family reunification must keep the newborn waiver intact. It is narrow and
--   time-bound — a first application within six months of birth — and a
--   requirement stated without it would send a parent looking for a passport
--   the child cannot have.
--
--   Other forms of settlement must keep its two thresholds SEPARATE. A1 German
--   and five years' uninterrupted residence belong to different titles in the
--   group, and merging them would invent a route requiring both.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-25'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id in ('at-rwr-other-key-workers','at-family-reunification','at-other-forms-of-settlement')
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-25'::timestamptz
 where t.visaai_id in ('at-rwr-other-key-workers','at-family-reunification','at-other-forms-of-settlement')
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_bad integer; n_pages integer;
  n_lang integer; n_waiver integer; n_a1 integer; n_five integer; n_at_pages integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('at-rwr-other-key-workers','at-family-reunification','at-other-forms-of-settlement')
     and r.status = 'active';
  if n_active <> 16 then raise exception 'Expected 16 active requirements, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('at-rwr-other-key-workers','at-family-reunification','at-other-forms-of-settlement')
     and r.status='active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% requirement(s) lack provenance or a display quotation', n_bad; end if;

  select count(*) into n_pages from public.visa_publishable_pages
   where visaai_id in ('at-rwr-other-key-workers','at-family-reunification','at-other-forms-of-settlement');
  if n_pages <> 3 then raise exception 'Expected 3 publishable pages, found %', n_pages; end if;

  -- Both language options, or the English half disappears.
  select count(*) into n_lang from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-other-key-workers' and r.status='active'
     and r.source_excerpt like '%for german%' and r.source_excerpt like '%for english%';
  if n_lang <> 1 then
    raise exception 'Other key workers must quote BOTH the German and English language options; found %', n_lang;
  end if;

  -- The newborn waiver must survive intact.
  select count(*) into n_waiver from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-family-reunification' and r.status='active'
     and r.source_excerpt like '%waived%' and r.source_excerpt like '%six months after birth%';
  if n_waiver <> 1 then
    raise exception 'The newborn travel-document waiver must be quoted intact; found %', n_waiver;
  end if;

  -- Two thresholds, two requirements. Never merged.
  select count(*) into n_a1 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-other-forms-of-settlement' and r.status='active'
     and r.source_excerpt like '%a1 level%';
  select count(*) into n_five from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-other-forms-of-settlement' and r.status='active'
     and r.source_excerpt like '%last five years without interruption%';
  if n_a1 <> 1 or n_five <> 1 then
    raise exception 'The A1 and five-year thresholds must each appear exactly once (found % and %)', n_a1, n_five;
  end if;

  -- Austria's total, guarding against the occupation lists creeping in as routes.
  select count(*) into n_at_pages from public.visa_publishable_pages p
    join public.visa_types t on t.visaai_id = p.visaai_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'AT';
  if n_at_pages <> 11 then
    raise exception 'Austria should publish 11 pages, found %', n_at_pages;
  end if;

  raise notice 'Austria COMPLETE: 11 routes, all publishable, % requirements in this batch', n_active;
end $$;
