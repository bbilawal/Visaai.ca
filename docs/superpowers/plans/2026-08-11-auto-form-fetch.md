# Automatic Official-Form Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch, cache, and deliver blank official government application forms so an applicant never downloads a form from a government portal and re-uploads it to `visaai.co/documents`.

**Architecture:** A new `forms` module owns discovery (landing page → versioned PDF URL), caching (Supabase Storage + a `form_templates` row), capability probing (AcroForm vs XFA), and delivery (a read-path endpoint the documents page renders). A BullMQ scheduled job does all network I/O; the request path only reads the cache. `strategies/*` stays the source of truth for *which* forms a program requires — this module only resolves, caches, and serves them.

**Tech Stack:** NestJS 11, BullMQ (`@nestjs/bullmq`), Supabase (Postgres + Storage), pdf-lib, Jest 30 + ts-jest, Next.js (App Router) for the one UI surface.

## Global Constraints

Copied from `docs/superpowers/specs/2026-08-11-auto-form-fetch-design.md`. Every task inherits these.

- **Honour robots.txt per URL, not per host.** canada.ca disallows individual form PDFs by name.
- **One fetch serves all applicants.** Never fetch a government server on a user request path.
- **Descriptive User-Agent identifying VisaAI with a contact URL.** Exact value: `VisaAI-FormFetcher/1.0 (+https://visaai.co/bot)`.
- **Public documents only.** No credentials, no session, no government-account access, ever.
- **No discovery or download failure reaches an applicant.** Serve the last good cached copy and mark the row `stale`; if there is no cached copy, show the official landing link (today's behaviour).
- **Tests never call government servers.** Discovery and probe tests run against fixtures committed to the repo or generated in-test.
- Background/system paths use `SupabaseService.admin` (service-role, bypasses RLS). Request paths use the caller-scoped client (`@SupabaseUserClient()`). This is a security boundary — see `apps/api/src/modules/shared/supabase/supabase.service.ts`.
- Migrations live in `supabase/migrations/` and are applied manually. `npx supabase@latest` — the CLI is not on PATH.
- Run API tests with `pnpm --filter api test`. Test files match `.*\.spec\.ts$` anywhere under `apps/api`.

## Context an implementer needs

Four findings were verified against live IRCC endpoints on 2026-08-11. They are the reason this module exists, and each contradicts something the current code assumes.

1. **`apps/api/src/modules/prefill/forms/imm5257.ts:16` hardcodes a dead URL.** It returns `200 text/html`, not a PDF. Every IMM 5257 prefill has silently degraded to the VisaAI summary PDF. Nothing logs it.
2. **IRCC versions forms by date inside the path**: `/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf`. No deep URL is stable or guessable. The **landing page** URL is stable and carries the current link.
3. **The real PDF is dynamic XFA.** Measured with pdf-lib: `NeedsRendering: true`, `0` form fields, `1` page, and the AcroForm `/XFA` key is *not* reachable via `form.acroForm.dict`. So capability detection must key on `NeedsRendering` + field count, **not** on `/XFA`.
4. **canada.ca `robots.txt` has a single `User-agent: *` group** with 49 `Disallow:` lines, some naming individual form PDFs (`imm0143e.pdf`, `imm0144e.pdf`) and some being directory prefixes (`imm5444/`, `imm5644/`, `imm5475/`, `imm5476/`). Several unrelated lines use `*` wildcards (`/en/*/search.html`), so the matcher must support them.

Two gaps in the existing code that this plan closes as a side effect:

- **`strategyRegistry.resolve()` has zero callers.** The `FormSpec` entries in `canada.strategy.ts` are unreachable from an application today. Task 6 builds the bridge.
- **`country_frameworks.visa_type` holds `'TRV'`, not a `VisaProgramId` like `'visitor_visa'`.** No mapping exists anywhere in the codebase. Task 6 adds it.

### Deliberate deviation from the spec — read this before Task 8

The spec's architecture table says `FormAttachmentService` "attaches the required forms to an application as documents." **Do not insert rows into `public.documents`.** That table is user-uploaded evidence and is coupled to two pipelines that a blank form would corrupt:

- `apps/api/src/modules/vri/graphs/nodes/load-vri-data.ts:37` feeds every `documents` row into VRI scoring.
- `apps/api/src/modules/documents/graphs/nodes/check-docs-ready.ts:8` gates cross-verification on `every(ocr_status in ('complete','failed'))`. A blank form inserted with the default `ocr_status = 'pending'` and no OCR job enqueued would **permanently block cross-verification for that application**.

Delivery is therefore a **read path** (Task 8: `GET /forms/:applicationId`) rendered as a section on the documents page (Task 9). This removes the manual download — the actual request — without writing into an evidence table. Everything else in the spec is implemented as written.

## File Structure

**New module — `apps/api/src/modules/forms/`**

| File | Responsibility |
|---|---|
| `http.ts` | Narrow `FetchLike`/`HttpResponse` types (so tests inject a stub without casting), the User-Agent constant, the fetch timeout. |
| `robots.ts` | Parse a robots.txt body; answer "is this exact URL path allowed?". Caches per host. |
| `capability/form-capability.probe.ts` | Classify PDF bytes as `acroform` \| `xfa` \| `unknown`. |
| `discovery/discovery.types.ts` | `DiscoveredForm`, `PortalDiscoveryStrategy` (the unused Playwright escape hatch lives here as an interface). |
| `discovery/canada-ircc.discovery.ts` | canada.ca strategy: plain fetch + regex. Exports `extractPdfLink` for testing. |
| `discovery/discovery.registry.ts` | `portalId` → strategy. |
| `form-catalog.ts` | Application (`country_code` + `visa_type`) → `RequiredForm[]`, including landing URLs for forms whose `FormSpec.sourceUrl` is absent. |
| `form-template.store.ts` | The only thing that touches the `form_templates` table and the `form-templates` bucket. |
| `form-refresh.service.ts` | Orchestrates robots → discover → download → probe → store. All network I/O lives behind here. |
| `form-refresh.processor.ts` | BullMQ worker. |
| `form-refresh.scheduler.ts` | Registers the repeatable job. |
| `forms.service.ts` | Read path: application → `DeliveredForm[]`. |
| `forms.controller.ts` | `GET /forms/:applicationId`. |
| `forms.module.ts` | Wiring. |

**Modified**

- `apps/api/src/modules/shared/queue/queue.constants.ts` — add `FORM_REFRESH_QUEUE`.
- `apps/api/src/modules/shared/queue/queue.module.ts` — register it.
- `apps/api/src/app.module.ts` — import `FormsModule`.
- `apps/api/src/modules/prefill/forms/imm5257.ts` — Task 10: load from the cache, delete the dead URL.
- `apps/web/app/[locale]/(dashboard)/documents/[applicationId]/documents-client.tsx` — Task 9: render the new section.

**Created outside the module**

- `supabase/migrations/20260811120000_form_templates.sql`
- `apps/web/app/[locale]/(dashboard)/documents/[applicationId]/official-forms.tsx`
- `apps/api/test/fixtures/forms/canada-robots.txt`
- `apps/api/test/fixtures/forms/imm5257-landing.html`

Specs are co-located next to the unit under test (`robots.spec.ts` beside `robots.ts`), matching the newer pattern in `apps/api/src/modules/documents/`.

---

### Task 1: robots.txt gate

**Files:**
- Create: `apps/api/src/modules/forms/http.ts`
- Create: `apps/api/src/modules/forms/robots.ts`
- Create: `apps/api/src/modules/forms/robots.spec.ts`
- Create: `apps/api/test/fixtures/forms/canada-robots.txt`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type HttpResponse = { ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }`
  - `type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<HttpResponse>`
  - `const FORM_FETCH_USER_AGENT: string`
  - `const FETCH_TIMEOUT_MS: number`
  - `function parseRobots(body: string): string[]` — the `Disallow` patterns of the `User-agent: *` group
  - `function isPathAllowed(patterns: string[], path: string): boolean`
  - `class RobotsGate { constructor(http?: FetchLike); allows(url: string): Promise<boolean> }`

- [ ] **Step 1: Create the robots.txt fixture**

The file must be the real canada.ca robots.txt. Fetch it once and commit it:

```bash
mkdir -p apps/api/test/fixtures/forms
curl -s --max-time 20 https://www.canada.ca/robots.txt \
  -o apps/api/test/fixtures/forms/canada-robots.txt
```

Verify it contains the lines the tests assert on:

```bash
grep -c 'Disallow:' apps/api/test/fixtures/forms/canada-robots.txt   # expect 49
grep 'imm0143e.pdf' apps/api/test/fixtures/forms/canada-robots.txt   # must match
grep 'imm5444/' apps/api/test/fixtures/forms/canada-robots.txt       # must match
```

If the counts differ, canada.ca changed its robots.txt. Adjust only the `toBe(49)` assertion in Step 2 — never weaken the path assertions.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/modules/forms/robots.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRobots, isPathAllowed, RobotsGate } from './robots';
import type { FetchLike, HttpResponse } from './http';

const REAL = readFileSync(
  join(__dirname, '../../../test/fixtures/forms/canada-robots.txt'),
  'utf8',
);

function ok(body: string): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

describe('parseRobots', () => {
  it('reads every Disallow in the User-agent: * group', () => {
    expect(parseRobots(REAL)).toHaveLength(49);
  });

  it('ignores comments and blank lines', () => {
    expect(parseRobots('#c\n\nUser-agent: *\nDisallow: /a\n')).toEqual(['/a']);
  });

  it('only reads the * group, not another agent’s rules', () => {
    const body = [
      'User-agent: BadBot',
      'Disallow: /everything',
      '',
      'User-agent: *',
      'Disallow: /forms/secret.pdf',
    ].join('\n');
    expect(parseRobots(body)).toEqual(['/forms/secret.pdf']);
  });

  it('treats an empty Disallow as "allow all" and drops it', () => {
    expect(parseRobots('User-agent: *\nDisallow:\n')).toEqual([]);
  });
});

describe('isPathAllowed', () => {
  const rules = parseRobots(REAL);

  it('blocks an exactly-named form PDF', () => {
    expect(
      isPathAllowed(
        rules,
        '/content/dam/ircc/documents/pdf/english/kits/forms/imm0143e.pdf',
      ),
    ).toBe(false);
  });

  it('blocks anything under a disallowed directory prefix', () => {
    expect(
      isPathAllowed(
        rules,
        '/content/dam/ircc/documents/pdf/english/kits/forms/imm5444/01-01-2020/imm5444e.pdf',
      ),
    ).toBe(false);
  });

  it('allows the IMM 5257 PDF, which is not disallowed', () => {
    expect(
      isPathAllowed(
        rules,
        '/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf',
      ),
    ).toBe(true);
  });

  it('honours * wildcards mid-pattern', () => {
    expect(isPathAllowed(['/en/*/search.html'], '/en/anything/search.html')).toBe(
      false,
    );
    expect(isPathAllowed(['/en/*/search.html'], '/en/anything/other.html')).toBe(
      true,
    );
  });

  it('honours a trailing $ anchor', () => {
    expect(isPathAllowed(['/a.pdf$'], '/a.pdf')).toBe(false);
    expect(isPathAllowed(['/a.pdf$'], '/a.pdf.bak')).toBe(true);
  });

  it('escapes regex metacharacters in a literal pattern', () => {
    // The '.' must not match 'x'. A naive replace(/\*/g, '.*') gets this wrong.
    expect(isPathAllowed(['/a.pdf'], '/axpdf')).toBe(true);
  });
});

describe('RobotsGate', () => {
  it('allows a permitted URL and blocks a disallowed one from the same fetch', async () => {
    let calls = 0;
    const http: FetchLike = () => {
      calls++;
      return Promise.resolve(ok(REAL));
    };
    const gate = new RobotsGate(http);

    await expect(
      gate.allows(
        'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf',
      ),
    ).resolves.toBe(true);
    await expect(
      gate.allows(
        'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm0143e.pdf',
      ),
    ).resolves.toBe(false);

    expect(calls).toBe(1); // cached per host
  });

  it('fails CLOSED when robots.txt cannot be fetched', async () => {
    const http: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(
      new RobotsGate(http).allows('https://example.gov/forms/a.pdf'),
    ).resolves.toBe(false);
  });

  it('treats a 404 robots.txt as "no rules", so everything is allowed', async () => {
    const http: FetchLike = () =>
      Promise.resolve({ ...ok(''), ok: false, status: 404 });
    await expect(
      new RobotsGate(http).allows('https://example.gov/forms/a.pdf'),
    ).resolves.toBe(true);
  });
});
```

Note the two failure modes are deliberately different. A *transport* failure means we do not know the rules, so we do not fetch. A *404* means the site published no rules, which the standard defines as unrestricted.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter api test -- robots.spec`
Expected: FAIL — `Cannot find module './robots'`.

- [ ] **Step 4: Write `http.ts`**

```ts
/**
 * A narrow structural subset of the WHATWG fetch surface — enough for
 * discovery and download, small enough that a test can supply a literal
 * object instead of casting a partial mock to `typeof fetch`.
 *
 * The global `fetch` satisfies this structurally, so production passes it
 * directly.
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<HttpResponse>;

/**
 * Identifies VisaAI to government webmasters with a contact URL, per the
 * design's crawling constraints. Do not make this look like a browser.
 */
export const FORM_FETCH_USER_AGENT =
  'VisaAI-FormFetcher/1.0 (+https://visaai.co/bot)';

export const FETCH_TIMEOUT_MS = 20_000;

export const defaultHttp: FetchLike = (url, init) =>
  fetch(url, {
    ...init,
    headers: { 'user-agent': FORM_FETCH_USER_AGENT, ...(init?.headers ?? {}) },
    signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }) as unknown as Promise<HttpResponse>;
```

- [ ] **Step 5: Write `robots.ts`**

```ts
import { defaultHttp, type FetchLike } from './http';

/**
 * A deliberately small robots.txt reader.
 *
 * Scope: the `User-agent: *` group only. VisaAI does not register a named
 * crawler, so a rule addressed to some other agent is not ours to obey or to
 * ignore — it simply does not apply.
 *
 * This exists because canada.ca disallows INDIVIDUAL form PDFs by filename
 * (imm0143e.pdf, imm0144e.pdf) alongside directory prefixes (imm5444/). A
 * host-level allow/deny would either block every IRCC form or fetch ones we
 * have been asked not to. The check must be per URL.
 */

/** Disallow patterns of the `User-agent: *` group, in file order. */
export function parseRobots(body: string): string[] {
  const out: string[] = [];
  let inStar = false;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === 'user-agent') {
      inStar = value === '*';
      continue;
    }
    // An empty Disallow means "allow everything" — it is not a pattern.
    if (field === 'disallow' && inStar && value) out.push(value);
  }
  return out;
}

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  // Escape every regex metacharacter, THEN reinstate `*` as a wildcard.
  // Escaping after expanding `*` would re-escape the `.*` we just inserted.
  const escaped = body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\\\*/g, '.*') + (anchored ? '$' : ''));
}

