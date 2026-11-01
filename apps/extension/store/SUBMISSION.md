# Chrome Web Store submission — VisaAI Portal Assistant

Everything the dashboard asks for, written from the manifest and the source
rather than from memory. Where a field's wording matters to review, the reason
is given.

**Package to upload:** `apps/extension/release/visaai-portal-assistant-<version>-store.zip`,
produced by `pnpm --filter extension pack` (`pack.mjs`). The zip is
reproducible — sorted entries, fixed timestamps, STORED, no source maps — and
its SHA-256 is written to `release/SHA256SUMS`; the same source gives the same
hash on Node 20 and 24. `pnpm --filter extension pack:publish` additionally
copies the self-hosted zip to `apps/web/public/extension/`, and
`test/release-pack.spec.ts` fails if that served file is not a fresh pack of the
current source. Producing the zip is not a submission: nothing here uploads to
the Web Store.

There are TWO packages, and uploading the wrong one is rejected at the door:

| Build | Output | `key` | Used for |
|---|---|---|---|
| `node build.mjs` | `dist/` | stripped | **This upload.** The Store issues the id and refuses a package that brings its own. |
| `node build.mjs --selfhost` | `dist-selfhost/` | kept | The zip served from `visaai.co/extension` while there is no listing. |

The self-hosted zip must keep `key`: without it Chrome derives an unpacked
extension's id from the installing user's filesystem path, so every user gets a
different id and none match `NEXT_PUBLIC_EXTENSION_ID` — the web app's handoff
then fails for everyone. `key` is the base64 DER *public* key; it pins the id and
discloses nothing.

Never zip the repo's `manifest.json` directly — it carries a localhost origin
(SEC-8510) that exists only for development. Both builds strip it, and
`test/package-shippable.spec.ts` asserts that property of BOTH outputs.

## Store listing

Every line below was written from the source at 0.1.5 and is meant to be
pasted verbatim. Anything that is an owner or legal statement rather than a
fact about the code is marked **[owner]**.

**Item name**
VisaAI Portal Assistant

**Summary (132 char max)**
Enters answers you approved in VisaAI on Canada's IRCC portal only if every field is found, and verifies each. You submit and pay.

This is the manifest `description` — the Store shows it as the summary and it
can only change with a new package. `test/store-listing.spec.ts` pins the two
together. 0.1.3 said "Assists with filling government visa portal forms. You
always complete payment and submission.", which claimed filling without
qualification. Why the qualification matters:

- only the IRCC portal has a fill mapping (`portal-fills/canada-ircc.ts` is the
  only `registerPortalFill` call in the repo);
- the server writes nothing unless a read-only probe finds **every** mapped
  selector on the open page (`automation.gateway.ts`, `selectors_missing_on_portal`
  → "Nothing was filled — fill it manually.");
- the IRCC selectors (`#given-name`, `#passport-number`, …) have not been checked
  against the live, sign-in-walled IRCC form. Where they do not match, the probe
  fails and nothing is written. That is the "safe-inert" state: the write path is
  real and server-gated, but on a page that does not match it does nothing.

Do not describe it as filling the IRCC form until the mapping has been verified
on the live portal.

**Detailed description**

```
VisaAI Portal Assistant is the browser companion to VisaAI (https://visaai.co). It works only on Canada's IRCC online portal (canada.ca and cic.gc.ca pages).

How it works
• On the VisaAI submission page you review and approve the answers for your application. VisaAI then hands the extension a single-use approval, and the toolbar icon shows "GO".
• Open the IRCC portal page in your current tab and click the toolbar icon to open the side panel.
• Each launch fills the IRCC page that is open. Before anything is entered, VisaAI checks that every expected field of that page is present. If any is missing, nothing is entered and the side panel tells you to fill the page yourself.
• If every field is found, the approved answers are entered one at a time: text and dates are typed, answers are selected (radio buttons and check boxes), and table rows such as your children are added with the form's own Add and Save buttons. Each entry is read back and checked against what you approved, and the run stops at the first one that does not match.
• Questions about criminality, security, medical history and immigration history are answered only from the answers you gave VisaAI; any you did not answer are left blank for you.
• When the page is filled, the side panel names the next IRCC page it has answers for. You press "Save and continue" on IRCC yourself.

What it never does
• It never presses "Save and continue", Back, or any button that signs, pays, submits or leaves the page, and it never uploads files. Submission, signature and payment are always yours.
• It never enters an answer you did not approve in VisaAI, and it ignores a fill it did not request.
• It connects only to VisaAI's servers (or to a development server on your own computer).

Current limitations
• Only Canada's IRCC portal is supported.
• Some IRCC pages and questions are not filled (for example representative details, travel and work history entries, and any question VisaAI holds no answer for); the VisaAI submission page lists them for you. Where a page does not match, the extension enters nothing and you complete it yourself.
• You need a VisaAI account with an application at the submission stage.

VisaAI is not affiliated with or endorsed by the Government of Canada or IRCC. It does not give legal advice and does not guarantee any outcome.
```

