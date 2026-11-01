# Source access outreach

**Status 2026-08-21: `/bots` published. Letters drafted for post — email is not
possible, because neither authority publishes an email address.**

---

## Done: https://visaai.co/bots

The monitor's User-Agent has always advertised `+https://visaai.co/bots`, and
that URL 404'd. An administrator who saw the traffic and followed the one link
the agent offered them got nothing — which is a fair reason to treat it as
another anonymous scraper, and plausibly part of why two WAFs do.

The page now states the exact User-Agent, the real limits (one request per host
per 2s, 8 MB, 30s, 5 redirects, GET only), a copy-pasteable robots.txt block,
and an offer to stop on request without asking why. It says plainly that a 403
stops the agent and that it does not change its User-Agent to get a different
answer.

This is the part that actually makes VisaAI allowlistable, and it needed nobody's
permission.

---

## Email: not possible. Verified, not assumed.

**Neither department publishes an email address.**

**Australia** — `directory.gov.au` is the authoritative Australian Government
directory. The full Department of Home Affairs entry lists every contact channel
the department operates: Border Watch, Citizenship Information Line,
Compliments/Complaints/Suggestions (133 177), Employers' Immigration Hotline,
Immigration General Enquiries (131 881), Media Enquiries (02 6264 2244),
National Relay Service, TIS National. **All phone numbers.** Plus a postal
address. No email, anywhere in the listing.

> **Correction, 2026-08-21.** The claim "no Home Affairs email exists" was too
> strong and is now known to be false. `data.gov.au` publishes 314 Home Affairs
> datasets, each carrying a contact point:
> `statistical.coordination@homeaffairs.gov.au`.
>
> It is a real, current, departmental address — and it is **not being written
> to**, for the same reason the complaints form was not used. That inbox belongs
> to the team that coordinates statistical publication. A request to allowlist a
> crawler is not their work, and routing it there because it is the one address
> we could find is precisely the "any channel will do" behaviour that makes
> unsolicited automated outreach a nuisance.
>
> Recorded because it is a real lead if a human decides the trade is worth it,
> and because the earlier absolute statement should not stand uncorrected.

**United States** — the Bureau of Consular Affairs "Contact Us" page publishes a
postal address and nothing else:

> Bureau of Consular Affairs, U.S. Department of State, 600 19th Street, NW,
> Washington, DC 20036

**Canada** — not blocked. 200 on all 28 sources. Nothing to ask for.

So "email each authority" has no destination. This is not a judgement call about
whether to send; there is no address to send to.

## Australia: requirements are definitively not obtainable

Closed out 2026-08-21 after probing every plausible official host.

| Host | Result |
|---|---|
| `immi.homeaffairs.gov.au` | 403 |
| `www.homeaffairs.gov.au` | 403 |
| `www.abf.gov.au` | 403 |
| `covid19.homeaffairs.gov.au` | 403 |
| `www.dfat.gov.au`, `www.smartraveller.gov.au`, `www.servicesaustralia.gov.au` | no response |
| `www.studyaustralia.gov.au` | 200 — Austrade, not the visa decision-maker |
| `www.legislation.gov.au` | 200 — the actual Migration Regulations |
| `data.gov.au` | 200 — 314 Home Affairs datasets, all **statistical** |

The open-data catalogue was the last untried angle and it settles the question:
what Home Affairs publishes as data is grant counts and processing statistics,
not eligibility criteria. Visa requirements are not open data anywhere, from any
government.

So the position stands, on evidence rather than assumption: **Australian
requirements cannot be obtained without either being allowlisted by Home
Affairs, or counsel scoping an extraction from the Migration Regulations.**
Reasoning for not using the two readable-but-wrong sources is in
`docs/visa-data/SOURCE_RESEARCH_PRIORITY.md`.

One genuine opportunity did surface and is deliberately **not** being taken
here: processing times ARE published as open data, are factual rather than
interpretive, and the registry already has a `processing_times` source role.
That is a feature, not a source-access fix, so it is recorded as an opportunity
rather than smuggled into this work.

## Web forms: attempted, and why neither worked

**State Department, "Report Website Issues"** — the closest thing to an
appropriate channel anywhere, and genuinely technical in scope. The page loads
behind a Cloudflare interstitial (which cleared passively; nothing was solved or
bypassed), but the form's "next" arrow does not respond to automation and is not
exposed in the accessibility tree. Attempted twice, then stopped. If that button
is itself bot protection refusing quietly, continuing to click it is precisely
the behaviour this whole document exists to avoid.

**A human can almost certainly complete it in a normal browser session**, and
that is the recommended route — see the text below.

**Home Affairs, "Compliments, complaints and suggestions"** — not attempted. It
states its own purpose as *"feedback from clients about their interaction with
the Department"* and carries an explicit out-of-scope section. Submitting a
commercial third party's crawler request there is a misuse of a queue staffed to
help applicants with case problems.

---

## What to send, and how

