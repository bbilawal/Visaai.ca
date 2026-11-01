# Forms stage — change + full country×visa verification

Run date: 2026-08-16 · local Supabase stack + real API (`:4200`) + real `gpt-4o` prefill graph.

## 1. What changed in the product

| Change | Where |
|---|---|
| "Generate official documents" button deleted | `apps/web/app/[locale]/(dashboard)/documents/[applicationId]/generate-official.tsx` (+ its test) removed; usage dropped from `documents-client.tsx` |
| Official forms/checklist sections now reveal on the completion rule itself (`documentsCompletion(checklist).complete`, or an existing prefill) instead of on a button press | `documents-client.tsx` |
| Handoff card to the Forms stage now shows as soon as a checklist exists (it is the only route to the stage from this page now) | `documents-client.tsx` |
| Stage renamed **Prefill → Forms**, page title → "Your application forms" | `apps/web/messages/*.json` (15 locales) |
| Stage order: **Forms is now 4th, Readiness 5th** | `packages/types/src/index.ts` (`STAGE_ORDER`), `apps/web/components/layout/stage-nav.tsx` |
| Dead i18n keys from the deleted button removed | `documents.officialSectionTitle`, `officialLockedHint`, `officialReadyHint`, `generateOfficial`, `generatingOfficial`, `regenerateOfficial`, `officialGenerated`, `errGenerate`, `reviewPrefilled` in all 15 locales |

Nothing else moved: the route stays `/prefill/<id>` (bookmarks, the Chrome extension and the API contract keep working), and generation still happens automatically server-side once every required document is verified (`PrefillService.autoGenerateIfReady`), with Regenerate available on the Forms page.

## 2. Bug found and fixed during testing (pre-existing, unrelated to the rename)

**The Documents stage could never complete, so Submit stayed locked forever.**

`documentsCompletion()` excludes checklist items of `meta.kind === 'form'` (a blank government form is not evidence the applicant uploads). But `ProgressService.forApplication` and the web `loadProgress()` both selected only `status, required` — `meta` never arrived, so the exclusion could not fire. Any application carrying a required form item (IMM 5257, SCHENGEN-C, I-130, 1415 — i.e. most of the catalogue) reported:

- Documents stage stuck below 100% (67% in the fixture), "Next step: upload your required documents" forever, and
- `locked.submission = !isComplete.documents` → **the Submit stage permanently locked**.

Fixed in `progress.service.ts`, `apps/web/lib/progress.ts` (select + pass `meta`) and `packages/types/src/index.ts` (percentage and completeness now derive from one `requiredDocumentItems()` list). Regression tests: `apps/api/test/progress.spec.ts`.

Verified across the matrix: 71/71 applications now report `documents=complete/100%` and `submission=available`.

## 3. Country × visa matrix — 71/71 pass

Every selectable destination country and every visa program it registers, driven through the real endpoints with a distinct synthetic applicant per scenario (intake profile, account details, verified checklist, and dummy documents whose OCR output is written to `document_verifications` exactly as the pipeline writes it).

- **33 countries** (CA, US, GB, AU + 29 Schengen members) × **6 program types** = **71 pairs**, all executed.
- **2,062 fields** generated (24–34 per application).
- `POST /prefill/:id/generate` → 201 in 71/71.
- Persist + edit: `GET /prefill/:id` returns the stored payload; `PATCH .../fields` round-trips an edited value in 71/71.
- Official forms list matches what the program requires in 71/71 (`IMM 5257`, `IMM 5645`, `IMM 1294`, `IMM 1295`, `I-130`, `1415`, `SCHENGEN-C`).
- Paywall: unpaid PDF download → **402** in 71/71; after a completed `prefill` payment → **200** with real `%PDF` bytes in 71/71.
- Stage order returned by `/progress/:id` is `intake > documents > narrative > prefill > readiness > submission` in 71/71.

### Accuracy audit (no hallucinations found)