export function isPathAllowed(patterns: string[], path: string): boolean {
  return !patterns.some((p) => toRegExp(p).test(path));
}

/**
 * Per-host robots.txt cache. One fetch per host per process lifetime — the
 * refresh job runs daily, so staleness is bounded by the process, and a
 * restart re-reads.
 *
 * `null` in the cache means "fetched, but the transport failed": we do not
 * know the rules, so `allows` returns false. A 404 is different — the site
 * published no rules, so an empty pattern list allows everything.
 */
export class RobotsGate {
  private readonly cache = new Map<string, string[] | null>();

  constructor(private readonly http: FetchLike = defaultHttp) {}

  async allows(url: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    const host = parsed.origin;
    if (!this.cache.has(host)) {
      this.cache.set(host, await this.load(host));
    }
    const patterns = this.cache.get(host);
    if (patterns === null) return false;
    return isPathAllowed(patterns, parsed.pathname);
  }

  private async load(origin: string): Promise<string[] | null> {
    try {
      const res = await this.http(`${origin}/robots.txt`);
      if (res.status === 404) return [];
      if (!res.ok) return null;
      return parseRobots(await res.text());
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter api test -- robots.spec`
Expected: PASS, 14 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/forms/http.ts \
        apps/api/src/modules/forms/robots.ts \
        apps/api/src/modules/forms/robots.spec.ts \
        apps/api/test/fixtures/forms/canada-robots.txt
git commit -m "feat(forms): per-URL robots.txt gate for form fetching"
```

---

### Task 2: PDF capability probe

**Files:**
- Create: `apps/api/src/modules/forms/capability/form-capability.probe.ts`
- Create: `apps/api/src/modules/forms/capability/form-capability.probe.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type FormCapability = 'acroform' | 'xfa' | 'unknown'`
  - `interface CapabilityResult { capability: FormCapability; fieldCount: number; pageCount: number }`
  - `function probeFormCapability(bytes: Uint8Array): Promise<CapabilityResult>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/forms/capability/form-capability.probe.spec.ts`. The fixtures are generated in-test with pdf-lib — deterministic, ~600 bytes each, no network, nothing to commit:

```ts
import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import { probeFormCapability } from './form-capability.probe';

/** A one-page PDF flagged NeedsRendering — the shape every IRCC form has. */
async function xfaLike(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.catalog.set(PDFName.of('NeedsRendering'), PDFBool.True);
  return pdf.save();
}

/** A real AcroForm with one fillable text field. */
async function acroFormLike(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const field = pdf.getForm().createTextField('Names.FamilyName');
  field.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  return pdf.save();
}

/** A plain page: no fields, no XFA flag. Not fillable, but not XFA either. */
async function flat(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return pdf.save();
}

describe('probeFormCapability', () => {
  it('classifies a NeedsRendering PDF as xfa', async () => {
    const r = await probeFormCapability(await xfaLike());
    expect(r.capability).toBe('xfa');
    expect(r.fieldCount).toBe(0);
    expect(r.pageCount).toBe(1);
  });

  it('classifies a PDF with AcroForm fields as acroform', async () => {
    const r = await probeFormCapability(await acroFormLike());
    expect(r.capability).toBe('acroform');
    expect(r.fieldCount).toBe(1);
  });

  it('classifies a field-less, flag-less PDF as unknown', async () => {
    const r = await probeFormCapability(await flat());
    expect(r.capability).toBe('unknown');
    expect(r.fieldCount).toBe(0);
  });

  it('returns unknown rather than throwing on bytes that are not a PDF', async () => {
    const r = await probeFormCapability(new TextEncoder().encode('<html>'));
    expect(r).toEqual({ capability: 'unknown', fieldCount: 0, pageCount: 0 });
  });

  it('prefers acroform when fields exist even if NeedsRendering is set', async () => {
    // A hybrid XFA/AcroForm PDF is fillable by pdf-lib via its AcroForm
    // fallback. Field presence is the operative signal, so it wins.
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    pdf.getForm().createTextField('x').addToPage(page, {
      x: 10,
      y: 10,
      width: 50,
      height: 10,
    });
    pdf.catalog.set(PDFName.of('NeedsRendering'), PDFBool.True);
    const r = await probeFormCapability(await pdf.save());
    expect(r.capability).toBe('acroform');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api test -- form-capability.probe.spec`
Expected: FAIL — `Cannot find module './form-capability.probe'`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/modules/forms/capability/form-capability.probe.ts`:

```ts
import { PDFDocument, PDFName } from 'pdf-lib';

/**
 * Can pdf-lib fill this form?
 *
 *   acroform  yes — it has named AcroForm fields
 *   xfa       no  — dynamic XFA; the file is a "please open in Acrobat" stub
 *   unknown   no  — a flat PDF, or bytes we could not parse
 *
 * MEASURED against the live IMM 5257 (2026-08-11):
 *   NeedsRendering = true, fields = 0, pages = 1
 * and, importantly, `form.acroForm.dict.get(PDFName.of('XFA'))` is UNDEFINED
 * for that file. Detection therefore keys on NeedsRendering plus the field
 * count, not on the /XFA key — which is why the obvious check does not work.
 *
 * pdf-lib prints "Trying to parse invalid object" warnings to stderr while
 * loading IRCC PDFs and still succeeds. That noise is expected, not an error.
 */
export type FormCapability = 'acroform' | 'xfa' | 'unknown';

export interface CapabilityResult {
  capability: FormCapability;
  fieldCount: number;
  pageCount: number;
}

const UNPARSEABLE: CapabilityResult = {
  capability: 'unknown',
  fieldCount: 0,
  pageCount: 0,
};

export async function probeFormCapability(
  bytes: Uint8Array,
): Promise<CapabilityResult> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return UNPARSEABLE;
  }

  const pageCount = pdf.getPageCount();

  let fieldCount = 0;
  try {
    fieldCount = pdf.getForm().getFields().length;
  } catch {
    fieldCount = 0;
  }

  // Fields win: a hybrid file with both an XFA layer and an AcroForm fallback
  // is fillable through the fallback.
  if (fieldCount > 0) {
    return { capability: 'acroform', fieldCount, pageCount };
  }

  const needsRendering = pdf.catalog.get(PDFName.of('NeedsRendering'));
  if (needsRendering?.toString() === 'true') {
    return { capability: 'xfa', fieldCount, pageCount };
  }

  return { capability: 'unknown', fieldCount, pageCount };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter api test -- form-capability.probe.spec`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/forms/capability/
git commit -m "feat(forms): classify PDFs as acroform, xfa, or unknown"
```

---

### Task 3: Landing-page discovery

**Files:**
- Create: `apps/api/src/modules/forms/discovery/discovery.types.ts`
- Create: `apps/api/src/modules/forms/discovery/canada-ircc.discovery.ts`
- Create: `apps/api/src/modules/forms/discovery/discovery.registry.ts`
- Create: `apps/api/src/modules/forms/discovery/canada-ircc.discovery.spec.ts`
- Create: `apps/api/test/fixtures/forms/imm5257-landing.html`

**Interfaces:**
- Consumes: `FetchLike`, `HttpResponse`, `defaultHttp` from `../http` (Task 1).
- Produces:
  - `interface DiscoveredForm { pdfUrl: string; versionLabel: string | null }`
  - `interface PortalDiscoveryStrategy { readonly portalId: string; discover(landingUrl: string, http: FetchLike): Promise<DiscoveredForm | null> }`
  - `function extractPdfLink(html: string, landingUrl: string): DiscoveredForm | null`
  - `const canadaIrccDiscovery: PortalDiscoveryStrategy`
  - `function registerDiscoveryStrategy(s: PortalDiscoveryStrategy): void`
  - `function resolveDiscoveryStrategy(portalId: string): PortalDiscoveryStrategy | undefined`

- [ ] **Step 1: Create the landing-page fixture**

Write `apps/api/test/fixtures/forms/imm5257-landing.html` with exactly this content. It is the real markup from the live page, trimmed to the "Download the form" block:

```html
<div class="generic-base-html parbase section">
    <h2>Download the form</h2>
<div class="well">
    <div class="row">
        <div class="col-md-2 hidden-xs hidden-sm"><img class="img-responsive thumbnail" src="/content/dam/ircc/images/services/visit-canada/upload-docs.png" alt=""></div>
        <div class="col-xs-12 col-md-10"><a href="/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf" download="">
                <p class="gc-dwnld-txt">Application for visitor visa (temporary resident visa) <span class="nowrap">[IMM 5257] (PDF, 2 MB)</span></p>
            </a>
            <div class="mrgn-bttm-lg"><span class="badge">Last updated: September 2023</span></div>
        </div>
    </div>
</div>
</div>
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/modules/forms/discovery/canada-ircc.discovery.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPdfLink, canadaIrccDiscovery } from './canada-ircc.discovery';
import {
  registerDiscoveryStrategy,
  resolveDiscoveryStrategy,
} from './discovery.registry';
import type { FetchLike, HttpResponse } from '../http';

const LANDING =
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html';

const HTML = readFileSync(
  join(__dirname, '../../../../test/fixtures/forms/imm5257-landing.html'),
  'utf8',
);

function res(body: string, over: Partial<HttpResponse> = {}): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    ...over,
  };
}

describe('extractPdfLink', () => {
  it('resolves the relative href against the landing URL', () => {
    expect(extractPdfLink(HTML, LANDING)?.pdfUrl).toBe(
      'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf',
    );
  });

  it('reads the version label from the dated path segment', () => {
    expect(extractPdfLink(HTML, LANDING)?.versionLabel).toBe('01-09-2023');
  });

  it('returns null when the page has no PDF link', () => {
    expect(extractPdfLink('<html><body>No form here.</body></html>', LANDING))
      .toBeNull();
  });

  it('returns null on truncated markup rather than throwing', () => {
    expect(extractPdfLink('<a href="/x/y', LANDING)).toBeNull();
  });

  it('keeps an absolute href as-is', () => {
    const html = '<a href="https://cdn.example.gov/f/2024-01/a.pdf">form</a>';
    expect(extractPdfLink(html, LANDING)?.pdfUrl).toBe(
      'https://cdn.example.gov/f/2024-01/a.pdf',
    );
  });

  it('leaves versionLabel null when no path segment looks like a date', () => {
    const html = '<a href="/forms/a.pdf">form</a>';
    expect(extractPdfLink(html, LANDING)?.versionLabel).toBeNull();
  });

  it('takes the first PDF link when a page lists several', () => {
    const html = [
      '<a href="/forms/imm5257/01-09-2023/imm5257e.pdf">English</a>',
      '<a href="/trousses/imm5257/01-09-2023/imm5257f.pdf">French</a>',
    ].join('\n');
    expect(extractPdfLink(html, LANDING)?.pdfUrl).toContain('imm5257e.pdf');
  });
});

describe('canadaIrccDiscovery', () => {
  it('sends the VisaAI User-Agent and returns the discovered form', async () => {
    let seen: Record<string, string> | undefined;
    const http: FetchLike = (_url, init) => {
      seen = init?.headers;
      return Promise.resolve(res(HTML));
    };
    const found = await canadaIrccDiscovery.discover(LANDING, http);
    expect(found?.versionLabel).toBe('01-09-2023');
    expect(seen?.['user-agent']).toContain('VisaAI-FormFetcher');
  });

  it('returns null on a non-OK landing page', async () => {
    const http: FetchLike = () =>
      Promise.resolve(res('', { ok: false, status: 404 }));
    await expect(canadaIrccDiscovery.discover(LANDING, http)).resolves.toBeNull();
  });

  it('returns null when the fetch throws', async () => {
    const http: FetchLike = () => Promise.reject(new Error('ETIMEDOUT'));
    await expect(canadaIrccDiscovery.discover(LANDING, http)).resolves.toBeNull();
  });
});

describe('discovery registry', () => {
  it('resolves the built-in ircc strategy', () => {
    expect(resolveDiscoveryStrategy('ircc')).toBe(canadaIrccDiscovery);
  });

  it('returns undefined for an unregistered portal', () => {
    expect(resolveDiscoveryStrategy('nope')).toBeUndefined();
  });

  it('accepts a newly registered strategy', () => {
    const stub = {
      portalId: 'test-portal',
      discover: () => Promise.resolve(null),
    };
    registerDiscoveryStrategy(stub);
    expect(resolveDiscoveryStrategy('test-portal')).toBe(stub);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter api test -- canada-ircc.discovery.spec`
Expected: FAIL — `Cannot find module './canada-ircc.discovery'`.

- [ ] **Step 4: Write `discovery.types.ts`**

```ts
import type { FetchLike } from '../http';

export interface DiscoveredForm {
  /** Absolute URL of the current PDF. Versioned; changes when IRCC revises. */
  pdfUrl: string;
  /** Revision marker, e.g. '01-09-2023'. Null when the portal exposes none. */
  versionLabel: string | null;
}

/**
 * One per government portal.
 *
 * `http` is injected rather than imported so a portal that needs a headless
 * browser can be added later without changing this interface — a Playwright
 * strategy would ignore the parameter and drive a page instead. canada.ca
 * serves the link in plain HTML, so nothing needs that today. The seam exists
 * so the first portal that DOES need it is an added file, not a refactor.
 */
export interface PortalDiscoveryStrategy {
  readonly portalId: string;
  discover(landingUrl: string, http: FetchLike): Promise<DiscoveredForm | null>;
}
```

- [ ] **Step 5: Write `canada-ircc.discovery.ts`**

```ts
import { defaultHttp, FORM_FETCH_USER_AGENT, type FetchLike } from '../http';
import type { DiscoveredForm, PortalDiscoveryStrategy } from './discovery.types';

/**
 * canada.ca / IRCC.
 *
 * The landing URL (…/application-forms-guides/imm5257.html) is stable; the PDF
 * it links to is not — IRCC puts the revision date in the path
 * (…/forms/imm5257/01-09-2023/imm5257e.pdf), so a hardcoded deep link rots
 * silently at the next revision. That is exactly what happened to
 * modules/prefill/forms/imm5257.ts, whose URL now returns text/html.
 *
 * The link sits in server-rendered HTML, so a regex over the body is
 * sufficient and a headless browser would buy nothing.
 */
const HREF_PDF = /href\s*=\s*"([^"]+\.pdf)"/i;

/** A path segment like 01-09-2023 or 2023-09-01 — IRCC's revision marker. */
const DATED_SEGMENT = /^\d{2,4}-\d{2}-\d{2,4}$/;

export function extractPdfLink(
  html: string,
  landingUrl: string,
): DiscoveredForm | null {
  const m = HREF_PDF.exec(html);
  if (!m) return null;

  let pdfUrl: string;
  try {
    pdfUrl = new URL(m[1], landingUrl).toString();
  } catch {
    return null;
  }

  const segments = new URL(pdfUrl).pathname.split('/');
  const versionLabel = segments.find((s) => DATED_SEGMENT.test(s)) ?? null;

  return { pdfUrl, versionLabel };
}

export const canadaIrccDiscovery: PortalDiscoveryStrategy = {
  portalId: 'ircc',
  async discover(landingUrl, http: FetchLike = defaultHttp) {
    try {
      const res = await http(landingUrl, {
        headers: { 'user-agent': FORM_FETCH_USER_AGENT },
      });
      if (!res.ok) return null;
      return extractPdfLink(await res.text(), landingUrl);
    } catch {
      return null;
    }
  },
};
```

- [ ] **Step 6: Write `discovery.registry.ts`**

```ts
import type { PortalDiscoveryStrategy } from './discovery.types';
import { canadaIrccDiscovery } from './canada-ircc.discovery';

/**
 * portalId → strategy. The id comes from a country strategy's `portal()`
 * (CanadaStrategy.portal().portalId === 'ircc'), so adding a portal is one
 * file plus one registration — the same shape as strategies/index.ts.
 */
const strategies = new Map<string, PortalDiscoveryStrategy>();

export function registerDiscoveryStrategy(s: PortalDiscoveryStrategy): void {
  strategies.set(s.portalId, s);
}

export function resolveDiscoveryStrategy(
  portalId: string,
): PortalDiscoveryStrategy | undefined {
  return strategies.get(portalId);
}

registerDiscoveryStrategy(canadaIrccDiscovery);
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter api test -- canada-ircc.discovery.spec`
Expected: PASS, 13 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/forms/discovery/ \
        apps/api/test/fixtures/forms/imm5257-landing.html
git commit -m "feat(forms): discover the current form PDF from a stable landing page"
```

---

### Task 4: `form_templates` table and storage bucket

**Files:**
- Create: `supabase/migrations/20260811120000_form_templates.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.form_templates`, storage bucket `form-templates`. Column names are the contract Task 5 codes against.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260811120000_form_templates.sql`:

```sql
-- Automatic official-form delivery — the cache.
-- Design: docs/superpowers/specs/2026-08-11-auto-form-fetch-design.md
--
-- WHY A CACHE AND NOT A FETCH
--
-- Blank government forms are identical for every applicant, so fetching one
-- per user would point VisaAI's entire user base at government servers for no
-- gain. One scheduled fetch fills this table; every request path reads it.
-- Government-site availability is therefore never on a user request path.
--
-- WHY sha256 AND version_label BOTH
--
-- IRCC puts the revision date in the URL path
-- (…/forms/imm5257/01-09-2023/imm5257e.pdf), so version_label usually moves
-- when a form is revised. "Usually" is not "always" — a silent re-issue under
-- the same path is the failure mode that matters most here, because any field
-- mapping built against the old revision would keep filling the wrong boxes.
-- The checksum catches that; the label makes it legible to a human.
--
-- WHY THIS IS NOT IN public.documents
--
-- `documents` is applicant evidence. vri/graphs/nodes/load-vri-data.ts scores
-- every row in it, and documents/graphs/nodes/check-docs-ready.ts gates
-- cross-verification on all rows reaching a terminal ocr_status. A blank form
-- inserted there would inflate the readiness score and — with no OCR job ever
-- enqueued for it — block cross-verification for that application forever.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- Private, like every other bucket in this project. The contents are public
-- government documents, so the risk is not disclosure — it is that a public
-- bucket makes VisaAI an unmetered CDN for someone else's PDFs. Reads go
-- through short-lived signed URLs minted by the API.

insert into storage.buckets (id, name, public)
values ('form-templates', 'form-templates', false)
on conflict (id) do update set public = false;

-- No RLS policy on storage.objects for this bucket: nothing user-owned lives
-- here, and every read is a service-role-signed URL. Absent policies mean the
-- anon role cannot reach it at all, which is the intent.

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

create table if not exists public.form_templates (
  id             uuid primary key default gen_random_uuid(),

  -- Identity. Mirrors strategies/*: country + program + FormSpec.formCode.
  country_code   text not null check (char_length(country_code) between 2 and 12),
  program        text not null check (char_length(program) <= 64),
  form_code      text not null check (char_length(form_code) <= 32),
  form_name      text not null default '' check (char_length(form_name) <= 200),

  -- Stable, from FormSpec.sourceUrl or the module's landing-URL catalogue.
  landing_url    text not null,
  -- Versioned, discovered from the landing page. Null before the first run.
  resolved_pdf_url text,
  version_label  text check (char_length(version_label) <= 64),

  -- The cached bytes. storage_path is null until a download succeeds, which
  -- is what "serve the official link instead" keys on.
  storage_path   text,
  sha256         text check (sha256 is null or char_length(sha256) = 64),
  byte_size      integer check (byte_size is null or byte_size > 0),

  -- Can pdf-lib fill it? Drives prefill vs. blank-plus-data-sheet delivery.
  capability     text not null default 'unknown'
                 check (capability in ('acroform', 'xfa', 'unknown')),
  field_count    integer,

  fetched_at     timestamptz,
  last_checked_at timestamptz,

  --   ok       cached copy is current
  --   stale    cached copy served, last refresh failed
  --   blocked  robots.txt disallows this URL; never fetch it
  --   error    no usable copy
  status         text not null default 'error'
                 check (status in ('ok', 'stale', 'blocked', 'error')),
  error_message  text check (char_length(error_message) <= 1000),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A row claiming 'ok' with nothing cached would make the delivery path
  -- promise a download it cannot serve.
  constraint form_templates_ok_requires_bytes check (
    status <> 'ok' or (storage_path is not null and sha256 is not null)
  )
);

comment on table public.form_templates is
  'Cached blank official government forms. One row per '
  '(country_code, program, form_code). Written only by the form-refresh job; '
  'read by the delivery path. Never holds applicant data.';

create unique index if not exists form_templates_identity_idx
  on public.form_templates (country_code, program, form_code);

-- The refresh job''s worklist: oldest check first.
create index if not exists form_templates_checked_idx
  on public.form_templates (last_checked_at nulls first);

alter table public.form_templates enable row level security;

-- Blank government forms are not user-owned, and every authenticated user
-- needs the same rows, so SELECT is open to signed-in users. Writes are
-- service-role only: no policy grants insert, update, or delete, and RLS
-- denies by default. The refresh job uses SupabaseService.admin, which
-- bypasses RLS entirely.
create policy form_templates_authenticated_read
  on public.form_templates
  for select
  to authenticated
  using (true);

revoke insert, update, delete on public.form_templates from authenticated, anon;
```

- [ ] **Step 2: Apply the migration to a local stack and verify**

```bash
npx supabase@latest start
npx supabase@latest db push
```

Then confirm the schema landed and the guard constraint bites:

```bash
npx supabase@latest db psql -c "\d public.form_templates" | head -30
npx supabase@latest db psql -c \
  "insert into public.form_templates (country_code, program, form_code, landing_url, status)
   values ('CA','visitor_visa','IMM 5257','https://example.test/x', 'ok');"
```

Expected: the first prints the table with 18 columns; the second FAILS with
`new row for relation "form_templates" violates check constraint "form_templates_ok_requires_bytes"`.

- [ ] **Step 3: Verify a row without bytes is accepted**

```bash
npx supabase@latest db psql -c \
  "insert into public.form_templates (country_code, program, form_code, landing_url, status)
   values ('CA','visitor_visa','IMM 5257','https://example.test/x', 'error') returning id;"
npx supabase@latest db psql -c "delete from public.form_templates;"
```

Expected: INSERT 0 1, then DELETE 1.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260811120000_form_templates.sql
git commit -m "feat(forms): form_templates cache table and private storage bucket"
```

Do **not** apply this to production yet. Task 7 is the first thing that writes to it; apply after Task 7 lands.

---

### Task 5: FormTemplateStore

**Files:**
- Create: `apps/api/src/modules/forms/form-template.store.ts`
- Create: `apps/api/src/modules/forms/form-template.store.spec.ts`

**Interfaces:**
- Consumes: `FormCapability` from `./capability/form-capability.probe` (Task 2); table and bucket from Task 4; `SupabaseService` from `../shared/supabase/supabase.service`.
- Produces:
  - `interface FormTemplateRow` — the 18 columns of Task 4, snake_case
  - `type FormTemplateKey = { countryCode: string; program: string; formCode: string }`
  - `const FORM_TEMPLATES_BUCKET = 'form-templates'`
  - `function storagePathFor(key: FormTemplateKey, versionLabel: string | null): string`
  - `class FormTemplateStore` with `find`, `listAll`, `upsert`, `putBytes`, `getBytes`, `signedUrl`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/forms/form-template.store.spec.ts`:

```ts
import { FormTemplateStore, storagePathFor } from './form-template.store';
import type { SupabaseService } from '../shared/supabase/supabase.service';

/**
 * Records what the store sends to Supabase. The real client is a fluent
 * builder, so the fake returns itself from every builder method and resolves
 * at whichever terminal the caller reaches.
 */
function fakeSupabase(rows: unknown[] = []) {
  const calls: { table?: string; upserted?: unknown; onConflict?: string } = {};
  const uploads: { path: string; bytes: Uint8Array; contentType?: string }[] = [];

  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain;
  chain.maybeSingle = () =>
    Promise.resolve({ data: rows[0] ?? null, error: null });
  chain.then = (...a: unknown[]) =>
    Promise.resolve({ data: rows, error: null }).then(
      ...(a as [never, never]),
    );
  chain.upsert = (row: unknown, opts?: { onConflict?: string }) => {
    calls.upserted = row;
    calls.onConflict = opts?.onConflict;
    return Promise.resolve({ error: null });
  };

  const bucket = {
    upload: (path: string, bytes: Uint8Array, o?: { contentType?: string }) => {
      uploads.push({ path, bytes, contentType: o?.contentType });
      return Promise.resolve({ error: null });
    },
    download: () =>
      Promise.resolve({
        data: { arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) },
        error: null,
      }),
    createSignedUrl: (path: string) =>
      Promise.resolve({
        data: { signedUrl: `https://signed.test/${path}` },
        error: null,
      }),
  };

  const admin = {
    from: (t: string) => {
      calls.table = t;
      return chain;
    },
    storage: { from: () => bucket },
  };

  return {
    service: { admin } as unknown as SupabaseService,
    calls,
    uploads,
  };
}

