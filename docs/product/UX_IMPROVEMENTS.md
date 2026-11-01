# UX improvements

Framed by the spec's question: *what work is the user doing that VisaAI can
safely and reliably do for them?*

## Shipped

### They can find the official page without signing up

`/visas/{country}` lists every visa category an authority publishes, in the
government's own wording and codes, each linked to the page it came from. That
is a task a person currently does by searching, landing on an aggregator, and
hoping it is current.

Every page carries a visible last-verified date, so the reader can judge the age
of the claim rather than assume it.

### They are told when VisaAI does not know

A visa with no reviewed requirements says so explicitly and links to the
authority, rather than rendering a plausible list. The alternative — a
confident-looking checklist assembled from a model's recall — is worse than
nothing on a document a person will file with a government.

### A question can explain itself

`explainRule()` renders a conditional requirement as plain English from the same
data that decided to ask, so "why am I being asked for this?" has a real answer
rather than a generic help string.

### Fewer questions become possible

`factsUsed()` returns exactly the facts a requirement set depends on. That is the
input to asking only what some rule actually needs — the difference between a
40-question intake and a 12-question one. The plumbing exists; the intake flow
does not use it yet.

### A gated action quotes the real price

The upgrade toast said $100 for a plan that charges $250. Whatever else that is,
it is a bad experience at the exact moment someone decides to pay.

### The product no longer overclaims

"Every application is checked and approved by a licensed immigration consultant"
was false three ways. A user who paid for the Self-Service plan expecting
consultant review would have discovered the gap after paying.

## Designed, not yet built

Each is blocked on the same thing — sourced requirements — and each is
deliberately not faked in the meantime.

**A checklist that distinguishes "not required" from "we do not know yet."**
The three-valued rules engine makes this possible: an `unknown` verdict renders
as "may be required — answer X to confirm". Today's checklist collapses both
into absent, which is how someone is told they are ready when they are not.

**Requirement-change alerts on an active application.** The sync detects and
classifies material government changes; nothing yet notifies the applicants
whose in-progress application depends on the rule that changed. This is the
highest-value user-facing feature the sync unlocks.

**Reusable profile data across applications**, with consent.

**Duplicate-upload detection** by file hash — the hash is already computed.

**Expiry tracking** for passports and police certificates, from extracted dates.

## Not automated on purpose

- **Submission.** VisaAI prepares; the applicant submits. The extension fills
  the applicant's own portal tab on their own machine.
- **Anything requiring informed review.** A generated draft is a draft. The user
  reads it before it goes anywhere.
- **Any decision framed as an outcome.** The product cannot approve, predict or
  guarantee, and now says so on every public visa page.