Every non-empty field value was checked against the data actually supplied to that applicant (profile + account + each document's extraction), plus checks for placeholder text, prompt/secret leakage, approval guarantees, and legal advice.

- **2,058 filled values re-audited under the strict rule** (ground-truth tokens < 4 chars ignored, so the check can actually fail): **1 ungrounded value** — `country_of_residence = "Hungary"` expanded from the account's ISO-2 `HU`, which the system prompt explicitly asks for. No fabricated passport numbers, dates, employers, or addresses.
- **0 cross-contamination**: no applicant's passport number, surname or employer appeared in another applicant's form.
- **0** placeholder/guarantee/prompt-leak hits.

### Known, correct limitation

The stamped **official** government PDF (`/prefill/:id/official-pdf/IMM 5257`) returned **503** in all 3 attempts. That is the designed outcome, not a break: IRCC's IMM 5257 is dynamic XFA with 0 AcroForm fields, so `pdf-lib` cannot fill it and the renderer honestly returns null. The Forms page falls back to the summary PDF and tells the user. Only IMM 5257 has a registered renderer today; every other form code reports `official_supported: false` in the UI.

## 4. Browser check — 15/15

Real Chromium against the dev server, logged in as a seeded applicant:

- Stage nav reads `Intake > Documents > Generate > **Forms** > Readiness > Submit`; "Prefill" appears nowhere.
- Forms page: title "Your application forms", 24 editable fields, Save edits, `Unlock — $29`, official government forms section listing IMM 5257.
- Documents page: **no "Generate official documents" button**, official reference sections shown, link to the Forms stage present.
- Readiness page still loads at position 5.
- No console errors, no failed requests, no 4xx/5xx (the `/analytics/collect` 429s are that route's own 30/min limit tripping under scripted load).

Screenshots: `results/screenshots/`.

## 5. Regression suites

| Suite | Result |
|---|---|
| `apps/api` jest | 2,792 tests, 378 suites — pass |
| `apps/web` vitest | 303 tests, 63 files — pass |
| `apps/api` tsc | clean |
| `apps/web` tsc | clean |

New tests: `apps/web/components/layout/stage-nav.test.tsx` (nav order must equal `STAGE_ORDER`, Forms 4th, labels resolve) and two cases in `apps/api/test/progress.spec.ts` (a required form must not block Documents; stage order is locked).

## 6. How to re-run

```bash
npx supabase@latest start                       # local stack
docker run -d --rm --name qa-redis-prefill -p 6399:6379 redis:7-alpine
pnpm --filter api build
source qa/prefill-matrix/api-env.sh             # neutralises Stripe/Upstash/SMTP
node apps/api/dist/main.js &                    # :4200
node qa/prefill-matrix/build-matrix.mjs         # matrix straight from the strategy registry
node qa/prefill-matrix/run-prefill-matrix.mjs   # 71 scenarios (real gpt-4o calls)
node qa/prefill-matrix/reaudit-grounding.mjs    # strict hallucination pass over saved payloads

# browser check
(cd apps/web && npx next dev -p 3100) &
node qa/prefill-matrix/seed-ui-fixture.mjs
node qa/prefill-matrix/run-ui-check.mjs
```

Artifacts: `results/ledger.jsonl` (per scenario), `results/summary.json`, `results/payloads/<COUNTRY>-<program>.json` (persona + generated form), `results/grounding-reaudit.json`, `results/ui-check.json`.

Note: `qa/visaai-autonomous-e2e/harness/qa-env.sh` was also fixed — it read the service-role key under the old container variable name and silently exported an empty string, which made the API refuse to boot.

## 7. Not covered

- Real file upload → storage → OCR → verification: documents are seeded at the `document_verifications` layer (which is exactly what prefill reads). The upload path itself was not exercised.
- Payments were seeded directly in the `payments` table; Stripe checkout was neutralised for the run.
- Translations for the 14 non-English locales were updated for the stage name and page title only; other copy that mentions the stage by name is unchanged.
