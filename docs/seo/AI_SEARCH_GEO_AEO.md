# AI search, GEO and AEO

**No claim is made here that any AI system will cite VisaAI.** No engineer,
technique or agency can guarantee that, and the spec forbids saying otherwise.
What follows is the access and content work that makes citation *possible*, plus
how it would be measured.

## Crawler access

`apps/web/app/robots.ts`. Verified against OpenAI's official bot documentation
(`developers.openai.com/api/docs/bots`, read 2026-08-20).

| Agent | Purpose (per OpenAI) | VisaAI policy |
|---|---|---|
| `OAI-SearchBot` | surfaces pages in ChatGPT search; **not used for training** | full public surface |
| `ChatGPT-User` | user-initiated fetches from ChatGPT | full public surface |
| `PerplexityBot` | Perplexity answers | full public surface |
| `ClaudeBot` | Claude fetches | full public surface |
| `GPTBot` | **training** foundation models | `/visas` only |

The split is the point: OpenAI documents `OAI-SearchBot` as search-only and
disallowing `GPTBot` as the way to say "do not train on this". VisaAI wants to
be findable and citable; whether its content trains a model is a separate
decision, and the two are separable.

**Both groups repeat the private-surface disallows.** A user-agent-specific
group *replaces* the wildcard group rather than adding to it, so omitting them
would have handed these crawlers exactly the signed-in surface that `*` is
denied. This is the most common robots.txt mistake and it fails open.

**Match on the token, not the version.** The current strings are
`OAI-SearchBot/1.4` and `GPTBot/1.4`. Any WAF or nginx rule pinned to `/1.0`
stopped matching when OpenAI bumped the version — check the production edge
config for literal version strings.

Official IP ranges, if allowlisting is ever needed:
`openai.com/searchbot.json`, `gptbot.json`, `chatgpt-user.json`, `adsbot.json`.

**Verified:** `OAI-SearchBot`, `GPTBot`, `Googlebot` and `bingbot` each receive
HTTP 200 with full page content on `/visas/canada`, tested by setting the UA
header against a production build.

## Citation-friendly content

The visa pages are built the way an answer engine can use:

- **A direct-answer block first.** "X publishes N visa categories that VisaAI
  tracks" / "Y is issued by Z" — a liftable sentence, not a marketing lede.
- **The authority's exact wording** for every visa name and code. An answer
  engine quoting "Visitor visa (subclass 600)" is quoting the government,
  because so is VisaAI.
- **A citation next to the claim.** Every source is a crawlable `<a href>` to
  the government's canonical URL, deliberately **without `rel="nofollow"`** —
  these are genuine citations to authoritative pages and should be followed.
- **A visible, machine-readable last-verified date** (`<time datetime>`), so the
  age of a claim is checkable rather than implied.
- **Semantic HTML and real headings**, server-rendered. Nothing important is
  behind a client interaction.
- **An explicit disclaimer on every page**: VisaAI is not a government body,
  does not issue visas, and cannot decide or guarantee an outcome.
- **Stable canonical URLs** that do not change when a country's display name
  does — the slug is stored, not derived.

## What is deliberately absent

- **No `llms.txt`.** It remains a non-standard convention; adding one would be a
  low-risk supplement at best and this program had higher-value work. If added
  later it must be auto-generated from the registry, expose nothing private, and
  be documented as neither a standard nor a ranking factor.
- **No content written for machines.** The pages are what a person needs. That
  is also, not coincidentally, what is worth citing.

## Measurement

Not yet implemented. What it requires:

1. **Referral detection** — segment sessions by referrer host
   (`chatgpt.com`, `perplexity.ai`, `claude.ai`, `gemini.google.com`) and by any
   utm parameters those products attach. The analytics event spine exists
   (`analytics_event_stream`); the segmentation does not.
2. **Landing-page and conversion breakdown** for those sessions.
3. **Branded-search lift** — needs Search Console, which needs ownership
   verification. Blocked, with steps in `SEO_MEASUREMENT.md`.
4. **Crawler-response monitoring** — log status and byte size per AI user-agent
   at the edge, so a WAF change that starts 403ing `OAI-SearchBot` is visible
   rather than discovered months later as a traffic gap.

**"AI recommendation rank" is not measured and will not be reported**, because
no reproducible methodology for it exists. Manual spot-checks of whether an
assistant mentions VisaAI are anecdotes, not measurements, and would be labelled
as such if ever recorded.

## The honest current state

VisaAI publishes 4 country hub pages of genuinely sourced content. That is a
foundation, not a corpus. The thing most likely to earn a citation — per-visa
requirement pages with official provenance — is gated on requirement extraction,
which has not run. Access is now correct; the content depth is not there yet.