Post is the channel both departments actually publish. Both letters are one
page, print as-is on letterhead, and need only a name and title.

**These have to be posted by a person.** There is no mechanism available here
for putting paper in an envelope, and no authorisation to spend money with a
mail service. The text below is final and print-ready.

### Letter — Australia

> Department of Home Affairs
> PO Box 25
> Belconnen ACT 2616
> Australia
>
> **Re: Request to allowlist an identified automated agent — VisaAI-SourceMonitor**
>
> To whom it may concern,
>
> I am writing from VisaAI (https://visaai.co), a service that helps people
> prepare visa applications. We would like to ask whether the Department can
> allow a single, identified automated agent to read a small set of public visa
> pages on immi.homeaffairs.gov.au.
>
> **What it does.** Once per day it fetches roughly 28 public visa pages and
> compares each against the previous day's copy. When the Department changes a
> requirement, a fee or a form, our system flags the change for a person to
> review before anything we show a user is updated. The purpose is accuracy — so
> that what we show people matches what the Department currently publishes, and
> so we can show them the date we last confirmed it.
>
> **How it behaves.** It identifies itself as
> `VisaAI-SourceMonitor/1.0 (+https://visaai.co/bots; visa requirement change monitoring)`.
> It reads and follows robots.txt before every request. It waits at least two
> seconds between requests to your servers. It stops on a 403 or 429 and does
> not retry. It sends no credentials and never approaches an authenticated,
> account-holder or lodgement area. It reads only — it submits nothing and
> lodges nothing. It does not attempt to pass bot checks.
>
> **What we are asking.** Requests carrying that User-Agent currently receive
> HTTP 403. We understand this to be a general protection against automated
> traffic rather than anything directed at us — the same rule appears to block
> other identified crawlers. We have deliberately not worked around it. We have
> not altered or removed our User-Agent, because we would rather be
> identifiable and blocked than anonymous and permitted.
>
> Full technical detail, including how to block us, is published at
> https://visaai.co/bots. We can supply source IP addresses on request.
>
> If there is a process for this, or a team better suited to the question, we
> would be grateful to be directed to it. We are equally prepared to be told no
> — in that case we will continue to link people to your pages rather than read
> them automatically, which is what we do today.
>
> Yours faithfully,
> [Name], [Title]
> VisaAI · team@visaai.co

### Letter — United States

> Bureau of Consular Affairs
> U.S. Department of State
> 600 19th Street, NW
> Washington, DC 20036
>
> **Re: Request to allowlist an identified automated agent — VisaAI-SourceMonitor**
>
> [Body identical, with `travel.state.gov` in place of
> `immi.homeaffairs.gov.au`, and this substitution in the fourth paragraph:]
>
> **What we are asking.** Requests to travel.state.gov currently receive HTTP
> 403 regardless of the User-Agent sent, which suggests the protection does not
> key on it. We have not attempted to determine what it does key on, or to work
> around it.

### State Department web form — SUBMITTED 2026-08-21

`travel.state.gov/content/travel/en/contact-us/report-website-issues.html`

Opened 2026-08-21. The "next" arrow does work; it needs a click after the page
settles, and the form it reveals is a cross-origin iframe whose fields are not
exposed to automation by name — coordinates only.

**Submitted by the account holder on 2026-08-21.** Contact given:
`team@visaai.co`. No reference number is issued by this form, so there is
nothing to track — a reply, if one comes, arrives at that address.

Composition: the description carried the full request; the expected/actual
fields carried HTTP 200 vs HTTP 403; the "searched terms" field states plainly
that site search was not used and that the category chosen was the closest
available, rather than inventing a search that never happened.

**Filled by hand, and why:**

| Field | Why not filled |
|---|---|
| "My issue relates to…" | native select, options not readable from the page; guessing a category on a government form mis-routes the report |
| "My website issue is…" | same |
| First name, Last name, Phone | a real person's details. Not mine to invent, and not inferable from a directory path |
| "My website issue is…" | the category remains *search feature*, which is the nearest of the options offered. Recorded here because it will route the ticket to whoever owns search relevance rather than site access |
| **reCAPTCHA** | **Completing a CAPTCHA is something I will not do**, whatever the authorisation. It is a bot check, and the entire case in these letters rests on VisaAI not defeating bot checks. Filling this one in would contradict the paragraph directly above it in the same form |
| Submit | done by the account holder |

If the tab has since closed, the description text to paste is the letter body
below, which says the same thing.

---

## Still outstanding before any of this is sent

`docs/legal/LEGAL_REVIEW_REQUIRED.md` **L-03, Critical before launch**: whether
VisaAI's model constitutes regulated immigration assistance in Canada, the UK and
Australia is one of the twelve questions with counsel. These letters introduce
VisaAI to two of those regulators' own departments. The engineering position is
that the letters are ready; the sequencing call is counsel's.

Neither letter claims VisaAI is licensed, regulated, affiliated with any
government, or endorsed by one.
