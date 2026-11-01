# Features implemented

## Public visa reference pages

`/visas`, `/visas/{country}`, `/visas/{country}/{visa}` — the first public
content VisaAI has ever published about visas. Before this the public surface
was six pages and `/` redirected logged-out visitors into the funnel.

Each page shows the authority's own name for a visa, its official subclass code,
and a link to the government page every claim came from, with a visible
last-verified date. Value to a user who never signs up: they can find the
official page for their visa without wading through aggregators.

**What they refuse to do:** claim a requirement that has not been read from a
specific source version and reviewed. A visa with no reviewed requirements shows
"Requirements not yet published" and links to the authority, rather than listing
something plausible.

## Typed requirement rules

`visa-rules/` — conditional requirements as data instead of frontend
conditionals or a single equality check buried in a JSON blob. Supports the rule
shapes the spec requires: by nationality, residence, age, sponsor, dependants,
duration, subclass.

Directly user-facing: `explainRule()` renders a rule as plain English, so "why
am I being asked for this?" has an answer generated from the same data that
decided to ask. `factsUsed()` lists what a rule depends on, which is the input to
asking fewer questions.

Three-valued evaluation means a requirement gated on an unanswered question
shows as "may be required" rather than vanishing — the difference between an
honest checklist and one that tells someone they are ready when they are not.

## Official source monitoring

Detects, versions and classifies changes to government pages, and routes
anything material to human review before it reaches an applicant. The
user-visible payoff is the last-verified date and, once extraction lands,
requirement-change alerts on active applications.

## AI task registry and routing

Not user-facing, but it is what makes per-task cost control and quality
thresholds possible at all. See `docs/ai/`.

## Corrections to existing behaviour

These are fixes, but each changes what a user experiences:

- **Localized pages can be indexed again.** All 15 locale variants canonicalised
  to the English URL, telling search engines to drop them.
- **`/pricing` no longer serves a blank pricing table** when the API blips.
- **The price quoted matches the price charged.** The UI said Expert Review was
  $100; billing charged $250.
- **The consultant claim is now true.** "Every application is checked and
  approved by a licensed immigration consultant" was false three ways.

## Deliberately not built

**Visa comparison, expiry tracking, family profile reuse, interview
preparation** — all listed in the spec as strong candidates, all blocked on the
same thing: sourced requirement data. Building a comparison UI over an empty
requirements table would produce a feature that compares nothing.

The ordering is intentional. Requirements first, features on top of them.