describe('storagePathFor', () => {
  it('builds a versioned, slug-safe path', () => {
    expect(
      storagePathFor(
        { countryCode: 'CA', program: 'visitor_visa', formCode: 'IMM 5257' },
        '01-09-2023',
      ),
    ).toBe('CA/visitor_visa/imm-5257/01-09-2023.pdf');
  });

  it('falls back to "current" when the portal exposes no version', () => {
    expect(
      storagePathFor(
        { countryCode: 'CA', program: 'visitor_visa', formCode: 'IMM 5257' },
        null,
      ),
    ).toBe('CA/visitor_visa/imm-5257/current.pdf');
  });

  it('strips characters that would break a storage key', () => {
    expect(
      storagePathFor(
        { countryCode: 'CA', program: 'p', formCode: 'A/B..C' },
        '../evil',
      ),
    ).toBe('CA/p/a-b-c/-evil.pdf');
  });
});

describe('FormTemplateStore', () => {
  const key = {
    countryCode: 'CA',
    program: 'visitor_visa',
    formCode: 'IMM 5257',
  };

  it('reads from form_templates', async () => {
    const { service, calls } = fakeSupabase([{ form_code: 'IMM 5257' }]);
    const row = await new FormTemplateStore(service).find(key);
    expect(calls.table).toBe('form_templates');
    expect(row?.form_code).toBe('IMM 5257');
  });

  it('returns null when no row matches', async () => {
    const { service } = fakeSupabase([]);
    await expect(new FormTemplateStore(service).find(key)).resolves.toBeNull();
  });

  it('upserts on the identity triple so a refresh never duplicates a row', async () => {
    const { service, calls } = fakeSupabase();
    await new FormTemplateStore(service).upsert({
      country_code: 'CA',
      program: 'visitor_visa',
      form_code: 'IMM 5257',
      landing_url: 'https://example.test/x',
      status: 'error',
    });
    expect(calls.onConflict).toBe('country_code,program,form_code');
    expect(calls.upserted).toMatchObject({ form_code: 'IMM 5257' });
  });

  it('stamps updated_at on every upsert', async () => {
    const { service, calls } = fakeSupabase();
    await new FormTemplateStore(service).upsert({
      country_code: 'CA',
      program: 'visitor_visa',
      form_code: 'IMM 5257',
      landing_url: 'https://example.test/x',
      status: 'error',
    });
    expect(calls.upserted).toHaveProperty('updated_at');
  });

  it('uploads with a pdf content type and overwrites in place', async () => {
    const { service, uploads } = fakeSupabase();
    await new FormTemplateStore(service).putBytes(
      'CA/visitor_visa/imm-5257/01-09-2023.pdf',
      new Uint8Array([1, 2, 3]),
    );
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe('application/pdf');
  });

  it('mints a signed URL for a stored path', async () => {
    const { service } = fakeSupabase();
    await expect(
      new FormTemplateStore(service).signedUrl('CA/p/f/current.pdf', 300),
    ).resolves.toBe('https://signed.test/CA/p/f/current.pdf');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api test -- form-template.store.spec`
Expected: FAIL — `Cannot find module './form-template.store'`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/modules/forms/form-template.store.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { FormCapability } from './capability/form-capability.probe';

export const FORM_TEMPLATES_BUCKET = 'form-templates';

export interface FormTemplateRow {
  id: string;
  country_code: string;
  program: string;
  form_code: string;
  form_name: string;
  landing_url: string;
  resolved_pdf_url: string | null;
  version_label: string | null;
  storage_path: string | null;
  sha256: string | null;
  byte_size: number | null;
  capability: FormCapability;
  field_count: number | null;
  fetched_at: string | null;
  last_checked_at: string | null;
  status: 'ok' | 'stale' | 'blocked' | 'error';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type FormTemplateKey = {
  countryCode: string;
  program: string;
  formCode: string;
};

export type FormTemplateUpsert = Partial<
  Omit<FormTemplateRow, 'id' | 'created_at' | 'updated_at'>
> &
  Pick<FormTemplateRow, 'country_code' | 'program' | 'form_code' | 'landing_url'>;

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `<country>/<program>/<form-slug>/<version>.pdf`
 *
 * Version-scoped so a revision lands beside its predecessor instead of
 * overwriting it — a signed URL already handed to a user keeps resolving, and
 * the previous revision stays available if the new one turns out to be wrong.
 *
 * Every segment is slugged: form codes contain spaces and slashes, and a
 * version label is attacker-adjacent input (it comes from a remote page), so
 * `../` must never survive into a storage key.
 */
export function storagePathFor(
  key: FormTemplateKey,
  versionLabel: string | null,
): string {
  const version = versionLabel ? slug(versionLabel) : 'current';
  return `${slug(key.countryCode).toUpperCase()}/${key.program}/${slug(
    key.formCode,
  )}/${version || 'current'}.pdf`;
}

/**
 * The only code that touches `form_templates` or the `form-templates` bucket.
 *
 * Uses `SupabaseService.admin` throughout. That is correct here and is not the
 * usual RLS exception: these rows are not user-owned, the writer is a
 * background job with no request context, and reads are mediated by
 * FormsService, which authorises the application first.
 */
@Injectable()
export class FormTemplateStore {
  constructor(private readonly supabase: SupabaseService) {}

  async find(key: FormTemplateKey): Promise<FormTemplateRow | null> {
    const { data } = await this.supabase.admin
      .from('form_templates')
      .select('*')
      .eq('country_code', key.countryCode)
      .eq('program', key.program)
      .eq('form_code', key.formCode)
      .maybeSingle();
    return (data as FormTemplateRow | null) ?? null;
  }

  async listAll(): Promise<FormTemplateRow[]> {
    const { data } = await this.supabase.admin
      .from('form_templates')
      .select('*')
      .order('last_checked_at', { nullsFirst: true });
    return (data as FormTemplateRow[] | null) ?? [];
  }

  async upsert(row: FormTemplateUpsert): Promise<void> {
    const { error } = await this.supabase.admin
      .from('form_templates')
      .upsert(
        { ...row, updated_at: new Date().toISOString() },
        { onConflict: 'country_code,program,form_code' },
      );
    if (error) throw new Error(`form_templates upsert failed: ${error.message}`);
  }

  async putBytes(storagePath: string, bytes: Uint8Array): Promise<void> {
    const { error } = await this.supabase.admin.storage
      .from(FORM_TEMPLATES_BUCKET)
      .upload(storagePath, bytes, {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (error) throw new Error(`form template upload failed: ${error.message}`);
  }

  async getBytes(storagePath: string): Promise<Uint8Array | null> {
    const { data, error } = await this.supabase.admin.storage
      .from(FORM_TEMPLATES_BUCKET)
      .download(storagePath);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async signedUrl(
    storagePath: string,
    ttlSeconds: number,
  ): Promise<string | null> {
    const { data, error } = await this.supabase.admin.storage
      .from(FORM_TEMPLATES_BUCKET)
      .createSignedUrl(storagePath, ttlSeconds);
    if (error || !data) return null;
    return data.signedUrl;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter api test -- form-template.store.spec`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/forms/form-template.store.ts \
        apps/api/src/modules/forms/form-template.store.spec.ts
git commit -m "feat(forms): FormTemplateStore over form_templates and storage"
```

---

### Task 6: Form catalogue — application to required forms

This is the bridge that does not exist today. `strategyRegistry.resolve()` has **zero callers**, and `country_frameworks.visa_type` holds `'TRV'` while `VisaProgramId` is `'visitor_visa'`. Without this task the `FormSpec` entries in `canada.strategy.ts` are unreachable.

**Files:**
- Create: `apps/api/src/modules/forms/form-catalog.ts`
- Create: `apps/api/src/modules/forms/form-catalog.spec.ts`

**Interfaces:**
- Consumes: `strategyRegistry` from `../../strategies`.
- Produces:
  - `interface RequiredForm { formCode: string; formName: string; landingUrl: string | null; portalId: string; program: string }`
  - `function programIdForVisaType(visaType: string): string | null`
  - `function requiredFormsFor(countryCode: string, visaType: string): RequiredForm[]`
  - `function allCatalogedForms(): Array<RequiredForm & { countryCode: string }>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/forms/form-catalog.spec.ts`:

```ts
import '../../strategies'; // registers the built-in country strategies
import {
  programIdForVisaType,
  requiredFormsFor,
  allCatalogedForms,
} from './form-catalog';

describe('programIdForVisaType', () => {
  it('maps the seeded Canadian TRV code to the visitor program', () => {
    expect(programIdForVisaType('TRV')).toBe('visitor_visa');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(programIdForVisaType('  trv ')).toBe('visitor_visa');
  });

  it('passes a value that is already a program id straight through', () => {
    expect(programIdForVisaType('family_sponsorship')).toBe(
      'family_sponsorship',
    );
  });

  it('returns null for an unmapped visa type', () => {
    expect(programIdForVisaType('WHATEVER-9000')).toBeNull();
  });
});

describe('requiredFormsFor', () => {
  it('resolves IMM 5257 for a Canadian TRV', () => {
    const forms = requiredFormsFor('CA', 'TRV');
    expect(forms.map((f) => f.formCode)).toEqual(['IMM 5257']);
  });

  it('carries the landing URL from FormSpec.sourceUrl', () => {
    expect(requiredFormsFor('CA', 'TRV')[0].landingUrl).toBe(
      'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html',
    );
  });

  it('supplies a landing URL for a form whose FormSpec omits sourceUrl', () => {
    // canada.strategy.ts gives IMM 5645 no sourceUrl. Without the catalogue
    // fallback it would be permanently undiscoverable.
    const imm5645 = requiredFormsFor('CA', 'family_sponsorship').find(
      (f) => f.formCode === 'IMM 5645',
    );
    expect(imm5645?.landingUrl).toBe(
      'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5645.html',
    );
  });

  it('tags each form with the country portal id', () => {
    expect(requiredFormsFor('CA', 'TRV')[0].portalId).toBe('ircc');
  });

  it('returns an empty list for an unknown country', () => {
    expect(requiredFormsFor('ZZ', 'TRV')).toEqual([]);
  });

  it('returns an empty list for an unmappable visa type', () => {
    expect(requiredFormsFor('CA', 'WHATEVER-9000')).toEqual([]);
  });

  it('returns an empty list for a country whose programs declare no forms', () => {
    expect(requiredFormsFor('US', 'visitor_visa')).toEqual([]);
  });
});

describe('allCatalogedForms', () => {
  it('enumerates every form with a landing URL — the refresh worklist', () => {
    const all = allCatalogedForms();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((f) => f.landingUrl !== null)).toBe(true);
  });

  it('deduplicates a form that several programs require', () => {
    // IMM 5257 appears in both visitor_visa and family_sponsorship, but the
    // identity key is (country, program, formCode), so both rows are kept and
    // neither is duplicated within its own program.
    const ca = allCatalogedForms().filter((f) => f.countryCode === 'CA');
    const keys = ca.map((f) => `${f.program}/${f.formCode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api test -- form-catalog.spec`
Expected: FAIL — `Cannot find module './form-catalog'`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/modules/forms/form-catalog.ts`:

```ts
import { strategyRegistry } from '../../strategies';

/**
 * Application → the official forms it needs.
 *
 * Two gaps this closes, both real:
 *
 * 1. `strategyRegistry.resolve()` had ZERO callers. The FormSpec entries in
 *    canada.strategy.ts were unreachable from an application.
 * 2. `country_frameworks.visa_type` stores the public visa code ('TRV'), not
 *    a VisaProgramId ('visitor_visa'), and nothing mapped between them.
 *
 * Landing URLs come from FormSpec.sourceUrl when present. LANDING_URLS covers
 * the forms whose FormSpec omits it — IMM 5645 is required by the Super Visa
 * program with no sourceUrl, so without the fallback it could never be
 * discovered. Keep this map small: the right long-term home is FormSpec, and
 * every entry here is a form whose strategy should eventually carry its own
 * URL.
 */
export interface RequiredForm {
  formCode: string;
  formName: string;
  landingUrl: string | null;
  portalId: string;
  program: string;
}

/** Public visa code → VisaProgramId. Keys are compared case-insensitively. */
const VISA_TYPE_TO_PROGRAM: Record<string, string> = {
  trv: 'visitor_visa',
  'visitor visa': 'visitor_visa',
  visitor: 'visitor_visa',
  'super visa': 'family_sponsorship',
  'study permit': 'student_visa',
  'work permit': 'work_permit',
};

const KNOWN_PROGRAM_IDS = new Set([
  'visitor_visa',
  'tourist_visa',
  'business_visa',
  'student_visa',
  'work_permit',
  'family_sponsorship',
]);

const LANDING_URLS: Record<string, string> = {
  'IMM 5257':
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html',
  'IMM 5645':
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5645.html',
};

function normalize(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

export function programIdForVisaType(visaType: string): string | null {
  const key = normalize(visaType);
  if (!key) return null;
  if (KNOWN_PROGRAM_IDS.has(key)) return key;
  return VISA_TYPE_TO_PROGRAM[key] ?? null;
}

export function requiredFormsFor(
  countryCode: string,
  visaType: string,
): RequiredForm[] {
  const program = programIdForVisaType(visaType);
  if (!program) return [];

  const resolved = strategyRegistry.resolve(countryCode, program);
  if (!resolved) return [];

  const portalId = resolved.country.portal().portalId;
  const specs = resolved.program.forms?.() ?? [];

  return specs.map((spec) => ({
    formCode: spec.formCode,
    formName: spec.formName,
    landingUrl: spec.sourceUrl ?? LANDING_URLS[spec.formCode] ?? null,
    portalId,
    program,
  }));
}

/**
 * The refresh job's worklist: every (country, program, form) with a landing
 * URL. Forms without one are skipped — there is nothing to discover from.
 */
export function allCatalogedForms(): Array<
  RequiredForm & { countryCode: string }
> {
  const out: Array<RequiredForm & { countryCode: string }> = [];

  for (const { code, programs } of strategyRegistry.listCountries()) {
    for (const programId of programs) {
      for (const form of requiredFormsFor(code, programId)) {
        if (form.landingUrl) out.push({ ...form, countryCode: code });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter api test -- form-catalog.spec`
Expected: PASS, 14 tests.

If `requiredFormsFor('CA', 'family_sponsorship')` returns `[]`, check that `familySponsorshipProgram` forwards `opts.forms` into a `forms()` method the same way `visitorVisaProgram` does — read `apps/api/src/strategies/visa-program/family-sponsorship.strategy.ts` and fix the forwarding there rather than working around it here.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/forms/form-catalog.ts \
        apps/api/src/modules/forms/form-catalog.spec.ts
git commit -m "feat(forms): resolve an application's required forms from strategies"
```

---

### Task 7: Refresh job

**Files:**
- Create: `apps/api/src/modules/forms/form-refresh.service.ts`
- Create: `apps/api/src/modules/forms/form-refresh.service.spec.ts`
- Create: `apps/api/src/modules/forms/form-refresh.processor.ts`
- Create: `apps/api/src/modules/forms/form-refresh.scheduler.ts`
- Create: `apps/api/src/modules/forms/forms.module.ts`
- Modify: `apps/api/src/modules/shared/queue/queue.constants.ts`
- Modify: `apps/api/src/modules/shared/queue/queue.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `RobotsGate`, `FetchLike`, `defaultHttp`, `FORM_FETCH_USER_AGENT` (Task 1); `probeFormCapability` (Task 2); `resolveDiscoveryStrategy` (Task 3); `FormTemplateStore`, `storagePathFor` (Task 5); `allCatalogedForms`, `RequiredForm` (Task 6).
- Produces:
  - `type RefreshStatus = 'ok' | 'unchanged' | 'stale' | 'blocked' | 'error'`
  - `interface RefreshOutcome { countryCode: string; program: string; formCode: string; status: RefreshStatus; message?: string }`
  - `class FormRefreshService { refreshAll(): Promise<RefreshOutcome[]>; refreshOne(form: RequiredForm & { countryCode: string }): Promise<RefreshOutcome> }`
  - `const FORM_HTTP: symbol` — DI token for the injected `FetchLike`
  - `const FORM_REFRESH_QUEUE = 'form-refresh'`

**DI note — do not use default parameter values here.** `RobotsGate` and `FetchLike` cannot be constructor defaults on a Nest-managed provider: Nest reads `design:paramtypes` regardless of defaults, tries to resolve `RobotsGate` as a provider, and cannot resolve `FetchLike` at all (an interface erases to `Object`). The app would fail to boot with `Nest can't resolve dependencies of FormRefreshService`. Both are injected explicitly, and `FormsModule` provides them via factories in Step 8.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/forms/form-refresh.service.spec.ts`:

```ts
import { createHash } from 'node:crypto';
import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import { FormRefreshService } from './form-refresh.service';
import { RobotsGate } from './robots';
import type { FetchLike, HttpResponse } from './http';
import type { FormTemplateStore, FormTemplateRow } from './form-template.store';

const LANDING = 'https://gov.test/forms/f1.html';
const PDF_URL = 'https://gov.test/dam/forms/f1/01-09-2023/f1e.pdf';

const FORM = {
  countryCode: 'CA',
  program: 'visitor_visa',
  formCode: 'IMM 5257',
  formName: 'Application for Temporary Resident Visa',
  landingUrl: LANDING,
  portalId: 'ircc',
};

async function xfaPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.catalog.set(PDFName.of('NeedsRendering'), PDFBool.True);
  return pdf.save();
}

function res(over: Partial<HttpResponse> = {}): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(''),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    ...over,
  };
}

/** Serves robots.txt, the landing page, and the PDF from one stub. */
function http(opts: {
  robots?: string;
  landing?: string;
  pdf?: Uint8Array;
  pdfStatus?: number;
}): FetchLike {
  return (url) => {
    if (url.endsWith('/robots.txt')) {
      return Promise.resolve(
        res({ text: () => Promise.resolve(opts.robots ?? 'User-agent: *\n') }),
      );
    }
    if (url === LANDING) {
      return Promise.resolve(
        res({
          text: () =>
            Promise.resolve(
              opts.landing ??
                `<a href="/dam/forms/f1/01-09-2023/f1e.pdf">form</a>`,
            ),
        }),
      );
    }
    const status = opts.pdfStatus ?? 200;
    const bytes = opts.pdf ?? new Uint8Array([1, 2, 3]);
    return Promise.resolve(
      res({
        ok: status === 200,
        status,
        arrayBuffer: () =>
          Promise.resolve(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
          ),
      }),
    );
  };
}

function fakeStore(existing: Partial<FormTemplateRow> | null = null) {
  const upserts: Record<string, unknown>[] = [];
  const puts: { path: string; bytes: Uint8Array }[] = [];
  const store = {
    find: () => Promise.resolve(existing as FormTemplateRow | null),
    listAll: () => Promise.resolve([]),
    upsert: (row: Record<string, unknown>) => {
      upserts.push(row);
      return Promise.resolve();
    },
    putBytes: (path: string, bytes: Uint8Array) => {
      puts.push({ path, bytes });
      return Promise.resolve();
    },
    getBytes: () => Promise.resolve(null),
    signedUrl: () => Promise.resolve(null),
  } as unknown as FormTemplateStore;
  return { store, upserts, puts };
}

const last = (u: Record<string, unknown>[]) => u[u.length - 1];

describe('FormRefreshService.refreshOne', () => {
  it('discovers, downloads, probes, and stores a new form', async () => {
    const pdf = await xfaPdf();
    const { store, upserts, puts } = fakeStore(null);
    const svc = new FormRefreshService(
      store,
      new RobotsGate(http({ pdf })),
      http({ pdf }),
    );

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('ok');
    expect(puts).toHaveLength(1);
    expect(puts[0].path).toBe('CA/visitor_visa/imm-5257/01-09-2023.pdf');
    expect(last(upserts)).toMatchObject({
      status: 'ok',
      capability: 'xfa',
      version_label: '01-09-2023',
      resolved_pdf_url: PDF_URL,
      sha256: createHash('sha256').update(pdf).digest('hex'),
      byte_size: pdf.length,
    });
  });

  it('marks the row blocked and never fetches a robots-disallowed PDF', async () => {
    const robots = 'User-agent: *\nDisallow: /dam/forms/f1/\n';
    const fetched: string[] = [];
    const inner = http({ robots });
    const spy: FetchLike = (url, init) => {
      fetched.push(url);
      return inner(url, init);
    };

    const { store, upserts, puts } = fakeStore(null);
    const svc = new FormRefreshService(store, new RobotsGate(spy), spy);
    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('blocked');
    expect(puts).toHaveLength(0);
    expect(fetched).not.toContain(PDF_URL);
    expect(last(upserts)).toMatchObject({ status: 'blocked' });
  });

  it('skips the download when version and checksum are unchanged', async () => {
    const pdf = await xfaPdf();
    const sha = createHash('sha256').update(pdf).digest('hex');
    const { store, upserts, puts } = fakeStore({
      version_label: '01-09-2023',
      sha256: sha,
      storage_path: 'CA/visitor_visa/imm-5257/01-09-2023.pdf',
      status: 'ok',
    });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(http({ pdf })),
      http({ pdf }),
    );

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('unchanged');
    expect(puts).toHaveLength(0);
    expect(last(upserts)).toMatchObject({ status: 'ok' });
    expect(last(upserts)).toHaveProperty('last_checked_at');
  });

  it('re-downloads when the version label moves', async () => {
    const pdf = await xfaPdf();
    const { store, puts } = fakeStore({
      version_label: '01-01-2019',
      sha256: 'stale-checksum',
      storage_path: 'CA/visitor_visa/imm-5257/01-01-2019.pdf',
      status: 'ok',
    });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(http({ pdf })),
      http({ pdf }),
    );

    expect((await svc.refreshOne(FORM)).status).toBe('ok');
    expect(puts[0].path).toBe('CA/visitor_visa/imm-5257/01-09-2023.pdf');
  });

  it('re-downloads when the bytes changed under an unchanged version label', async () => {
    const pdf = await xfaPdf();
    const { store, puts } = fakeStore({
      version_label: '01-09-2023',
      sha256: 'a'.repeat(64), // same label, different content
      storage_path: 'CA/visitor_visa/imm-5257/01-09-2023.pdf',
      status: 'ok',
    });
    const svc = new FormRefreshService(
      store,
      new RobotsGate(http({ pdf })),
      http({ pdf }),
    );

    expect((await svc.refreshOne(FORM)).status).toBe('ok');
    expect(puts).toHaveLength(1);
  });

  it('degrades an existing cached copy to stale on a 404 download', async () => {
    const h = http({ pdfStatus: 404 });
    const { store, upserts, puts } = fakeStore({
      version_label: '01-01-2019',
      sha256: 'old',
      storage_path: 'CA/visitor_visa/imm-5257/01-01-2019.pdf',
      status: 'ok',
    });
    const svc = new FormRefreshService(store, new RobotsGate(h), h);

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('stale');
    expect(puts).toHaveLength(0);
    // The cached copy must survive so delivery keeps working.
    expect(last(upserts)).toMatchObject({
      status: 'stale',
      storage_path: 'CA/visitor_visa/imm-5257/01-01-2019.pdf',
    });
  });

  it('records error when a 404 leaves nothing cached', async () => {
    const h = http({ pdfStatus: 404 });
    const { store, upserts } = fakeStore(null);
    const svc = new FormRefreshService(store, new RobotsGate(h), h);

    expect((await svc.refreshOne(FORM)).status).toBe('error');
    expect(last(upserts)).toMatchObject({ status: 'error' });
    expect(String(last(upserts).error_message)).toContain('404');
  });

  it('records error on malformed landing HTML', async () => {
    const h = http({ landing: '<html>no link here</html>' });
    const { store, upserts } = fakeStore(null);
    const svc = new FormRefreshService(store, new RobotsGate(h), h);

    const out = await svc.refreshOne(FORM);

    expect(out.status).toBe('error');
    expect(String(last(upserts).error_message)).toMatch(/discover/i);
  });

  it('records error when no discovery strategy is registered for the portal', async () => {
    const h = http({});
    const { store, upserts } = fakeStore(null);
    const svc = new FormRefreshService(store, new RobotsGate(h), h);

    const out = await svc.refreshOne({ ...FORM, portalId: 'no-such-portal' });

    expect(out.status).toBe('error');
    expect(String(last(upserts).error_message)).toMatch(/no discovery strategy/i);
  });

  it('never throws — a store failure becomes an error outcome', async () => {
    const h = http({});
    const store = {
      find: () => Promise.reject(new Error('db down')),
    } as unknown as FormTemplateStore;
    const svc = new FormRefreshService(store, new RobotsGate(h), h);

    await expect(svc.refreshOne(FORM)).resolves.toMatchObject({
      status: 'error',
    });
  });
});
```

Register the test portal so `resolveDiscoveryStrategy('ircc')` matches: `FORM.portalId` is `'ircc'`, which `discovery.registry.ts` already registers, and the stub `http` serves the landing HTML, so the real canada.ca strategy runs against the stub. No extra registration is needed.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api test -- form-refresh.service.spec`
Expected: FAIL — `Cannot find module './form-refresh.service'`.

- [ ] **Step 3: Write `form-refresh.service.ts`**

```ts
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { RobotsGate } from './robots';
import { FORM_FETCH_USER_AGENT, type FetchLike } from './http';
import { resolveDiscoveryStrategy } from './discovery/discovery.registry';
import { probeFormCapability } from './capability/form-capability.probe';
import { FormTemplateStore, storagePathFor } from './form-template.store';
import { allCatalogedForms, type RequiredForm } from './form-catalog';

/** DI token for the injected fetch implementation. See the DI note above. */
export const FORM_HTTP = Symbol('FORM_HTTP');

export type RefreshStatus = 'ok' | 'unchanged' | 'stale' | 'blocked' | 'error';

export interface RefreshOutcome {
  countryCode: string;
  program: string;
  formCode: string;
  status: RefreshStatus;
  message?: string;
}

type CatalogedForm = RequiredForm & { countryCode: string };

/**
 * All network I/O for form fetching lives here, behind the scheduled job.
 * Nothing on a user request path calls this class.
 *
 * The invariant that shapes every branch: a failure NEVER removes a working
 * cached copy. A refresh that cannot reach the government site downgrades the
 * row to `stale` and leaves storage_path, sha256, and capability exactly as
 * they were, so delivery keeps serving the last good PDF. Only a form that
 * never cached successfully ends up `error`.
 */
@Injectable()
export class FormRefreshService {
  private readonly log = new Logger(FormRefreshService.name);

  constructor(
    private readonly store: FormTemplateStore,
    private readonly robots: RobotsGate,
    @Inject(FORM_HTTP) private readonly http: FetchLike,
  ) {}

  async refreshAll(): Promise<RefreshOutcome[]> {
    const out: RefreshOutcome[] = [];
    for (const form of allCatalogedForms()) {
      out.push(await this.refreshOne(form));
    }
    const failed = out.filter(
      (o) => o.status === 'error' || o.status === 'stale',
    );
    this.log.log(
      `form refresh: ${out.length} checked, ${failed.length} degraded`,
    );
    for (const f of failed) {
      this.log.warn(`${f.countryCode}/${f.formCode}: ${f.status} — ${f.message}`);
    }
    return out;
  }

  async refreshOne(form: CatalogedForm): Promise<RefreshOutcome> {
    const id = {
      countryCode: form.countryCode,
      program: form.program,
      formCode: form.formCode,
    };
    try {
      return await this.run(form, id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`refresh threw for ${form.formCode}: ${message}`);
      return { ...id, status: 'error', message };
    }
  }

  private async run(
    form: CatalogedForm,
    id: Pick<RefreshOutcome, 'countryCode' | 'program' | 'formCode'>,
  ): Promise<RefreshOutcome> {
    const existing = await this.store.find({
      countryCode: form.countryCode,
      program: form.program,
      formCode: form.formCode,
    });

    const base = {
      country_code: form.countryCode,
      program: form.program,
      form_code: form.formCode,
      form_name: form.formName,
      landing_url: form.landingUrl ?? '',
      last_checked_at: new Date().toISOString(),
    };

    // Preserve whatever is already cached, so a failure path can write a
    // status without destroying a working copy.
    const kept = {
      resolved_pdf_url: existing?.resolved_pdf_url ?? null,
      version_label: existing?.version_label ?? null,
      storage_path: existing?.storage_path ?? null,
      sha256: existing?.sha256 ?? null,
      byte_size: existing?.byte_size ?? null,
      capability: existing?.capability ?? ('unknown' as const),
      field_count: existing?.field_count ?? null,
      fetched_at: existing?.fetched_at ?? null,
    };
    const hasCachedCopy = Boolean(existing?.storage_path && existing?.sha256);
    const degraded: 'stale' | 'error' = hasCachedCopy ? 'stale' : 'error';

    const fail = async (
      status: 'stale' | 'error',
      message: string,
    ): Promise<RefreshOutcome> => {
      await this.store.upsert({
        ...base,
        ...kept,
        status,
        error_message: message.slice(0, 1000),
      });
      return { ...id, status, message };
    };

    if (!form.landingUrl) {
      return fail(degraded, 'no landing URL for this form');
    }

    const strategy = resolveDiscoveryStrategy(form.portalId);
    if (!strategy) {
      return fail(degraded, `no discovery strategy for portal ${form.portalId}`);
    }

    const found = await strategy.discover(form.landingUrl, this.http);
    if (!found) {
      return fail(
        degraded,
        `could not discover a PDF link on ${form.landingUrl}`,
      );
    }

    // robots.txt is checked against the RESOLVED PDF URL, not the landing
    // page: canada.ca disallows individual form PDFs by filename while
    // allowing the page that links to them.
    if (!(await this.robots.allows(found.pdfUrl))) {
      await this.store.upsert({
        ...base,
        ...kept,
        resolved_pdf_url: found.pdfUrl,
        status: 'blocked',
        error_message: `robots.txt disallows ${found.pdfUrl}`,
      });
      return {
        ...id,
        status: 'blocked',
        message: `robots.txt disallows ${found.pdfUrl}`,
      };
    }

    let bytes: Uint8Array;
    try {
      const res = await this.http(found.pdfUrl, {
        headers: { 'user-agent': FORM_FETCH_USER_AGENT },
      });
      if (!res.ok) {
        return fail(degraded, `download failed: HTTP ${res.status}`);
      }
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(degraded, `download failed: ${message}`);
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');

    // Both must match. The label alone misses a silent re-issue under the same
    // path — the case where a stale field mapping would fill the wrong boxes.
    if (
      existing?.sha256 === sha256 &&
      existing?.version_label === found.versionLabel &&
      existing?.storage_path
    ) {
      await this.store.upsert({ ...base, ...kept, status: 'ok', error_message: null });
      return { ...id, status: 'unchanged' };
    }

    const probe = await probeFormCapability(bytes);
    const storagePath = storagePathFor(
      {
        countryCode: form.countryCode,
        program: form.program,
        formCode: form.formCode,
      },
      found.versionLabel,
    );

    await this.store.putBytes(storagePath, bytes);
    await this.store.upsert({
      ...base,
      resolved_pdf_url: found.pdfUrl,
      version_label: found.versionLabel,
      storage_path: storagePath,
      sha256,
      byte_size: bytes.length,
      capability: probe.capability,
      field_count: probe.fieldCount,
      fetched_at: new Date().toISOString(),
      status: 'ok',
      error_message: null,
    });

    return { ...id, status: 'ok' };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter api test -- form-refresh.service.spec`
Expected: PASS, 10 tests.

- [ ] **Step 5: Add the queue constant**

In `apps/api/src/modules/shared/queue/queue.constants.ts`, append:

```ts
export const FORM_REFRESH_QUEUE = 'form-refresh';
```

In `apps/api/src/modules/shared/queue/queue.module.ts`, add `FORM_REFRESH_QUEUE` to the import list from `./queue.constants` and add this line beside the other `registerQueue` calls:

```ts
    BullModule.registerQueue({ name: FORM_REFRESH_QUEUE }),
```

- [ ] **Step 6: Write the processor**

Create `apps/api/src/modules/forms/form-refresh.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { FORM_REFRESH_QUEUE } from '../shared/queue/queue.constants';
import { FormRefreshService } from './form-refresh.service';

@Injectable()
@Processor(FORM_REFRESH_QUEUE)
export class FormRefreshProcessor extends WorkerHost {
  private readonly log = new Logger(FormRefreshProcessor.name);

  constructor(private readonly refresh: FormRefreshService) {
    super();
  }

  async process(): Promise<void> {
    const results = await this.refresh.refreshAll();
    const counts = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    this.log.log(`form refresh complete: ${JSON.stringify(counts)}`);
  }
}
```

- [ ] **Step 7: Write the scheduler**

Create `apps/api/src/modules/forms/form-refresh.scheduler.ts`:

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { FORM_REFRESH_QUEUE } from '../shared/queue/queue.constants';

@Injectable()
export class FormRefreshScheduler implements OnModuleInit {
  constructor(@InjectQueue(FORM_REFRESH_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    // Daily at 02:00 UTC — before the 03:00 pricing recompute and well clear
    // of business hours in every corridor. Government forms are revised a few
    // times a year, so daily is already generous; anything faster is load on
    // someone else's server for no gain. Fixed jobId so repeated boots do not
    // duplicate the schedule.
    await this.queue.add(
      'daily-form-refresh',
      {},
      {
        repeat: { pattern: '0 2 * * *' },
        jobId: 'form-refresh-daily',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
```

- [ ] **Step 8: Write the module and register it**

Create `apps/api/src/modules/forms/forms.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FORM_REFRESH_QUEUE } from '../shared/queue/queue.constants';
import { defaultHttp, type FetchLike } from './http';
import { RobotsGate } from './robots';
import { FormTemplateStore } from './form-template.store';
import { FormRefreshService, FORM_HTTP } from './form-refresh.service';
import { FormRefreshProcessor } from './form-refresh.processor';
import { FormRefreshScheduler } from './form-refresh.scheduler';

/**
 * Automatic official-form delivery. SupabaseService resolves from @Global
 * scope; the job runs on the global BullMQ connection (QueueModule).
 *
 * The fetch implementation is a token, not a default parameter: Nest reads
 * design:paramtypes regardless of defaults, and a `FetchLike` interface
 * erases to Object, which it cannot resolve. Injecting it also means a test
 * or a future per-portal transport can swap it without touching the service.
 */
@Module({
  imports: [BullModule.registerQueue({ name: FORM_REFRESH_QUEUE })],
  providers: [
    { provide: FORM_HTTP, useValue: defaultHttp },
    {
      provide: RobotsGate,
      useFactory: (http: FetchLike) => new RobotsGate(http),
      inject: [FORM_HTTP],
    },
    FormTemplateStore,
    FormRefreshService,
    FormRefreshProcessor,
    FormRefreshScheduler,
  ],
  exports: [FormTemplateStore, FormRefreshService],
})
export class FormsModule {}
```

In `apps/api/src/app.module.ts`, add the import beside the others and `FormsModule` to the `imports` array (next to `ReconciliationModule` at line 147):

```ts
import { FormsModule } from './modules/forms/forms.module';
```

- [ ] **Step 9: Verify the app still builds and the DI graph resolves**

Run: `pnpm --filter api build`
Expected: exit 0, no TypeScript errors.

Run: `pnpm --filter api test -- di-graph.spec`
Expected: PASS. This spec instantiates the module graph; a missing provider fails here rather than at boot.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/forms/ \
        apps/api/src/modules/shared/queue/queue.constants.ts \
        apps/api/src/modules/shared/queue/queue.module.ts \
        apps/api/src/app.module.ts
git commit -m "feat(forms): daily refresh job for cached official form templates"
```

---

### Task 8: Delivery read path

**Files:**
- Create: `apps/api/src/modules/forms/forms.service.ts`
- Create: `apps/api/src/modules/forms/forms.service.spec.ts`
- Create: `apps/api/src/modules/forms/forms.controller.ts`
- Modify: `apps/api/src/modules/forms/forms.module.ts`

**Interfaces:**
- Consumes: `FormTemplateStore` (Task 5); `requiredFormsFor` (Task 6); `FormCapability` (Task 2); `JwtGuard`, `PlanGuard`, `CurrentUser`, `SupabaseUserClient` from `../auth/`.
- Produces:
  - `interface DeliveredForm { formCode: string; formName: string; capability: FormCapability; versionLabel: string | null; downloadUrl: string | null; officialUrl: string | null; source: 'cache' | 'official-link'; prefillable: boolean }`
  - `class FormsService { listForApplication(db, applicationId, userId): Promise<DeliveredForm[]> }`
  - `GET /forms/:applicationId` → `DeliveredForm[]`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/forms/forms.service.spec.ts`:

```ts
import '../../strategies';
import { FormsService } from './forms.service';
import type { FormTemplateStore, FormTemplateRow } from './form-template.store';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Scoped client fake. `visible: false` models an RLS-filtered row — the
 * not-your-application case — so the denial path is asserted, not assumed.
 */
function scopedDb(visible: boolean, framework = { country_code: 'CA', visa_type: 'TRV' }) {
  const result = Promise.resolve({
    data: visible ? { id: 'app-1', country_frameworks: framework } : null,
    error: null,
  });
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit']) chain[m] = () => chain;
  chain.single = () => result;
  chain.maybeSingle = () => result;
  return { from: () => chain } as unknown as SupabaseClient;
}

function storeWith(row: Partial<FormTemplateRow> | null) {
  return {
    find: () => Promise.resolve(row as FormTemplateRow | null),
    signedUrl: (p: string) => Promise.resolve(`https://signed.test/${p}`),
  } as unknown as FormTemplateStore;
}

describe('FormsService.listForApplication', () => {
  it('serves a signed download for a cached form', async () => {
    const svc = new FormsService(
      storeWith({
        status: 'ok',
        storage_path: 'CA/visitor_visa/imm-5257/01-09-2023.pdf',
        version_label: '01-09-2023',
        capability: 'xfa',
      }),
    );

    const [form] = await svc.listForApplication(scopedDb(true), 'app-1', 'u1');

    expect(form.formCode).toBe('IMM 5257');
    expect(form.source).toBe('cache');
    expect(form.downloadUrl).toBe(
      'https://signed.test/CA/visitor_visa/imm-5257/01-09-2023.pdf',
    );
    expect(form.versionLabel).toBe('01-09-2023');
  });

  it('serves a stale cached copy — a failed refresh must not break delivery', async () => {
    const svc = new FormsService(
      storeWith({
        status: 'stale',
        storage_path: 'CA/visitor_visa/imm-5257/01-01-2019.pdf',
        version_label: '01-01-2019',
        capability: 'xfa',
      }),
    );

    const [form] = await svc.listForApplication(scopedDb(true), 'app-1', 'u1');
    expect(form.source).toBe('cache');
    expect(form.downloadUrl).toContain('01-01-2019');
  });

  it('falls back to the official link when nothing is cached', async () => {
    const svc = new FormsService(storeWith(null));
    const [form] = await svc.listForApplication(scopedDb(true), 'app-1', 'u1');

    expect(form.source).toBe('official-link');
    expect(form.downloadUrl).toBeNull();
    expect(form.officialUrl).toContain('imm5257.html');
  });

  it('falls back to the official link when robots.txt blocked the form', async () => {
    const svc = new FormsService(
      storeWith({ status: 'blocked', storage_path: null, capability: 'unknown' }),
    );
    const [form] = await svc.listForApplication(scopedDb(true), 'app-1', 'u1');
    expect(form.source).toBe('official-link');
  });

  it('marks an acroform template prefillable and an xfa one not', async () => {
    const acro = new FormsService(
      storeWith({
        status: 'ok',
        storage_path: 'p.pdf',
        capability: 'acroform',
        version_label: null,
      }),
    );
    const xfa = new FormsService(
      storeWith({
        status: 'ok',
        storage_path: 'p.pdf',
        capability: 'xfa',
        version_label: null,
      }),
    );

    expect(
      (await acro.listForApplication(scopedDb(true), 'app-1', 'u1'))[0]
        .prefillable,
    ).toBe(true);
    expect(
      (await xfa.listForApplication(scopedDb(true), 'app-1', 'u1'))[0]
        .prefillable,
    ).toBe(false);
  });

  it('throws NotFound when the application is not visible under the caller scope', async () => {
    const svc = new FormsService(storeWith(null));
    await expect(
      svc.listForApplication(scopedDb(false), 'app-1', 'u1'),
    ).rejects.toThrow(/not found/i);
  });

  it('returns an empty list when the program declares no forms', async () => {
    const svc = new FormsService(storeWith(null));
    const db = scopedDb(true, { country_code: 'US', visa_type: 'visitor_visa' });
    await expect(svc.listForApplication(db, 'app-1', 'u1')).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api test -- forms.service.spec`
Expected: FAIL — `Cannot find module './forms.service'`.

- [ ] **Step 3: Write `forms.service.ts`**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FormTemplateStore } from './form-template.store';
import { requiredFormsFor } from './form-catalog';
import type { FormCapability } from './capability/form-capability.probe';

/** How long a form download link stays valid. */
const SIGNED_URL_TTL_SECONDS = 15 * 60;

export interface DeliveredForm {
  formCode: string;
  formName: string;
  capability: FormCapability;
  versionLabel: string | null;
  /** Signed link to the cached blank form, or null when none is cached. */
  downloadUrl: string | null;
  /** The government landing page. Always present as a fallback and a check. */
  officialUrl: string | null;
  source: 'cache' | 'official-link';
  /** Can VisaAI produce a filled copy? False for XFA forms. */
  prefillable: boolean;
}

/**
 * The request path. Reads the cache only — never the internet.
 *
 * Delivery is a READ, not a write into `public.documents`. That table is
 * applicant evidence: vri/graphs/nodes/load-vri-data.ts scores every row, and
 * documents/graphs/nodes/check-docs-ready.ts waits for all rows to reach a
 * terminal ocr_status. Inserting a blank form there would inflate the
 * readiness score and, since no OCR job is enqueued for it, block
 * cross-verification for that application permanently.
 *
 * Degradation is deliberate: `blocked`, missing, and errored rows all fall
 * back to the official landing link, which is exactly what the applicant does
 * today. The feature can only improve on the status quo, never break it.
 */
@Injectable()
export class FormsService {
  constructor(private readonly store: FormTemplateStore) {}

  async listForApplication(
    db: SupabaseClient,
    applicationId: string,
    _userId: string,
  ): Promise<DeliveredForm[]> {
    // The caller-scoped client enforces RLS: an application belonging to
    // someone else returns no row, so this doubles as the authorization check.
    const { data: app } = await db
      .from('applications')
      .select('id, country_frameworks(country_code, visa_type)')
      .eq('id', applicationId)
      .single();

    if (!app) throw new NotFoundException('Application not found');

    const framework = app.country_frameworks as unknown as {
      country_code: string;
      visa_type: string;
    } | null;
    if (!framework) return [];

    const required = requiredFormsFor(
      framework.country_code,
      framework.visa_type,
    );

    const out: DeliveredForm[] = [];
    for (const form of required) {
      const row = await this.store.find({
        countryCode: framework.country_code,
        program: form.program,
        formCode: form.formCode,
      });

      const cached =
        row?.storage_path && (row.status === 'ok' || row.status === 'stale');

      const downloadUrl = cached
        ? await this.store.signedUrl(row.storage_path!, SIGNED_URL_TTL_SECONDS)
        : null;

      out.push({
        formCode: form.formCode,
        formName: form.formName,
        capability: row?.capability ?? 'unknown',
        versionLabel: row?.version_label ?? null,
        downloadUrl,
        officialUrl: form.landingUrl,
        source: downloadUrl ? 'cache' : 'official-link',
        prefillable: row?.capability === 'acroform',
      });
    }
    return out;
  }
}
```

- [ ] **Step 4: Write `forms.controller.ts`**

```ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JwtGuard } from '../auth/jwt.guard';
import { PlanGuard } from '../auth/plan.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.guard';
import { FormsService } from './forms.service';

@Controller('forms')
@UseGuards(JwtGuard, PlanGuard)
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  /** The blank official forms this application needs, ready to download. */
  @Get(':applicationId')
  async list(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.forms.listForApplication(db, applicationId, user.id);
  }
}
```

- [ ] **Step 5: Register the controller and service**

In `apps/api/src/modules/forms/forms.module.ts`, add the imports and update the decorator so it reads:

```ts
@Module({
  imports: [BullModule.registerQueue({ name: FORM_REFRESH_QUEUE })],
  controllers: [FormsController],
  providers: [
    { provide: FORM_HTTP, useValue: defaultHttp },
    {
      provide: RobotsGate,
      useFactory: (http: FetchLike) => new RobotsGate(http),
      inject: [FORM_HTTP],
    },
    FormTemplateStore,
    FormRefreshService,
    FormRefreshProcessor,
    FormRefreshScheduler,
    FormsService,
  ],
  exports: [FormTemplateStore, FormRefreshService, FormsService],
})
export class FormsModule {}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter api test -- forms.service.spec`
Expected: PASS, 7 tests.

Run: `pnpm --filter api build && pnpm --filter api test -- di-graph.spec`
Expected: build exit 0, DI spec PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/forms/forms.service.ts \
        apps/api/src/modules/forms/forms.service.spec.ts \
        apps/api/src/modules/forms/forms.controller.ts \
        apps/api/src/modules/forms/forms.module.ts
git commit -m "feat(forms): GET /forms/:applicationId serves cached official forms"
```

---

### Task 9: Official-forms section on the documents page

**Files:**
- Create: `apps/web/app/[locale]/(dashboard)/documents/[applicationId]/official-forms.tsx`
- Modify: `apps/web/app/[locale]/(dashboard)/documents/[applicationId]/documents-client.tsx`

**Interfaces:**
- Consumes: `GET /forms/:applicationId` from Task 8, returning `DeliveredForm[]`.
- Produces: `<OfficialForms applicationId={string} accessToken={string} />`

**Before writing any code in this task:** read the relevant guide under `apps/web/node_modules/next/dist/docs/`. Per `apps/web/AGENTS.md`, this Next.js version has breaking changes from what you may expect, and the App Router conventions may differ from your training data.

- [ ] **Step 1: Read the existing client to match its conventions**

```bash
sed -n '1,80p' "apps/web/app/[locale]/(dashboard)/documents/[applicationId]/documents-client.tsx"
```

Note how it obtains the Supabase access token, how it calls the API base URL, and which UI primitives from `components/ui/` it uses. Match them exactly — do not introduce a new fetch helper, a new card component, or a new spacing scale.

- [ ] **Step 2: Write the component**

Create `apps/web/app/[locale]/(dashboard)/documents/[applicationId]/official-forms.tsx`. Use the token/fetch/UI conventions observed in Step 1; the logic below is the part that is specific to this feature:

```tsx
'use client'

import { useEffect, useState } from 'react'

type DeliveredForm = {
  formCode: string
  formName: string
  capability: 'acroform' | 'xfa' | 'unknown'
  versionLabel: string | null
  downloadUrl: string | null
  officialUrl: string | null
  source: 'cache' | 'official-link'
  prefillable: boolean
}

export function OfficialForms({
  applicationId,
  accessToken,
}: {
  applicationId: string
  accessToken: string
}) {
  const [forms, setForms] = useState<DeliveredForm[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/forms/${applicationId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        )
        if (!res.ok) {
          // Surface the status and request id rather than swallowing them —
          // a bare `catch {}` here is what hid the billing outage.
          const requestId = res.headers.get('x-request-id')
          setError(`${res.status}${requestId ? ` · ${requestId}` : ''}`)
          return
        }
        const body = (await res.json()) as DeliveredForm[]
        if (!cancelled) setForms(body)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'network error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applicationId, accessToken])

  // A failed load is SHOWN, not swallowed. Rendering null here would repeat
  // the pattern that hid the billing outage: the user sees a missing section
  // and cannot tell it from "this program needs no forms". The status and
  // request id go on screen so a support message carries them.
  if (error) {
    return (
      <section className="mb-8">
        <h2 className="type-h3 mb-1">Official forms</h2>
        <p className="text-[13px] text-rose mb-2">
          Couldn’t load your official forms ({error}). You can still get them
          from the government site.
        </p>
        <a
          href="https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides.html"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 text-[13px]"
        >
          Open the official forms page
        </a>
      </section>
    )
  }

  // Still loading, or this program genuinely needs no forms: render nothing.
  // This section is additive — it must never block the upload flow below it.
  if (!forms || forms.length === 0) return null

  return (
    <section className="mb-8">
      <h2 className="type-h3 mb-1">Official forms</h2>
      <p className="text-[13px] text-midtone-gray mb-4">
        The current blank forms for your application, straight from the
        government site. You do not need to download them yourself.
      </p>

      <ul className="flex flex-col gap-3">
        {forms.map((form) => (
          <li
            key={form.formCode}
            className="flex items-center justify-between gap-4 rounded border border-hairline-2 p-4"
          >
            <div>
              <p className="text-[14px]">
                {form.formCode} — {form.formName}
              </p>
              <p className="text-[12px] text-midtone-gray">
                {form.versionLabel
                  ? `Version ${form.versionLabel}`
                  : 'Current version'}
                {form.capability === 'xfa' &&
                  ' · opens in Adobe Acrobat Reader'}
              </p>
            </div>

            {form.downloadUrl ? (
              <a
                href={form.downloadUrl}
                className="underline underline-offset-2 text-[13px]"
                download
              >
                Download
              </a>
            ) : (
              <a
                href={form.officialUrl ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 text-[13px]"
              >
                Open official page
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 3: Render it on the documents page**

In `documents-client.tsx`, import the component and render it above the upload area, passing the same `applicationId` and access token the file already has in scope:

```tsx
<OfficialForms applicationId={applicationId} accessToken={accessToken} />
```

- [ ] **Step 4: Verify the build and lint pass**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: exit 0 for both.

- [ ] **Step 5: Verify against a running stack**

```bash
pnpm --filter api start:dev   # terminal 1
pnpm --filter web dev         # terminal 2
```

Open `http://localhost:3000/en/documents/<an-application-id>`.

Expected before the refresh job has ever run: the section renders each required form with an **Open official page** link (nothing is cached yet). This is the designed fallback, and confirms the feature degrades to today's behaviour rather than to an error.

Then trigger one refresh so the cache fills, and reload:

```bash
curl -s localhost:4000/health > /dev/null   # confirm the API is up
```

The daily job runs at 02:00 UTC, so for a manual run add a temporary one-off enqueue or invoke `FormRefreshService.refreshAll()` from a scratch script — **do not** commit either. After it completes, the same page must show **Download** with a version label.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/[locale]/(dashboard)/documents/[applicationId]/official-forms.tsx" \
        "apps/web/app/[locale]/(dashboard)/documents/[applicationId]/documents-client.tsx"
git commit -m "feat(web): show cached official forms on the documents page"
```

---

### Task 10: Point prefill at the cache and delete the dead URL

This is seam 2 from the spec: prefill where capability allows. For IRCC forms it will correctly no-op, because they are XFA — but it will now no-op *visibly* instead of silently.

**Files:**
- Modify: `apps/api/src/modules/prefill/forms/imm5257.ts`
- Modify: `apps/api/src/modules/prefill/forms/index.ts`
- Modify: `apps/api/src/modules/prefill/prefill.module.ts`
- Create: `apps/api/src/modules/prefill/forms/imm5257.spec.ts`

**Interfaces:**
- Consumes: `FormTemplateStore` (Task 5), `FormsModule` export (Task 7).
- Produces:
  - `type TemplateLoader = (formCode: string) => Promise<Uint8Array | null>`
  - `function setTemplateLoader(loader: TemplateLoader | null): void`
  - `renderImm5257` keeps its existing signature: `(payload: PrefilledFormPayload) => Promise<Uint8Array | null>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/prefill/forms/imm5257.spec.ts`:

```ts
import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import type { PrefilledFormPayload } from '@visaai/types';
import { renderImm5257, setTemplateLoader } from './imm5257';

function payload(): PrefilledFormPayload {
  return {
    visaType: 'visitor',
    countryCode: 'CA',
    purpose: 'tourism',
    generatedAt: new Date('2026-08-11T00:00:00Z').toISOString(),
    fields: [
      { key: 'family_name', label: 'Family name', value: 'Smith', group: 'Personal' },
    ],
  };
}

async function xfaTemplate(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.catalog.set(PDFName.of('NeedsRendering'), PDFBool.True);
  return pdf.save();
}

/** An AcroForm carrying one of the names in FIELD_MAP. */
async function acroTemplate(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  pdf
    .getForm()
    .createTextField('Names.FamilyName')
    .addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  return pdf.save();
}

afterEach(() => setTemplateLoader(null));

describe('renderImm5257', () => {
  it('returns null when no template is cached', async () => {
    setTemplateLoader(() => Promise.resolve(null));
    await expect(renderImm5257(payload())).resolves.toBeNull();
  });

  it('returns null for an XFA template — pdf-lib cannot fill it', async () => {
    const bytes = await xfaTemplate();
    setTemplateLoader(() => Promise.resolve(bytes));
    await expect(renderImm5257(payload())).resolves.toBeNull();
  });

  it('fills an AcroForm template and returns a loadable PDF', async () => {
    const bytes = await acroTemplate();
    setTemplateLoader(() => Promise.resolve(bytes));

    const out = await renderImm5257(payload());
    expect(out).not.toBeNull();

    const reloaded = await PDFDocument.load(out!);
    expect(reloaded.getForm().getTextField('Names.FamilyName').getText()).toBe(
      'Smith',
    );
  });

  it('requests the template by form code', async () => {
    const seen: string[] = [];
    setTemplateLoader((code) => {
      seen.push(code);
      return Promise.resolve(null);
    });
    await renderImm5257(payload());
    expect(seen).toEqual(['IMM 5257']);
  });

  it('returns null rather than throwing when the loader rejects', async () => {
    setTemplateLoader(() => Promise.reject(new Error('storage down')));
    await expect(renderImm5257(payload())).resolves.toBeNull();
  });

  it('makes no network call — there is no loader by default', async () => {
    // The dead canada.ca URL is gone. With no loader wired, the renderer
    // degrades immediately instead of fetching anything.
    await expect(renderImm5257(payload())).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api test -- imm5257.spec`
Expected: FAIL — `setTemplateLoader is not exported`.

- [ ] **Step 3: Rewrite the template-loading half of `imm5257.ts`**

Replace lines 1–74 of `apps/api/src/modules/prefill/forms/imm5257.ts` (the header comment, `DEFAULT_TEMPLATE_URL`, `cachedTemplate`, `TEMPLATE_TTL_MS`, and `loadTemplate`) with:

```ts
import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';
import type { PrefilledFormPayload, PrefilledFormField } from '@visaai/types';

/**
 * IMM 5257 — Application for Temporary Resident Visa (IRCC, Canada).
 *
 * WHAT CHANGED AND WHY
 *
 * This module used to fetch a hardcoded canada.ca URL on every render. That
 * URL returns 200 text/html — not a PDF — so PDFDocument.load threw, the
 * renderer returned null, and every prefill silently degraded to the VisaAI
 * summary PDF. Nothing logged it, so it looked like a working feature.
 *
 * Templates now come from the forms module's cache (FormTemplateStore), which
 * discovers the current versioned URL from IRCC's stable landing page. The
 * loader is injected rather than imported to keep prefill free of a dependency
 * on the forms module and to let this file be tested without Supabase.
 *
 * REALITY CHECK: the live IMM 5257 is dynamic XFA — 0 AcroForm fields and
 * NeedsRendering true — so pdf-lib cannot fill it, and this renderer correctly
 * returns null for it. The AcroForm path below is not dead code: it is what
 * runs for portals that publish true AcroForms, and FormCapabilityProbe tells
 * the delivery layer which is which. Returning null here is now an honest
 * "cannot fill", not a masked fetch failure.
 */

export type TemplateLoader = (formCode: string) => Promise<Uint8Array | null>;

const FORM_CODE = 'IMM 5257';

let templateLoader: TemplateLoader | null = null;

/** Wired at boot by PrefillModule. Pass null to reset (tests). */
export function setTemplateLoader(loader: TemplateLoader | null): void {
  templateLoader = loader;
}

async function loadTemplate(): Promise<Uint8Array | null> {
  if (!templateLoader) return null;
  try {
    return await templateLoader(FORM_CODE);
  } catch {
    return null;
  }
}
```

Keep `FIELD_MAP`, `byKey`, and `renderImm5257` exactly as they are, with one change in `renderImm5257`: the loader now returns `Uint8Array | null` instead of `ArrayBuffer | null`, and `PDFDocument.load` accepts both, so the existing body needs no edit beyond its local type.

**`FIELD_MAP` stays — this is a deliberate decision, not an oversight.** The live IMM 5257 is XFA, so these 52 lines cannot execute today, and a reviewer is expected to flag them as dead code. They stay because the capability probe gates entry to this renderer, so they cost nothing at runtime, and because deleting them discards real field-name research that a future IRCC AcroForm revision would require rebuilding. Add this comment directly above `FIELD_MAP`:

```ts
// FIELD_MAP survives the XFA finding on purpose: probeFormCapability gates
// entry to this renderer, so these lines run only if IRCC ships an AcroForm
// revision. The XFA path costs them nothing at runtime.
```

Confirm the first lines of `renderImm5257` still read:

```ts
  const bytes = await loadTemplate();
  if (!bytes) return null;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter api test -- imm5257.spec`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the loader at boot**

In `apps/api/src/modules/prefill/prefill.module.ts`, import `FormsModule` and `FormTemplateStore`, then wire the loader in `OnModuleInit`:

```ts
import { Module, OnModuleInit } from '@nestjs/common';
import { PrefillController } from './prefill.controller';
import { PrefillService } from './prefill.service';
import { FormsModule } from '../forms/forms.module';
import { FormTemplateStore } from '../forms/form-template.store';
import { setTemplateLoader } from './forms/imm5257';

/**
 * Prefill depends on the forms cache for official templates but not the other
 * way round. The loader is injected here rather than imported inside the
 * renderer so the renderer stays testable without Supabase.
 */
@Module({
  imports: [FormsModule],
  controllers: [PrefillController],
  providers: [PrefillService],
  exports: [PrefillService],
})
export class PrefillModule implements OnModuleInit {
  constructor(private readonly templates: FormTemplateStore) {}

  onModuleInit() {
    setTemplateLoader(async (formCode) => {
      // Canada is the only corridor with a registered renderer today; the
      // lookup is by form code, so a second country needs no change here.
      const row = await this.templates.find({
        countryCode: 'CA',
        program: 'visitor_visa',
        formCode,
      });
      if (!row?.storage_path) return null;
      if (row.capability !== 'acroform') return null; // XFA: not fillable
      return this.templates.getBytes(row.storage_path);
    });
  }
}
```

- [ ] **Step 6: Verify nothing else referenced the deleted env var**

Run: `grep -rn "IRCC_IMM5257_TEMPLATE_URL" apps packages supabase .env.example`
Expected: no matches. If `.env.example` still declares it, delete that line in this commit.

- [ ] **Step 7: Run the full API suite**

Run: `pnpm --filter api test`
Expected: PASS. `prefill-pdf.spec.ts` exercises the summary-PDF path and must be unaffected — it does not touch `imm5257.ts`.

Run: `pnpm --filter api build`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/prefill/forms/imm5257.ts \
        apps/api/src/modules/prefill/forms/imm5257.spec.ts \
        apps/api/src/modules/prefill/prefill.module.ts
git commit -m "fix(prefill): load IMM 5257 from the form cache, drop the dead URL

The hardcoded canada.ca template URL returns text/html, not a PDF, so every
IMM 5257 prefill has silently degraded to the VisaAI summary PDF since the
form was last revised. Templates now come from the forms cache, which
discovers the current versioned URL from IRCC's stable landing page.

The live form is dynamic XFA (0 AcroForm fields, NeedsRendering true), so the
renderer still returns null for it — but that is now an honest 'cannot fill'
rather than a masked fetch failure."
```

---

## Deployment

After Task 10 lands and the suite is green:

1. **Apply the migration to production.** Per `CLAUDE.md`, migrations are applied manually — `npx supabase@latest db push` against the production project, or the Management API. Verify afterwards:
   ```sql
   select count(*) from public.form_templates;                    -- 0
   select id, public from storage.buckets where id = 'form-templates'; -- public = false
   ```
2. **Deploy the API.** `git push` does **not** deploy. SSH to the VPS, `git pull`, `pnpm --filter api build`, restart under pm2. No env changes are needed — this feature adds no environment variables.
3. **Deploy the web app.** Same host: `git pull`, `pnpm --filter web build`, restart. No `NEXT_PUBLIC_*` changes.
4. **Confirm the schedule registered.**
   ```bash
   pm2 logs visaai-api --lines 50 --nostream | grep -i 'form refresh'
   ```
   The first run is at 02:00 UTC. Until then every form correctly shows the official link.
5. **Confirm the first run.** After 02:00 UTC:
   ```sql
   select form_code, status, capability, version_label, byte_size
   from public.form_templates order by form_code;
   ```
   Expected for the current IRCC data: `IMM 5257` and `IMM 5645`, both `status = 'ok'`, both `capability = 'xfa'`, version labels `01-09-2023` and `01-01-2021`.

## Verification checklist

- [ ] `pnpm --filter api test` passes
- [ ] `pnpm --filter api build` exits 0
- [ ] `pnpm --filter web lint && pnpm --filter web build` exit 0
- [ ] No test performs a network call — `grep -rn "https://www\.canada\.ca" apps/api/src apps/api/test` returns only fixture paths, comments, and the `LANDING_URLS` catalogue
- [ ] `grep -rn "IRCC_IMM5257_TEMPLATE_URL" .` returns nothing
- [ ] `form_templates` holds no applicant data — every column is about the form, not the user

## Open questions carried from the spec

Neither blocks this plan; both are follow-up work.

- **Other countries' portals.** Only canada.ca has been verified to serve the PDF link in plain HTML. `usa.strategy.ts`, `uk.strategy.ts`, `australia.strategy.ts`, and the Schengen strategies declare **no** `FormSpec` entries today, so `allCatalogedForms()` returns Canada's forms only. Adding a country means adding `FormSpec` entries with `sourceUrl` and, if that portal needs JavaScript, the first real implementation of the `PortalDiscoveryStrategy` Playwright escape hatch.
- **The XFA data sheet.** The spec proposes attaching a VisaAI data sheet alongside a blank XFA form so the applicant can copy values across. This plan ships the blank form and marks it `prefillable: false`; whether the data sheet is a new artifact or the existing summary PDF re-purposed is unresolved, and building it before an applicant has used the blank-form flow would be guessing at the format.
