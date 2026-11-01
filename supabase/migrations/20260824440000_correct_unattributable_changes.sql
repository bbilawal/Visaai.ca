-- Correct change records that describe a diff that was never computed.
--
-- Every change this system has filed was classified by comparing the live page
-- against the empty string, because `normalizedTextOf()` returned '' whenever it
-- could not find a `storage_path` and nothing has ever written one. The result
-- is uniform and checkable: 127 records, 127 with an empty `removed` array, 125
-- classified `material` and awaiting human review.
--
-- What those records currently tell a reviewer is not a small overstatement.
-- They say things like "375 line(s) added, 0 removed. Flagged: a route may have
-- been discontinued; a fee changed; a monetary amount changed" — on pages where
-- nothing of the sort happened. The flags come from words present somewhere in
-- the full page text, because the full page WAS the diff.
--
-- A reviewer acting on one of these goes looking for a fee change that does not
-- exist. That is worse than no signal at all, so the false parts are removed:
--
--   escalation_reasons  -> {}     they were drawn from the page, not a change
--   summary             -> states plainly that it cannot be characterised
--   diff.unattributable -> true   so a query can find them later
--
-- What is NOT changed:
--
--   requires_review stays true. A content change really was detected by hash;
--   only its description was fiction, and dropping the human gate because the
--   description was wrong would be the opposite of the right lesson.
--
--   The original summary and reasons are preserved inside the diff payload.
--   The point is to stop misleading a reviewer, not to erase what the system
--   said — these records are the evidence for the bug.

do $$
declare
  affected integer;
begin
  with target as (
    select id from public.visa_source_changes
     where jsonb_array_length(coalesce(diff->'removed', '[]'::jsonb)) = 0
       and (diff->>'unattributable') is distinct from 'true'
  )
  update public.visa_source_changes c
     set escalation_reasons = '{}',
         summary =
           'Content changed, but the previous version''s text was not retained, so '
           'the change cannot be characterised. This record''s original classification '
           'was produced by diffing against an empty string (B-29): every line counted '
           'as added and the flags came from words in the whole page rather than from '
           'anything that changed. Compare against the authority''s page directly. '
           'Versions filed from 2026-08-24 onward retain their text.',
         diff = coalesce(c.diff, '{}'::jsonb) || jsonb_build_object(
           'unattributable', true,
           'corrected_at', now(),
           'original_summary', c.summary,
           'original_escalation_reasons', to_jsonb(c.escalation_reasons)
         ),
         updated_at = now()
    from target t
   where c.id = t.id;

  get diagnostics affected = row_count;
  raise notice 'corrected % unattributable change record(s)', affected;

  -- Assert the claim this migration rests on: that no corrected record carried
  -- a real removal. If one had, the diff worked at least once and this would be
  -- overwriting a genuine result.
  if exists (
    select 1 from public.visa_source_changes
     where (diff->>'unattributable') = 'true'
       and jsonb_array_length(coalesce(diff->'removed', '[]'::jsonb)) > 0
  ) then
    raise exception 'a corrected record carried real removed lines — do not overwrite it';
  end if;
end $$;
