-- Retain each version's normalized text, so a change can actually be diffed.
--
-- WHAT WAS WRONG
--
-- `VisaSyncService.normalizedTextOf()` fetched the previous version's
-- `storage_path`, downloaded it from the `visa-sources` bucket, and normalized
-- it. If there was no path it returned the empty string.
--
-- Nothing has ever written `storage_path`: 0 of 283 version rows carry one. So
-- every change in the system's history was classified by comparing the live
-- page against "". Every line counted as ADDED, nothing was ever REMOVED, and
-- the escalation flags — "a fee changed", "a route may have been discontinued",
-- "a monetary amount changed" — fired on words found anywhere in the whole page
-- rather than in anything that changed.
--
-- The evidence is unambiguous: 127 change records, 127 with an empty `removed`
-- array, 125 of them classified `material` and requiring human review. The
-- daily monitor's entire purpose is to answer "what changed on this government
-- page", and it has never once answered it. It has been re-reporting whole
-- pages and alarming on their vocabulary.
--
-- WHY A COLUMN
--
-- The bucket path stays supported by the reader, but a column removes the
-- failure mode itself: there is no separate write that can be forgotten. The
-- text is a normalized rendering of a public government page held for internal
-- comparison — not redistribution, which §9 governs separately.

alter table public.visa_source_versions
  add column if not exists normalized_text text;

comment on column public.visa_source_versions.normalized_text is
  'Normalized page text as of this version, retained so the NEXT version can be '
  'diffed against it. Null on versions filed before 2026-08-24, which is why a '
  'change against one of those must report that it cannot be characterised '
  'rather than treating the whole page as new.';

-- Historical rows are deliberately left null. The text they held was never
-- stored and cannot be reconstructed, and back-filling them with today's page
-- would be worse than a gap: it would assert that the old version said what the
-- current one says, quietly erasing whatever really changed.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'visa_source_versions' and column_name = 'normalized_text'
  ) then
    raise exception 'normalized_text was not added to visa_source_versions';
  end if;
  raise notice 'visa_source_versions.normalized_text is present';
end $$;
