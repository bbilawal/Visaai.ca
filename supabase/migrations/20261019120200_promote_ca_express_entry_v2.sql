-- Promote the Express Entry documents (v2).
-- Date: 2026-10-19
--
-- Apply IMMEDIATELY after 20261019120100_req_ca_express_entry_v2.sql. That file
-- inserts nine new rows as 'draft' and demotes `documents_to_get_ready` to
-- 'draft' (its kind changed -- the generator's DEMOTE ON CHANGE rule), and the
-- application checklist reads only 'active' rows.
--
-- WHAT WAS WRONG, AND WHAT THIS APPROVES
--
-- ca-express-entry had no document slots of its own. Its single `evidence`
-- row was the landing page's summary line ("get your documents ready language
-- test, education, job offer, funds, police certificates") -- a pointer, not a
-- document, so the checklist got one unactionable "Get your documents ready"
-- slot and every real document came from the 9-21s discovery LLM call.
--
--   * documents_to_get_ready: evidence -> condition. Same reclassification as
--     20260821510000_promote_reclassified_pointers.sql. Its quote is unchanged.
--   * Nine `evidence` rows, each quoted from IRCC's get-your-documents-ready
--     page (role `documents`, registered by 20261019120000, page dated
--     2026-10-16), whose list opens "You may need information from some or
--     all of these documents when you create a profile:".
--       required (no qualifier on the page):
--         passport_or_travel_document, language_test_results,
--         proof_of_work_experience, proof_of_funds, police_certificates
--       optional (officially_required = false; the page qualifies them):
--         education_credential_proof   "if: you're applying through the
--                                       federal skilled workers program, or
--                                       you want to get points for the
--                                       education you got outside canada"
--         written_job_offer            "(if you have one)"
--         trade_certificate_of_qualification "(if you have one)"
--         provincial_nomination        "(if you applied for the provincial
--                                       nominee program)"
--     None carries a rule: VisaAI has no fact for the Express Entry program,
--     a job offer, a trade certificate or a nomination, and a rule on an
--     unknown fact would keep the row off the checklist entirely.
--
-- Every excerpt was re-checked against the live pages on 2026-10-19 with
-- scripts/verify-excerpts.ts --require-readable (26/26 verbatim),
-- scripts/verify-quotes-against-raw.ts (26/26) and scripts/check-excerpt-shape.ts
-- (0 rejected); display excerpts derived with scripts/derive-display-excerpts.ts.
--
-- Apply (not applied by this PR):
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Rollback: rollback/20261019120200_ca_express_entry_v2.down.sql

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-10-19'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-express-entry' and r.status = 'draft';

do $$
declare bad int;
begin
  select count(*) into bad from public.visa_requirements
  where status = 'active'
    and (source_version_id is null or source_excerpt is null or source_excerpt = ''
         or (kind = 'recommended' and officially_required));
  if bad > 0 then raise exception '% active requirement(s) lack provenance.', bad; end if;
end $$;

do $$
declare docs int; required_docs int; total int; pointer_kind text;
begin
  select count(*) filter (where r.kind = 'evidence'),
         count(*) filter (where r.kind = 'evidence' and r.officially_required),
         count(*)
    into docs, required_docs, total
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-express-entry' and r.status = 'active';
  if total <> 26 then raise exception 'Expected 26 active Express Entry requirements, found %.', total; end if;
  if docs <> 9 then raise exception 'Expected 9 Express Entry documents, found %.', docs; end if;
  if required_docs <> 5 then raise exception 'Expected 5 required Express Entry documents, found %.', required_docs; end if;

  select r.kind into pointer_kind
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-express-entry' and r.requirement_code = 'documents_to_get_ready'
    and r.status = 'active';
  if pointer_kind is distinct from 'condition' then
    raise exception 'documents_to_get_ready must be a condition, found %.', pointer_kind;
  end if;
end $$;
