# Future high-value ideas

Written from evidence found during the improvement run. Deliberately NOT
implemented — each needs a product decision, a migration, or budget.

## Validated, deferred — high confidence, meaningful work

### F-1. Carry the profile forward to a second application
`intake.service.ts:75-88` inserts an EMPTY `application_profiles` row for every
new application, with no lookup of the same user's existing ones. A user filing
a second application re-runs the whole intake interview (up to 15-20 turns),
including facts with no bearing on the new destination.

*Why deferred:* needs a product decision on which keys are destination-agnostic
(identity, family, employment history) versus destination-specific (purpose,
dates, ties), and on whether stale facts should be re-confirmed rather than
silently reused. Reusing an 18-month-old salary without asking would be worse
than asking again.

### F-2. Reusable documents across applications
Storage paths are `${userId}/${applicationId}/...`, hard-scoped per application,
and nothing looks for a still-valid document from a previous one. A passport
valid for eight years is re-uploaded and re-OCR'd for every application.

*Why deferred:* needs a document-validity model (issue/expiry, which visa
categories accept it, whether a newer one is required) and a migration.

### F-3. A family/dependant record
No `family_members` table exists. Spouse and children are re-described in free
text per application, even though the extractor already pulls `spouse_name`,
`father_name` and `mother_name` off certificates with nowhere durable to put
them.

*Why deferred:* schema design plus a privacy decision — a dependant's data has
its own ownership and deletion semantics.

## Requires a product decision

### F-4. Show provenance in the UI
The data now exists to say where a value came from — user-typed, OCR-extracted,
account profile, or AI-inferred — and `documentFieldsByType` already carries
document attribution. Surfacing it would let an applicant see *why* a field is
filled and what to double-check. Needs design.

### F-5. Conflict detection between documents
`collectDocumentFields` already preserves conflicting values under
`<document_type>_<key>` instead of dropping them. Nothing yet surfaces the
conflict to the user. The data is sitting there.

## Requires external credentials or budget

### F-6. Adversarial-document test corpus
See BLK-3.

### F-7. In-region extraction quality benchmark
The Azure queryFields path has been exercised on one synthetic bank statement.
A proper benchmark across document types and languages needs a labelled corpus
and Azure spend.

## Considered and NOT recommended

### F-8. Auto-accepting OCR values as authoritative
Tempting, and wrong. The extractor already returns plausible-but-absent values
when asked leading questions — a synthetic bank statement produced
`nationality: "CANADA"` inferred from the bank's name. Gap-fill plus user review
is the correct posture; a confidence score would not fix it.

### F-9. Approval-probability scoring
Do not imply a government approval likelihood without a validated model and a
legal basis. The existing readiness score is deterministic completeness, which
is honest; a probability would not be.
