# Product improvements — user-effort reduction

Each entry: what the applicant had to do, why, what changed, and what is
actually proven.

---

## PI-1 — document facts now reach the intake chat

**Before.** The applicant uploaded a passport. OCR read their name, date of
birth, nationality, passport number and place of birth. Those values went into
`document_verifications` and stopped there. The intake chat builds its questions
from `application_profiles.profile_json`, so it never saw them and asked for
each one conversationally — with the answers already in the database. Same for
an employment letter (employer, job title) and an admission letter (institution,
programme, start date).

**Why.** Four disconnected stores of applicant data, and the AI pipeline read
only one of them.

**After.** A `sync_profile` node folds the extraction into the profile at the end
of the document pipeline. The chat's existing "don't ask what you already know"
instruction now has something to work with.

**Effort removed.** Up to ~6 fields per passport, 3-5 per employment document,
3-5 per admission letter — for any applicant who uploads before finishing intake.

**Limits, stated plainly.** Gap-fill only: a value the applicant already gave is
never overwritten. Currency-bearing fields are deliberately excluded — a
payslip's `monthly_income` is in its own currency and the profile field is
`*_usd`. Not yet observed against real production data (see BLK-2).

---

## PI-2 — the prefilled form now knows the applicant's contact details

**Before.** The applicant typed their name and nationality in onboarding, and
their phone and full postal address in Settings. The prefilled government form
came back with Contact and Address blank — a section the generator is explicitly
told to fill — so they typed all of it again during review.

**Why.** All four pipeline modules that read `users` selected `preferred_language`
and nothing else. `user_profiles` was read by no pipeline module at all.

**After.** `load-context` loads both into an `accountProfile` block.

**Effort removed.** Up to 9 fields per form, per application, for any user who
filled in those screens.

**Limits.** Best-effort: an RLS refusal or a missing column costs pre-filled
fields, never the form. Not yet observed against production data.

---

## PI-3 — every uploaded document reaches the form generator

**Before (fixed earlier the same day, recorded here for completeness).** Prefill
walked the top-level keys of `details_json` and skipped keys it had seen. The
whole extraction arrived nested under one key, that key was then "taken", and
**every document after the first was discarded**. Upload a passport, a bank
statement, an admission letter and a birth certificate, and only the passport
reached the generator.

**After.** All documents merge; conflicts are preserved under
`<document_type>_<key>` rather than dropped.

---

## PI-4 — non-identity documents extract at all

**Before.** Production OCR used Azure `prebuilt-idDocument` for every upload,
which returns identity fields only. A bank statement, admission letter, birth
certificate or deed produced nothing.

**After.** Type-aware routing: identity documents keep the cheaper dedicated
model; everything else uses `prebuilt-layout` + queryFields, in-region.
Validated live: a synthetic bank statement returned holder, bank, account
number, balance, currency and statement period.

**Limits.** Query fields are a premium Azure add-on billed per request.

---

## PI-5 — the documents page leads with the applicant's task

**Before.** The page opened with government reference material, pushing the
applicant's own uploads below the fold, and offered no sense of progress.

**After.** Progress and next action first, uploads next, official material
behind a Generate gate that unlocks when every required document is verified.

**Limits.** The unlocked state has not been seen against real data — no
production application has a complete checklist yet.