**[owner]** The last paragraph states the company's relationship to the
Government of Canada and its advice/guarantee policy (the approval-neutral rule
in `CLAUDE.md`). It is true of the code — nothing in the repo claims otherwise —
but it is a company statement; confirm it before publishing.

**Category**
Workflow & Planning (under Productivity). The dashboard lists "Productivity" as
a group header that cannot be selected (`aria-disabled="true"`, 2026-09-27); its
children are Communication, Developer Tools, Education, Tools, Workflow &
Planning. **[owner]** may prefer Tools.

**Language**
English

**Homepage URL**
https://visaai.co (HTTP 307 → `/applications/new`, verified 2026-09-27)

**Support URL**
None. `visaai.co/support`, `/help` and `/contact` all redirect to `/login`; the
privacy page's contact line is "the in-app support channel". `support@visaai.co`
appears in the repo only as a *sender* address (`forms/http.ts`), which is not
evidence that anyone reads it. **[owner]** Supply a public support URL or
monitored address; leave the field empty until then.

**Privacy policy URL**
https://visaai.co/privacy — see "Privacy policy" below: the extension paragraph
has been rewritten in the repo to match the code (0.1.5), but it is not deployed,
and the page is still headed "Template pending legal review".

**Screenshots** (1280×800, RGB, no alpha)
`store/screenshots/01-side-panel.png`, `store/screenshots/02-no-approval-no-write.png`.
Generated by `node store/screenshots.mjs`: Playwright loads the built `dist/`
package unpacked into Chromium and captures the real `sidepanel.html` in four
states reached through its own code paths (see the header of that script for
the one local server fixture it uses). No mock-ups.

