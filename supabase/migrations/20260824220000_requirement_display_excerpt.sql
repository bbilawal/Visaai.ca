-- BUG_LOG D-11: give the public page the authority's own words to quote.
--
-- THE DEFECT
--
-- Every requirement in this registry exists only because it is bound to a
-- verbatim government quote. `generate-requirements.mjs` refuses to emit one
-- without an excerpt, four scripts verify them, every promotion migration
-- asserts them -- and the applicant was shown none of it. The web query never
-- selected `source_excerpt`, so the public page rendered VisaAI's own label and
-- description while the evidence sat in this table.
--
-- WHY THE ONE-LINE FIX WOULD HAVE BEEN WORSE
--
-- `normalizeContent` lowercases, and it is right to: a CMS restyling a heading
-- from "Fees" to "FEES" has not changed the law, and the monitor must not wake
-- anybody for that. The consequence is that `source_excerpt` reads
--
--   you must: have a valid travel document , like a passport
--
-- where IRCC published
--
--   You must: have a valid travel document, like a passport
--
-- Selecting that column and rendering it between quotation marks would put our
-- lowercasing AND the space an inline <a> tag left before the comma inside a
-- quotation attributed to a government. Misquoting an authority in the very
-- feature built to prove we quote them is a worse defect than showing no quote.
--
-- SO THE TEXT IS STORED TWICE, FOR TWO DIFFERENT JOBS
--
--   source_excerpt          the MATCHING text. Lowercased, whitespace-collapsed,
--                           byte-identical to what verify-excerpts.ts,
--                           verify-extraction-bounds.ts and the change detector
--                           compare against. UNCHANGED by this migration --
--                           nothing about verification moves.
--
--   source_excerpt_display  the QUOTING text. Same span of the same page, with
--                           the authority's capitalisation, derived by
--                           scripts/derive-display-excerpts.ts.
--
-- The derivation is exact rather than a second guess: `.toLowerCase()` is the
-- last operation in `normalizeContent`, so the lowercased and case-preserving
-- normalizations of a page correspond character-for-character. The script finds
-- an excerpt's offset in the lowercased text -- the same search verify-excerpts
-- runs -- and slices the case-preserving text at that offset. It REFUSES if the
-- two are not the same length, and a refusal leaves this column NULL.
--
-- NULL IS A REAL AND CORRECT STATE
--
-- It means "we could not establish the authority's own wording for this line",
-- and the page must then render NO quotation rather than falling back to the
-- lowercased text. That fallback is precisely the defect being fixed, which is
-- why this column is nullable and why nothing here backfills it from
-- source_excerpt.

alter table public.visa_requirements
  add column if not exists source_excerpt_display text;

comment on column public.visa_requirements.source_excerpt_display is
  'The excerpt with the authority''s own capitalisation, for QUOTING on the '
  'public page. Derived from the same span of the same page version as '
  'source_excerpt by scripts/derive-display-excerpts.ts. NULL means the '
  'authority''s wording could not be established, and the page must then render '
  'no quotation rather than quoting the lowercased matching text. Never '
  'back-fill this from source_excerpt.';

comment on column public.visa_requirements.source_excerpt is
  'The MATCHING text: normalized and lowercased exactly as the monitor produces '
  'it, so verify-excerpts.ts, verify-extraction-bounds.ts and the change '
  'detector all compare like with like. Not for display -- see '
  'source_excerpt_display.';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'visa_requirements'
      and column_name = 'source_excerpt_display'
      and character_maximum_length is not null
  ) then
    raise exception 'source_excerpt_display should be unbounded text, matching source_excerpt.';
  end if;
end $$;

-- Same ceiling as the matching excerpt: an excerpt longer than this is not a
-- quotation, it is a copy of the page.
alter table public.visa_requirements
  drop constraint if exists visa_requirements_display_excerpt_len;
alter table public.visa_requirements
  add constraint visa_requirements_display_excerpt_len
  check (source_excerpt_display is null or char_length(source_excerpt_display) <= 4000);
