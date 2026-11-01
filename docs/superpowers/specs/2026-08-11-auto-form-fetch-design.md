# Automatic official-form delivery

**Date:** 2026-08-11
**Status:** Approved, not yet implemented

## Problem

An applicant must currently find the official application form on the
government portal, download it, and upload it to `visaai.co/documents`. That is
manual, easy to get wrong, and easy to do with the *wrong version* of a form —
which gets applications rejected.

VisaAI already knows which forms each country and program requires
(`strategies/*` → `FormSpec`). It should fetch them.

## What this is not

Only **blank, publicly published** forms are in scope. This design never
authenticates to a government portal, never handles applicant portal
credentials, and never retrieves documents from an applicant's government
account. That is a separate question with its own legal review, deliberately
out of scope.

## Findings that shaped the design

These were verified against live IRCC endpoints on 2026-08-11, and each one
invalidates an assumption in the current code.

**1. The existing template URL is dead.**
`modules/prefill/forms/imm5257.ts` hardcodes

```
https://www.canada.ca/content/dam/ircc/migration/ircc/english/pdf/kits/forms/imm5257e.pdf
```

which returns `200 text/html`, not a PDF. Every IMM 5257 prefill has therefore
been failing and silently degrading to the VisaAI summary PDF. Nothing surfaces
the failure.

**2. IRCC versions forms by date in the path.** The real URL is

```
/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf
```

The `01-09-2023` segment is the form revision. No deep URL is stable, and no
path is guessable — but the *landing page* URL is stable and already stored in
`canada.strategy.ts`, and it carries the current link in plain HTML.

**3. IRCC forms are dynamic XFA, not AcroForm.** The real PDF loads in pdf-lib
with **zero** form fields and the file declares `NeedsRendering`. pdf-lib cannot
fill it. The existing code anticipated this in a comment; that fallback branch
is the only one that ever runs.

**4. robots.txt disallows specific form PDFs.** canada.ca lists individual
forms under `Disallow:` (`imm0143e`, `imm0144e`, `imm5444/` among them). Any
fetcher must check per URL, not per host.

**5. Playwright is unnecessary.** The link is in the served HTML; a plain fetch
and a regex retrieve it. A headless browser is kept as a per-portal escape
hatch in the interface, unused for canada.ca.

## Architecture

| Component | Responsibility |
|---|---|
| `FormDiscoveryService` | landing URL → `{ pdfUrl, versionLabel }`. One strategy per portal, selected by country. |
| `FormTemplateStore` | Supabase Storage for bytes, `form_templates` row for metadata. The only thing read on the request path. |
| `FormTemplateRefreshJob` | BullMQ scheduled job. Re-discovers, re-downloads on change, re-probes capability. |
| `FormCapabilityProbe` | Classifies a PDF as `acroform` (fillable by pdf-lib) or `xfa`. |
| `FormAttachmentService` | Attaches the required forms to an application as documents. |

`strategies/*` remains the source of truth for *which* forms are required. This
subsystem only resolves, caches and delivers them.

### Data model — `form_templates`

```
country_code, program, form_code, form_name
landing_url            stable; from FormSpec
resolved_pdf_url       versioned; discovered
version_label          e.g. '01-09-2023'
storage_path, sha256, byte_size
capability             'acroform' | 'xfa' | 'unknown'
field_count
fetched_at, last_checked_at
status                 'ok' | 'stale' | 'blocked' | 'error'
error_message
```

Unique on `(country_code, program, form_code)`.

`sha256` and `version_label` together give revision detection. When either
changes, the form was revised and any field mapping for it must be re-verified
before it is trusted again — a silently changed form is the failure mode that
matters most here.

### Refresh flow

1. For each `FormSpec` with a landing URL:
2. Check robots.txt for the resolved PDF path. Disallowed → `status='blocked'`,
   stop. The applicant is shown the official link instead.
3. Fetch the landing page, extract the current PDF href and version label.
4. Unchanged version and checksum → touch `last_checked_at`, stop.
5. Changed → download, checksum, probe capability, write to Storage, update row.

### Delivery flow

On application or checklist creation, for each required form:

- `capability='acroform'` **and** profile has the needed values → generate a
  prefilled copy and attach it.
- `capability='xfa'` → attach the official blank plus a VisaAI data sheet
  carrying the applicant's values to copy across.
- No cached template → show the official landing link. This is today's
  behaviour, so the feature degrades to the status quo rather than to an error.

## Constraints

Requirements, not preferences:

- **Honour robots.txt per URL**, not per host.
- **One fetch serves all applicants.** Per-user fetching would aim VisaAI's
  entire user base at government servers.
- **Descriptive User-Agent** identifying VisaAI with a contact URL.
- **Public documents only.** No credentials, no session, no account access.

## Error handling

No discovery or download failure reaches an applicant. The last good cached
copy is always served and the row is marked `stale`; failures are logged and
surfaced to admin. Availability of a government website is never on the
critical path of a user request.

## Testing

Discovery parser and capability probe run against **saved fixtures** — a real
XFA PDF, a real AcroForm PDF, and captured landing-page HTML — so CI never
calls government servers. The refresh job is tested with a mocked fetcher
across: unchanged, revised, 404, robots-blocked, and malformed HTML.

## Build order

Two seams, in one plan:

1. **Fetch, cache, attach blank forms.** Delivers the actual request: the
   manual download disappears. Also fixes the dead URL and the silent prefill
   failure by making the failure visible.
2. **Prefill where capability allows.** Layers on top; no-ops for XFA forms.

## Open questions

- Which additional countries have `FormSpec` entries with landing URLs today,
  and do their portals also serve links in plain HTML? Only canada.ca has been
  verified. A portal that needs JavaScript would be the first user of the
  Playwright escape hatch.
- Whether the VisaAI data sheet for XFA forms should be a new artifact or the
  existing summary PDF re-purposed.