**Store icon**
`icons/icon128.png` (128×128, the package's own icon).

**Distribution**
Payments: **Free of charge** — the extension has no purchase or licensing code.
Visibility (Public / Unlisted / Private) and regions: **[owner]**.

## Single purpose

> Let a VisaAI user enter the answers they approved in VisaAI into Canada's IRCC visa portal — only when every expected field is present on the page — and verify each one, leaving signature, payment and submission to the user.

One purpose: carrying approved VisaAI answers into one government form and
checking them. It does not open with an unqualified "Fill" — the guidance above
applies here too.

## Permission justifications

| Permission | Justification |
|---|---|
| `activeTab` | Clicking the toolbar icon opens the side panel; `activeTab` limits the extension to the tab the user was on when they clicked. A fill targets only the active tab of the current window, and only if it is an `https` canada.ca / cic.gc.ca page (`resolvePortalTab` in `sidepanel.ts`); other tabs and windows are never searched. |
| `storage` | Holds the one pending hand-off from the VisaAI web app (`pendingSession`: session token, API URL, portal URL, and the signed one-time fill approval) in `chrome.storage.local` until the user opens the side panel. It is removed when the panel reads it, and in any case after 5 minutes (`PENDING_SESSION_TTL_MS`). |
| `alarms` | Schedules the 5-minute purge of that hand-off. A `setTimeout` does not survive the MV3 service worker being stopped, so without an alarm an unopened hand-off — which carries the applicant's approved values inside the signed approval — could sit in storage indefinitely (`background.ts`, `PENDING_PURGE_ALARM`). |
| `sidePanel` | The fill runs from a side panel next to the portal page. It shows the connection state, each field as it is written and verified, and why a run stopped — the user watches the form and the panel together. |
| `https://*.cic.gc.ca/*`, `https://*.canada.ca/*` | IRCC's portal is the only one with a fill mapping. The content script is loaded on those pages and does nothing until the background worker relays a field instruction for the tab bound to an approved run. Host access is limited to those two origins; it is never `<all_urls>`. |

Engineering note (not for the form): nothing in the source needs `activeTab` —
`chrome.tabs.query` / `tabs.sendMessage` on canada.ca already work through the
host permissions. Dropping it would narrow the request; it is left in 0.1.5
because changing permissions was out of scope for a copy fix.

**Remote code:** No. Everything is bundled by esbuild into the package; there is
no `eval`, no `new Function`, no `importScripts`, no remotely-hosted script, no CDN.

## Data-use disclosures

These are the facts; ticking the boxes and the three certifications is an
**[owner]** attestation.

- **Personally identifiable information — YES.** The signed approval the web app
  hands off, and each write instruction from the server, carry the applicant's
  own details (name, date of birth, passport number, nationality, and similar)
  from their VisaAI application.
- **Authentication information — YES.** A single-use session token (then a
  resume token) authenticates the side panel's socket to the VisaAI API.
- **Web history — NO.** The extension does not read history, and does not
  observe tabs other than the one a run is bound to.
- **Website content — owner's call, facts below.** Raw page content is never
  sent. What goes back to the VisaAI API over the side panel's socket is: the
  fill approval (`portal-fill:start`), whether each mapped selector exists
  (`portal-fill:probe` — booleans only), and per field an outcome, a failure
  reason and a SHA-256 of the value read back from the field the extension just
  wrote (`PortalFillFieldResult` in `src/shared.ts`). A hash of a value the user
  approved is arguably not "website content"; answering YES is the conservative
  choice.

Certifications (all three true of the code; **[owner]** to affirm): data is not
sold to third parties, is not used or transferred for purposes unrelated to the
single purpose, and is not used to determine creditworthiness or for lending.

## Test instructions for the reviewer

**BLOCKED — no reviewer account exists.** Exercising the extension needs a
VisaAI account on `visaai.co` with an application at the submission stage and an
approved preflight review, then an IRCC portal page. There are no reviewer
credentials in the repo, and none were created (inventing an account on the
production service is an owner decision). **[owner]** Create a dedicated
reviewer account, then enter its username/password in the dashboard's
Credentials fields. "Additional instructions" (500-char limit) was saved in the
dashboard on 2026-09-27 with the text below, which names no account or
application. Button label `launchAssistant` = "Launch assistant"
(`apps/web/messages/en.json`), badge `GO` (`background.ts`), mismatch message
from `automation.gateway.ts` (`automation:error`):

```
Sign in at https://visaai.co with the test account above. Open an application at the Submission stage, approve the answers and press "Launch assistant"; the toolbar icon shows GO. Open an IRCC portal page in the same window and click the icon. If the page lacks any expected field the panel reports "Nothing was filled — fill it manually" (expected on most IRCC pages today). It never presses Save and continue, signs, pays or submits.
```

## What a reviewer will find in the package

1. The toolbar icon opens `sidepanel.html`; with no hand-off it shows the manual
   connect form, which refuses any server that is not VisaAI (`isTrustedApiUrl`).
2. Nothing is written until the user has approved the fill on the VisaAI
   submission page, where the backend decides it from scratch
   (`POST /execution/request`); the side panel only starts a run for that
   signed, single-use approval (`portal-fill:start`), and ignores a fill the
   server opens on its own (`startRequested` in `sidepanel.ts`).
3. Before the first write, the server probes the bound tab for every mapped
   selector and writes nothing if any is missing.
4. Payment, signature and submission are never automated; `content.ts` has no
   navigate, upload or submit path, and the only clicks (`executor/control-actuator.ts`)
   are radio answers, check boxes and a table's own Add / dialog Save buttons — never
   `#next_path` ("Save and continue") or any page-leaving control (`safety-guards.ts`).

## Privacy policy

`apps/web/app/[locale]/privacy/page.tsx`'s extension section was rewritten
2026-09-27 to match 0.1.4 (still accurate for 0.1.5) (what is stored, for how long, and exactly what is
sent). It is marked on the page as pending owner/legal review and is NOT
deployed — the live page still carries the older paragraph, which says the only
thing sent is "a request to authorize the fill" (not accurate: the probe
booleans and per-field result hashes are sent too). **[owner]** Have counsel
review, then deploy, before submitting for review.

## After it is published

Set `NEXT_PUBLIC_CHROME_WEB_STORE_URL` in `apps/web/.env` on the VPS to the
listing URL and rebuild web. The submission page already switches from the zip
download to the Store link when that variable is present
(`submission-client.tsx`: `storePublished`).

## Why this is Canada-only, and what widening costs

`host_permissions` covers `cic.gc.ca` and `canada.ca`. The manifest is not the
reason — the fill mappings are.

A portal is supported when a `registerPortalFill(portalId, mapping)` exists for
it: a list of `{profileKey, selector, action, label}`, where `selector` is a CSS
selector for a field on the real form. `canada-ircc.ts` is the only one in the
repo, so `AutomationService.buildFillInstructions` returns `[]` for the other 47
destinations. Adding host permissions without a mapping grants access that does
nothing — the exact shape reviewers reject.

Selectors cannot be written from a description of a form; they have to come from
the form. Probed from the VPS, following redirects, with a browser user agent:

| Portal | HTTP | `<input>` in HTML |
|---|---|---|
| evisa.gov.tr (Türkiye) | 200, 1,191 bytes | 0 |
| visa2egypt.gov.eg | 200 | 2 (not the application form) |
| icp.gov.ae | 301 | 0 |
| eservices.ica.gov.sg | 200 | 0 |
| malaysiavisa.imi.gov.my | 200 | 0 |

Every one is a client-rendered shell or auth-walled. The application forms are
not in the served HTML, so no selector is derivable by fetching them — including
for the e-Visa portals whose forms are public to a human with a browser.

What each destination therefore costs:

1. Reach the real form in a browser — for most portals that means an account in
   that country's system, because the form is behind a login.
2. Capture the field selectors from the rendered DOM.
3. Write `portal-fills/<country>.ts`, set `assistedFill: true` on that country's
   strategy, and add its origin to `host_permissions`.
4. Re-verify when the portal changes: a selector is a dependency on someone
   else's markup, and `readback` exists precisely because that markup moves.

Step 1 is the real cost and it is per country. Nothing in steps 2–4 can be
honestly guessed from step 1 being skipped.
