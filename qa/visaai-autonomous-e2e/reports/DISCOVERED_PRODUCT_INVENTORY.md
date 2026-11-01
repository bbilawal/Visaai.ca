# VisaAI — Discovered Product Inventory

**Run:** `visaai-e2e-20260812` · **Git HEAD:** `bc28ea6` (branch `main`)
**Discovered:** 2026-08-12 · **Source of truth:** the running product, not assumptions.

Everything below was read out of the live backend strategy registry, the API's
own public endpoints, the Supabase schema, and the rendered UI. Nothing here is
inferred from documentation.

---

## 1. How the product is actually shaped

This matters more than the raw counts, because it changes what "test every visa
category" can mean.

**The user never picks a visa category.** The only journey entry point,
`/[locale]/applications/new`, asks for exactly two things:

| Field | Required | Source |
|---|---|---|
| Destination country | yes | `GET /countries` (live from the strategy registry) |
| State / province | no | free text |

`POST /intake/applications` then creates an `applications` row carrying
`destination_country` + `destination_state` and **no visa program at all**. The
visa category is decided afterwards, by an LLM, during the intake interview —
`supabase/migrations/20260601000001_application_destination.sql` states the
intent outright: *"users can start an application without pre-committing to a
specific visa framework. The intake agent now operates in discovery mode."*

**Consequence for this mission:** the country × visa-category matrix cannot be
driven by selecting a category in the UI. Each cell has to be reached by
steering a natural-language interview, and whether the product lands on the
intended category is itself a test result rather than a precondition.

### The journey

`Intake → Documents → Generate → Readiness → Prefill → Submit`

Stage 1 (Intake) is a WebSocket chat (`IntakeGateway`) backed by a LangGraph
state machine. Stages 2-6 are gated behind sign-in for guest users
("Sign in to unlock"). Intake itself is login-free: `ensureSession()` mints an
anonymous Supabase identity.

---

## 2. Destination countries — 33 selectable

Derived live from `strategyRegistry.listCountries()` and confirmed against
`GET /countries` (both return 33).

**Priority corridors (pinned, fixed order):** AU, US, CA, GB

**Schengen members (29, alphabetical):** AT Austria, BE Belgium, BG Bulgaria,
HR Croatia, CZ Czech Republic, DK Denmark, EE Estonia, FI Finland, FR France,
DE Germany, GR Greece, HU Hungary, IS Iceland, IT Italy, LV Latvia,
LI Liechtenstein, LT Lithuania, LU Luxembourg, MT Malta, NL Netherlands,
NO Norway, PL Poland, PT Portugal, RO Romania, SK Slovakia, SI Slovenia,
ES Spain, SE Sweden, CH Switzerland

**Registered but deliberately non-selectable:** `SCHENGEN` (the area-wide bloc,
`selectable = false`, kept resolvable for legacy applications).

## 3. Visa categories — 6 program ids, 71 country × category combinations

| Country | Programs | Count |
|---|---|---|
| CA Canada | `visitor_visa` (Visitor Visa/TRV), `family_sponsorship` (Super Visa — parents/grandparents), `business_visa`, `student_visa` (Study Permit), `work_permit` | 5 |
| US United States | `visitor_visa` (B-2), `business_visa`, `family_sponsorship` (Form I-130) | 3 |
| AU Australia | `visitor_visa` (subclass 600), `student_visa` (subclass 500), `business_visa` (subclass 600 Business Visitor stream) | 3 |
| GB United Kingdom | `visitor_visa` (Standard Visitor), `student_visa` | 2 |
| each of 29 Schengen members | `tourist_visa`, `business_visa` | 2 × 29 = 58 |
| **Total** | | **71** |

Program id frequency: `business_visa` 32, `tourist_visa` 29, `visitor_visa` 4,
`student_visa` 3, `family_sponsorship` 2, `work_permit` 1.

**No visa subtypes exist as a separate product concept.** What reads like a
subtype ("subclass 600 Business Visitor stream", "Super Visa") is carried in the
program's `label`, not a distinct selectable entity. The matrix is therefore
71 rows, not 71 × N.

## 4. Official forms the product claims

Read from each program strategy. These are the codes an accuracy audit must
verify and, just as importantly, the codes that must **never** appear under a
different country.

| Country | Form codes |
|---|---|
| CA | IMM 5257, IMM 5645, IMM 1294, IMM 1295 |
| US | I-130 (`https://www.uscis.gov/i-130`) |
| AU | 1415 (`https://immi.homeaffairs.gov.au/form-listing/forms/1415.pdf`) |
| GB | *(none declared)* |
| Schengen members | shared `SCHENGEN_FORMS` set |

US B-1/B-2 and the AU tourist/student routes deliberately declare **no**
downloadable form — both moved to online-only portals (DS-160, ImmiAccount).
That is a documented product decision, not missing data.

## 5. Database-side framework catalogue — the significant gap

`country_frameworks (country_code, visa_type, purpose)` is what the intake graph
loads to build a checklist (`intake/graphs/nodes/load-framework.ts`).

**It contains exactly one row: `CA / TRV / tourism`.**

So 1 of 71 matrix combinations has a seeded framework. For the other 70, the
intake graph runs in discovery mode with `requirementsJson = {}` and the
checklist is produced by the LLM rather than by seeded product configuration.
This is the single most important finding for accuracy testing: **for 70 of 71
combinations there is no deterministic product configuration to check the AI's
output against.**

## 6. Platform surfaces discovered

- **API modules:** 51 (`apps/api/src/modules/`), including `intake`, `documents`,
  `narrative`, `vri`, `prefill`, `portal-fill`, `billing`, `subscriptions`,
  `payouts`, `consultant`, `marketplace`, `partner`, `messaging`,
  `notifications`, `analytics*`, `feature-flags`, `privacy`, `voice`.
- **Auth:** Supabase JWT via `JwtGuard`, **fail-closed for anonymous identities** —
  a route is guest-reachable only with an explicit `@AllowAnonymous`.
- **Locales:** routes are locale-prefixed (`/[locale]/…`); the UI language
  selector offers English and French.
- **Uploads:** documents stage, gated behind sign-in for guests.
- **Payments:** Stripe (subscriptions + one-time), gated.

## 7. Accessibility baseline observed

`components/ui/country-combobox.tsx` implements the WAI-ARIA 1.2 combobox
pattern properly: `role="combobox"` on the input, `aria-expanded`,
`aria-controls`, `aria-activedescendant`, a real `role="listbox"` with
`role="option"` children, `aria-invalid` + `aria-describedby` on error, and
`aria-busy` with a polite status for loading. This is a genuinely good baseline
and is recorded here so later a11y findings are scoped to what actually regresses.

---

## 8. Environment used

| Piece | Value |
|---|---|
| Web | `http://localhost:3100` (Next.js 16.3.0, Turbopack, dev) |
| API | `http://localhost:4100` (NestJS, `NODE_ENV=development`) |
| Database | local Supabase stack — API `http://127.0.0.1:54321`, DB `:54322` |
| Browser | Chromium via Playwright (repo's existing E2E stack) + real Chrome via the Chrome extension for exploratory verification |
| LLM | `gpt-4o` for interview turns, `gpt-4o-mini` for extraction (`intake.graph.ts`) — billed to the key in `apps/api/.env` |

Production (`https://visaai.co`) was opened read-only for orientation only. No
scenario traffic, no test data and no writes were directed at production.
