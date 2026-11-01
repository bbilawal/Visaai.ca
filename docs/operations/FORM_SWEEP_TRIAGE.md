# Form sweep triage — 19 confirmed in scope, 238 still open

GENERATED 2026-08-21 from `template_sweep_findings`; the evidence pass below was
added 2026-08-23. Regenerate rather than hand-edit.

## Where this came from

The weekly form sweep discovered **265** official forms (169 IRCC, 96 USCIS).
Every one sat at `status = 'new'` from the day it ran — the queue had never been
touched, which is the exact failure `sweep.service.ts` warns about in its own
comments: *"a queue nobody can clear in one sitting is a queue nobody reads"*.

Migration `20260821260000` marked **8** of them `added`, on the only basis that
needs no judgement: their form code is cited by an ACTIVE visa requirement, so
they already reach applicants through the sourced registry.

## The second basis: does a page we already read name this form?

That first basis is now exhausted — re-running it against the remaining 257
matches nothing. `apps/api/scripts/triage-sweep-findings.ts` adds the next basis
that is still a measurement rather than an opinion: it fetches every readable
registered source and asks which findings are **named on a page VisaAI already
tracks**.

**19 are.** They are now `acknowledged` — the schema's "seen it, still open"
state — each with the citing URL in its note. None became `added`: `added`
should mean the template was ingested, and this script ingests nothing.

### The first run was mostly wrong, in a specific way

It reported 25, and most were site furniture. `uscis.gov` prints a "most
accessed forms" menu on every page, so I-9, I-90, N-400 and I-129F appeared on
all six USCIS pages we track — identically, in the navigation, at the same
offset. A signal that fires from a site menu says nothing about the route.

That is the same shape as the site-wide-republish rule in
`check-source-freshness.ts`, and it gets the same treatment: a match is discarded
when the 160-character window around it appears **verbatim on three or more other
pages of the same host**. Repeated text is furniture. **71 matches** were
discarded this way.

What survives is a sentence written about the page — *"you may need to file form
i-824"* — and IRCC's eTA eligibility page naming the US forms **I-90, I-751 and
I-829** as acceptable proof of permanent residence survives it, correctly. That
one is worth noticing on its own: a Canadian requirement page whose evidence list
is made of American forms.

### The 19

| Authority | Code | Named on |
|---|---|---|
| uscis | `AR-11` | uscis.gov/i-485 |
| uscis | `G-1145` | uscis.gov/i-130, /i-485, /i-765 |
| uscis | `G-1450` | uscis.gov/i-129 |
| uscis | `G-1650` | uscis.gov/i-129 |
| uscis | `G-28` | uscis.gov/i-485 |
| uscis | `I-129F` | uscis.gov/family/family-of-us-citizens |
| uscis | `I-131` | uscis.gov/i-485, /i-765 |
| uscis | `I-140` | uscis.gov/i-485 |
| uscis | `I-192` | cbp.gov visa-waiver-program, cbp.gov esta |
| uscis | `I-360` | uscis.gov/i-130, /i-485 |
| uscis | `I-539` | uscis.gov/i-129, /i-765 |
| uscis | `I-589` | uscis.gov/i-765 |
| uscis | `I-751` | canada.ca eTA eligibility |
| uscis | `I-821D` | uscis.gov/i-765 |
| uscis | `I-824` | uscis.gov/i-130 |
| uscis | `I-829` | canada.ca eTA eligibility |
| uscis | `I-881` | uscis.gov/i-765 |
| uscis | `I-90` | canada.ca eTA eligibility |
| uscis | `I-907` | uscis.gov/i-485, /i-129 |

### Zero IRCC findings were cited — and the first explanation was wrong

166 IRCC forms are in the queue and not one is named on a page we track. The
obvious reading is that this measures our own Canadian source coverage. **That
reading is mostly wrong, and checking it is what showed why.**

`SweepService.knownCodes()` excludes every code the catalogue already covers,
*including* link-only templates — its comment names IMM 5476 specifically. So
the queue is, by construction, the forms VisaAI does **not** already handle. A
form our pages cite is likely already catalogued and therefore never enters the
queue at all.

The check: `imm5257.html` — a registered `forms` source — cites **IMM 5257, IMM
5409 and IMM 5476**. None of the three is in the queue. The pages we track *do*
name IRCC forms; the queue simply holds different ones.

So "zero cited" is largely structural, not a coverage measurement. Four more
canada.ca pages were registered the same day (the Super Visa route) and the
re-run still returned zero, which is consistent with that explanation and not
with the coverage one.

What remains true, and much weaker than first stated: this evidence basis cannot
triage the IRCC half of the queue at all, because the basis and the queue are
disjoint by design. Those 166 need a different basis — most plausibly, whether
the form attaches to a program in `strategyRegistry`, which is a question about
VisaAI's own scope rather than about the authority's pages.

## Why nothing was marked `ignored`

`ignored` is terminal, and absence of a mention is weak evidence for exactly the
reason above: "unmentioned" mostly means "we do not read the page that would
mention it". Marking those terminal would convert a coverage gap of ours into a
decision about a government form.

The 238 that remain are below, grouped by the original keyword heuristic.

## The buckets below are a reading aid, not a decision

Grouped by a keyword heuristic purely so a person can work through them in
sittings. **Nothing here has been auto-dismissed.** The middle bucket is the
one worth reading first: those are forms that plausibly attach to visa types
VisaAI already supports.

Resolve in bulk with `SweepService.resolveFindings(ids, 'ignored' | 'added',
userId, note)` — `ignored` is terminal and the weekly upsert never resets it.

## Clearly outside VisaAI scope (43)

| Authority | Code | Title |
|---|---|---|
| ircc | `IMM 0002` | Document Checklist: Sponsorship Agreement Holders (SAH) |
| ircc | `IMM 0109` | Application to Become a Sponsorship Agreement Holder |
| ircc | `IMM 0114` | Schedule 1: Agri-Food Pilot |
| ircc | `IMM 0115` | Offer of Employment to a Foreign National: Agri-Food Pilot |
| ircc | `IMM 0116` | Document Checklist: Agri-Food Pilot |
| ircc | `IMM 0155` | Document Checklist: Atlantic Immigration Program |
| ircc | `IMM 0156` | Undertaking for an Application for a Work Permit Exempted from a Labour Market Impact Assessment (LMIA) as part of the Atlantic Immigration Program (AIP) |
| ircc | `IMM 0157` | Offer of Employment to a Foreign National: Atlantic Immigration Program |
| ircc | `IMM 0162` | Document Checklist for a Work Permit for Candidates under the Atlantic Immigration Program (Outside Canada applicant) |
| ircc | `IMM 0163` | Document Checklist for a Work Permit for Candidates under the Atlantic Immigration Program (In Canada applicant) |
| ircc | `IMM 0167` | Sponsorship Agreement Holder (SAH) Organizational Assessment |
| ircc | `IMM 0173` | Document Checklist: for Sponsorship Agreement Holder (SAH) Organizational Assessment |
| ircc | `IMM 0193` | Sponsorship Agreement Holder (SAH) Change of Contact Form |
| ircc | `IMM 0199` | Document Checklist: Provincial Nominee Class |
| ircc | `IMM 5282` | Document Checklist: Live-in Caregiver |
| ircc | `IMM 5373` | Sponsorship Undertaking and Settlement Plan – Sponsorship Agreement Holders (SAH) |
| ircc | `IMM 5440` | Settlement Plan – Sponsorship Agreement Holder (SAH) – Risk Management Plan A |
| ircc | `IMM 5501` | Atlantic Immigration Program Declaration Form |
| ircc | `IMM 5546` | Details Of Military Service |
| ircc | `IMM 5634` | Live-in Caregiver: Employer Declaration of Hours Worked |
| ircc | `IMM 5652` | Document Checklist: Atlantic Immigration Pilot Program – Work permit (in Canada applicant) |
| ircc | `IMM 5653` | Document Checklist: Atlantic Immigration Pilot Program – Work permit (applied outside Canada) |
| ircc | `IMM 5908` | Rural and Northern Immigration Pilot Community Interest Form |
| ircc | `IMM 5911` | Schedule 1: Rural and Northern Immigration Pilot |
| ircc | `IMM 5987` | Document Checklist: Rural and Northern Immigration Pilot |
| uscis | `AR-11` | AR-11 / Alien’s Change of Address Card |
| uscis | `EOIR-29` | EOIR-29 / Notice of Appeal to the Board of Immigration Appeals from a Decision of a DHS Officer |
| uscis | `G-1041` | G-1041 / Genealogy Index Search Request |
| uscis | `G-1041A` | G-1041A / Genealogy Records Request |
| uscis | `G-28` | G-28 / Notice of Entry of Appearance as Attorney or Accredited Representative |
| uscis | `G-28I` | G-28I / Notice of Entry of Appearance as Attorney in Matters Outside the Geographical Confines of the United States |
| uscis | `G-325A` | G-325A / Biographic Information (for Deferred Action) |
| uscis | `I-290B` | I-290B / Notice of Appeal or Motion |
| uscis | `I-589` | I-589 / Application for Asylum and for Withholding of Removal |
| uscis | `I-694` | I-694 / Notice of Appeal of Decision Under Sections 210 or 245A of the Immigration and Nationality Act |
| uscis | `I-821D` | I-821D / Consideration of Deferred Action for Childhood Arrivals |
| uscis | `I-865` | I-865 / Sponsor&#039;s Notice of Change of Address |
| uscis | `I-910` | I-910 / Application for Civil Surgeon Designation |
| uscis | `N-336` | N-336 / Request for a Hearing on a Decision in Naturalization Proceedings (Under Section 336 of the INA) |
| uscis | `N-400` | N-400 / Application for Naturalization |
| uscis | `N-426` | N-426 / Request for Certification of Military or Naval Service |
| uscis | `N-470` | N-470 / Application to Preserve Residence for Naturalization Purposes |
| uscis | `N-565` | N-565 / Application for Replacement Naturalization/Citizenship Document |

## Possibly in scope — generic or shared forms (81)

| Authority | Code | Title |
|---|---|---|
| ircc | `IMM 0008` | Generic Application Form for Canada |
| ircc | `IMM 0104` | Details of Education/Employment/Travel |
| ircc | `IMM 0113` | Schedule 1: Subsequent temporary public policy to continue to facilitate access to permanent resident status for out-of-status construction workers in the Greater Toronto Area (GTA) |
| ircc | `IMM 0123` | Document Checklist: Subsequent temporary public policy to continue to facilitate access to permanent resident status for out-of-status construction workers in the Greater Toronto Area (GTA) |
| ircc | `IMM 0129` | Document Checklist: In-Canada families of Canadian victims of recent air disasters |
| ircc | `IMM 0130` | Schedule 3 – Temporary Resident to Permanent Resident Pathway: Streams A & B and International Graduates |
| ircc | `IMM 0133` | Medical Condition Statement |
| ircc | `IMM 0134` | Document Checklist: Permanent residence pathways for Hong Kong residents (Stream A and Stream B) |
| ircc | `IMM 0135` | Schedule 7A – Permanent residence pathways for Hong Kong residents: Stream A – In-Canada graduates |
| ircc | `IMM 0136` | Schedule 7B – Permanent residence pathways for Hong Kong residents: Stream B – Canadian work experience |
| ircc | `IMM 0137` | Document Checklist: Regional Economic Mobility Pathways Pilot |
| ircc | `IMM 0138` | Schedule 20: Economic Mobility Pathways Pilot |
| ircc | `IMM 0147` | Document Checklist: Application for Permanent Residence under the updated temporary Public Policy for Extended Families of Former Afghan Interpreters |
| ircc | `IMM 0148` | Schedule 1: Application for Permanent Residence under the updated temporary Public Policy for Extended Families of Former Afghan Interpreters |
| ircc | `IMM 0151` | Statutory Declaration to Confirm the Relationship to Extended Family Members |
| ircc | `IMM 0170` | Document Checklist: Application Forms for Outside-of-Canada Families of Canadian Victims of Air Disasters |
| ircc | `IMM 0171` | Statutory Declaration for Extended Family Members Outside Canada of a Canadian Victim of an Air Disaster that may apply for a Permanent Residence Visa |
| ircc | `IMM 0185` | Schedule 1: Application for Permanent Residence under the Temporary Public Policy for Extended Families of Former Language and Cultural Advisors |
| ircc | `IMM 0186` | Statutory Declaration to Confirm the Relationship to Extended Family Members and Residency in Canada |
| ircc | `IMM 0187` | Document Checklist: Application for Permanent Residence under the Temporary Public Policy for Extended Families of Former Language and Cultural Advisors |
| ircc | `IMM 0190` | Document Checklist: Temporary public policy to facilitate the granting of permanent residence to certain Ukrainian foreign nationals |
| ircc | `IMM 0191` | Statutory declaration attesting to the relationship between the Canadian citizen or permanent resident and Ukrainian foreign national |
| ircc | `IMM 0194` | Document Checklist: Federal Economic Mobility Pathways Pilot |
| ircc | `IMM 0203` | Document Checklist: Permanent residence pathway for foreign nationals who were in state care |
| ircc | `IMM 0207` | Schedule 1 - Application for permanent residence under the Temporary Public Policy to Facilitate permanent residence to certain foreign nationals affected by the conflict in Sudan with family in Canada |
| ircc | `IMM 0208` | Statutory declaration attesting to the intention of a Canadian citizen or a permanent resident of Canada (anchor) to support a foreign national affected by the conflict in Sudan |
| ircc | `IMM 0210` | Statutory Declaration to Confirm the Relationship to Extended Family Members and Residency in Canada – Immediate or extended family or de facto dependant of a resettled Yazidi or survivor of Daesh |
| ircc | `IMM 0246` | Document Checklist – Rural Community Immigration Pilot |
| ircc | `IMM 0248` | Schedule 1: Rural Community Immigration Pilot |
| ircc | `IMM 0250` | Document Checklist – Francophone Community Immigration Pilot |
| ircc | `IMM 0252` | Schedule 1: Francophone Community Immigration Pilot |
| ircc | `IMM 0270` | Document Checklist - Home Care Worker Immigration Pilots - Workers in Canada stream |
| ircc | `IMM 0271` | Schedule 21 - Home Care Worker Immigration Pilots |
| ircc | `IMM 0272` | Schedule 22: Home Care Worker Immigration Pilots – Public Policy |
| ircc | `IMM 0273` | Document Checklist: Home Care Worker Immigration Pilots - Workers in Canada – Public Policy |
| ircc | `IMM 0503` | Immigration Loans Program – Right of Permanent Residence Fee Loan Agreement |
| ircc | `IMM 0801` | Document checklist for temporary resident documents for eligible indigenous persons |
| ircc | `IMM 1015` | Document Checklist: Application Forms for Health-Care Workers Permanent Residence Pathway (COVID-19 pandemic) |
| ircc | `IMM 1018` | Schedule 1: Health-care Workers Permanent Residence Pathway |
| ircc | `IMM 5280` | Document Checklist: Humanitarian & Compassionate Considerations |
| ircc | `IMM 5286` | Document Checklist: Protected Person – Permanent Residence |
| ircc | `IMM 5287` | Document Checklist: Sponsor |
| ircc | `IMM 5406` | Additional Family Information Form – Permanent Residence |
| ircc | `IMM 5457` | Document Checklist: Atlantic High-Skilled Program |
| ircc | `IMM 5467` | Document Checklist: Atlantic Intermediate-Skilled Program |
| ircc | `IMM 5495` | Document Checklist: Joint Assistance Sponsorship |
| ircc | `IMM 5498` | Document Checklist: Atlantic International Graduate Program |
| ircc | `IMM 5507` | Document Checklist: Rehabilitation |
| ircc | `IMM 5519` | Statutory Declaration of Severance of a Common-Law Union |
| ircc | `IMM 5528` | Document Checklist: Temporary Resident Permit Holders |
| ircc | `IMM 5533` | Document Checklist: Spousal Sponsorship (Including Dependent Children) |
| ircc | `IMM 5534` | Document Checklist: Sponsoring a Dependent Child |
| ircc | `IMM 5555` | Document Checklist: Student (In Canada Applicant) |
| ircc | `IMM 5556` | Document Checklist: Worker (in Canada Applicant) |
| ircc | `IMM 5557` | Document Checklist: Temporary Resident Permit |
| ircc | `IMM 5558` | Document Checklist: Temporary Resident Visa (Visitor Visa) in Canada Applicant |
| ircc | `IMM 5583` | Document Checklist: Students Applying for a Work Permit |
| ircc | `IMM 5589` | Document Checklist: Sponsoring a Common-Law Partner (Including Dependent Children) |
| ircc | `IMM 5629` | Document Checklist: Sponsoring a Conjugal Partner (Including Dependent Children) |
| ircc | `IMM 5644` | Document Checklist: Application for a Permanent Resident Card or Permanent Resident Travel Document |
| ircc | `IMM 5690` | Document Checklist: Quebec Skilled Workers |
| ircc | `IMM 5707` | Family Information Form – Visitors, Students and Workers |
| ircc | `IMM 5721` | Document Checklist: Temporary Resident Visa (Visitor Visa) – Applicants in Canada |
| ircc | `IMM 5722` | Document Checklist: Federal and Quebec Selected Business Class Applicants |
| ircc | `IMM 5745` | Document Checklist: Applying for Refugee Protection within Canada |
| ircc | `IMM 5760` | Document Checklist: Start up Business Class |
| ircc | `IMM 5771` | Document Checklist: Sponsoring Parents and Grandparents |
| ircc | `IMM 5783` | Document Checklist: Voluntary Renunciation of Permanent Resident Status |
| ircc | `IMM 5784` | Document Checklist: Quebec Selected Self-employed and Federal Self-employed Persons |
| ircc | `IMM 5910` | Schedule 19b: Home Child Care Provider or Home Support Worker (Work Experience) |
| ircc | `IMM 5939` | Document Checklist: Applicants in the USA applying for Rehabilitation or Temporary Resident Permits (TRP) |
| ircc | `IMM 5940` | Document Checklist: Applicants in the USA applying for an Authorization to Return to Canada (ARC) |
| ircc | `IMM 5981` | Document Checklist: Home Child Care Provider or Home Support Worker |
| ircc | `IMM 5982` | Schedule 19a: Home Child Care Provider or Home Support Worker (Language and Education) |
| ircc | `IMM 5989` | Schedule 1: Application for Permanent Residence Under the Temporary Public Policy to Facilitate the Issuance of Permanent Residence Visas to Certain Colombian, Haitian, and Venezuelan Nationals with Family in Canada |
| ircc | `IMM 5990` | Statutory Declaration to Confirm the Relationship to Extended Family Members in Canada - Permanent Residence Pathway for Colombian, Haitian and Venezuelan Nationals |
| ircc | `IMM 5992` | Statutory declaration to confirm the intent to provide support to extended family members affected by the crisis in Gaza |
| uscis | `G-1055` | G-1055 / Fee Schedule |
| uscis | `G-1651` | G-1651 / Exemption for Paper Fee Payment |
| uscis | `I-912` | I-912 / Request for Fee Waiver |
| uscis | `N-648` | N-648 / Medical Certification for Disability Exceptions |

## Unclassified — needs a look (133)

| Authority | Code | Title |
|---|---|---|
| ircc | `IMM 0017` | Letter of explanation – Open work permit for vulnerable workers |
| ircc | `IMM 0149` | Details of Government Employment |
| ircc | `IMM 0150` | Details of Police Service |
| ircc | `IMM 0175` | Declaration – Authorization for representative to submit a refugee claim through the IRCC Portal |
| ircc | `IMM 0184` | Economic Mobility Pathways Pilot (EMPP) – Pre-Arrival Facilitations Form |
| ircc | `IMM 0195` | Durable Solution Information |
| ircc | `IMM 0197` | Offer of Employment to a Foreign National - Federal EMPP |
| ircc | `IMM 0211` | Letter of support |
| ircc | `IMM 0215` | Risk Management Plan - SAH Caseload Oversight Report |
| ircc | `IMM 0247` | Offer of Employment to a foreign national – Rural Community Immigration Pilot |
| ircc | `IMM 0251` | Offer of Employment to a foreign national: Francophone Community Immigration Pilot |
| ircc | `IMM 0263` | Post-arrival RAP contribution request |
| ircc | `IMM 0267` | Employment Information Form - Individual Employer - Home Care Worker Immigration Pilots |
| ircc | `IMM 0268` | Employment Information Form - Business Employer - Home Care Worker Immigration Pilots |
| ircc | `IMM 0500` | In-Canada Transportation Loan Agreement |
| ircc | `IMM 0502` | Immigration Loans Program – Loan Agreement for Transportation to Canada |
| ircc | `IMM 0706` | Additional Background Information Form |
| ircc | `IMM 0707` | Consent to disclose personal information |
| ircc | `IMM 0800` | Application for a temporary resident document under the public policy for certain indigenous persons |
| ircc | `IMM 0802` | Confirmation of family relationships |
| ircc | `IMM 1324` | Undertaking/Application for a Joint Assistance Sponsorship |
| ircc | `IMM 1436` | Request to Amend Valid Temporary Resident Documents or Information Contained in the Confirmation of Permanent Residence or Protected Person Document |
| ircc | `IMM 1444` | Application for Criminal Rehabilitation |
| ircc | `IMM 5009` | Verification of Status (VOS) or Replacement of an Immigration Document |
| ircc | `IMM 5283` | Supplementary Information: Humanitarian and Compassionate Considerations |
| ircc | `IMM 5321` | Canada–United States–Mexico Agreement – Application for trader/investor status (work permit) |
| ircc | `IMM 5355` | Immigration Loans Program – Assistance Loan Agreement |
| ircc | `IMM 5438` | Request for a Refugee Profile |
| ircc | `IMM 5444` | Application for a Permanent Resident Card or Permanent Resident Travel Document |
| ircc | `IMM 5451` | Solemn Declaration Concerning a Permanent Resident Card That Was Lost, Stolen, Destroyed or Never Received |
| ircc | `IMM 5481` | Sponsorship Evaluation Form – Dependent Children |
| ircc | `IMM 5492` | Sponsor Assessment Form |
| ircc | `IMM 5494` | Settlement Plan: Joint Assistance Sponsorship |
| ircc | `IMM 5504` | Request for a Joint Assistance Sponsorship Refugee Profile |
| ircc | `IMM 5515` | Settlement Plan and Financial Assessment: Community Sponsors |
| ircc | `IMM 5526` | Supplementary Relationship Questionnaire |
| ircc | `IMM 5531` | Request to Reissue a Permanent Resident Card |
| ircc | `IMM 5532` | Relationship Information And Sponsorship Evaluation Form |
| ircc | `IMM 5536` | Authorization To Disclose Information |
| ircc | `IMM 5562` | Supplementary Information: Your Travels |
| ircc | `IMM 5563` | Access to Information and Personal Information Request |
| ircc | `IMM 5564` | Application for the Interim Federal Health Program (IFHP) Coverage |
| ircc | `IMM 5571` | Request for Processing Family Members under the One-Year Window of Opportunity Provisions |
| ircc | `IMM 5575` | Humanitarian and Compassionate Considerations under the February 4, 2016 Temporary Public Policy for Nationals of Haiti and Zimbabwe |
| ircc | `IMM 5604` | Declaration from Non-accompanying Parent/Guardian for Minors Immigrating to Canada |
| ircc | `IMM 5618` | Request to Add a Family Member to a Privately Sponsored Refugee Application |
| ircc | `IMM 5646` | Custodian Declaration Form |
| ircc | `IMM 5654` | Undertaking for an Application for a Work Permit Exempted from a Labour Market Impact Assessment (LMIA) as part of the AIP |
| ircc | `IMM 5663` | Sponsorship Undertaking and Settlement Plan: Community Sponsor (CS) |
| ircc | `IMM 5669` | Schedule A: Background / Declaration Form |
| ircc | `IMM 5670` | Sponsorship Undertaking and Settlement Plan: Groups of Five |
| ircc | `IMM 5686` | Request for an opinion on Work Permit or LMIA Exemption |
| ircc | `IMM 5708` | Application to Change Conditions, Extend my Stay or Remain in Canada as a Visitor or Temporary Resident Permit Holder |
| ircc | `IMM 5709` | Application to Change Conditions, Extend my Stay or Remain in Canada as a Student |
| ircc | `IMM 5710` | Application to Change Conditions, Extend my Stay or Remain in Canada as a Worker |
| ircc | `IMM 5744` | Consent for an Access to Information and Personal Information Request |
| ircc | `IMM 5748` | Income Sources for the Sponsorship of Parents and Grandparents |
| ircc | `IMM 5766` | Start-up business class commitment certificate |
| ircc | `IMM 5768` | Financial Evaluation for Parents and Grandparents Sponsorship |
| ircc | `IMM 5782` | Application to Voluntarily Renounce Permanent Resident Status |
| ircc | `IMM 5956` | Appointment of Representative(s) in Expected Community of Settlement Form |
| ircc | `IMM 5964` | International Mobility Program Employer Compliance Voluntary Disclosure Form |
| ircc | `IMM 5983` | Offer of Employment: Home Child Care Provider or Home Support Worker |
| ircc | `IMM 5984` | Offer of Employment to a foreign national: Rural and Immigration Pilot |
| uscis | `G-1145` | G-1145 / E-Notification of Application/Petition Acceptance |
| uscis | `G-1256` | G-1256 / Declaration for Interpreted USCIS Interview |
| uscis | `G-1450` | G-1450 / Authorization for Credit Card Transactions |
| uscis | `G-1566` | G-1566 / Request for Certificate of Non-Existence |
| uscis | `G-1650` | G-1650 / Authorization for ACH Transactions |
| uscis | `G-325R` | G-325R / Biographic Information (Registration) |
| uscis | `G-845` | G-845 / Verification Request |
| uscis | `G-884` | G-884 / Request for the Return of Original Documents |
| uscis | `I-102` | I-102 / Application for Replacement/Initial Nonimmigrant Arrival-Departure Document |
| uscis | `I-129F` | I-129F / Petition for Alien Fiancé(e) |
| uscis | `I-131` | I-131 / Application for Travel Documents, Parole Documents, and Arrival/Departure Records |
| uscis | `I-131A` | I-131A / Application for Carrier Documentation |
| uscis | `I-134` | I-134 / Declaration of Financial Support |
| uscis | `I-140` | I-140 / Immigrant Petition for Alien Workers |
| uscis | `I-140G` | I-140G / Immigrant Petition for the Gold Card Program |
| uscis | `I-191` | I-191 / Application for Relief Under Former Section 212(c) of the Immigration and Nationality Act (INA) |
| uscis | `I-192` | I-192 / Application for Advance Permission to Enter as a Nonimmigrant |
| uscis | `I-193` | I-193 / Application for Waiver of Passport and/or Visa |
| uscis | `I-212` | I-212 / Application for Permission to Reapply for Admission into the United States After Deportation or Removal |
| uscis | `I-356` | I-356 / Request for Cancellation of Public Charge Bond |
| uscis | `I-360` | I-360 / Petition for Amerasian, Widow(er), or Special Immigrant |
| uscis | `I-361` | I-361 / Affidavit of Financial Support and Intent to Petition for Legal Custody for Public Law 97-359 Amerasian |
| uscis | `I-363` | I-363 / Request to Enforce Affidavit of Financial Support and Intent to Petition for Legal Custody for Public Law 97-359 Amerasian |
| uscis | `I-407` | I-407 / Record of Abandonment of Lawful Permanent Resident Status |
| uscis | `I-508` | I-508 / Request for Waiver of Certain Rights, Privileges, Exemptions and Immunities |
| uscis | `I-526` | I-526 / Immigrant Petition by Standalone Investor |
| uscis | `I-526E` | I-526E / Immigrant Petition by Regional Center Investor |
| uscis | `I-539` | I-539 / Application to Extend/Change Nonimmigrant Status |
| uscis | `I-566` | I-566 / Interagency Record of Request - A, G or NATO Dependent Employment Authorization or Change/Adjustment to/from A, G or NATO Status |
| uscis | `I-600` | I-600 / Petition to Classify Orphan as an Immediate Relative |
| uscis | `I-600A` | I-600A / Application for Advance Processing of an Orphan Petition |
| uscis | `I-601` | I-601 / Application for Waiver of Grounds of Inadmissibility |
| uscis | `I-601A` | I-601A / Application for Provisional Unlawful Presence Waiver |
| uscis | `I-602` | I-602 / Application by Refugee for Waiver of Inadmissibility Grounds |
| uscis | `I-612` | I-612 / Application for Waiver of the Foreign Residence Requirement (under Section 212(e) of the Immigration and Nationality Act, as Amended) |
| uscis | `I-687` | I-687 / Application for Status as a Temporary Resident Under Section 245A of the Immigration and Nationality Act |
| uscis | `I-690` | I-690 / Application for Waiver of Grounds of Inadmissibility Under Sections 245A or 210 of the Immigration and Nationality Act |
| uscis | `I-698` | I-698 / Application to Adjust Status from Temporary to Permanent Resident (Under Section 245A of the INA) |
| uscis | `I-730` | I-730 / Refugee/Asylee Relative Petition |
| uscis | `I-751` | I-751 / Petition to Remove Conditions on Residence |
| uscis | `I-765V` | I-765V / Application for Employment Authorization for Abused Nonimmigrant Spouse |
| uscis | `I-800` | I-800 / Petition to Classify Convention Adoptee as an Immediate Relative |
| uscis | `I-800A` | I-800A / Application for Determination of Suitability to Adopt a Child from a Convention Country |
| uscis | `I-817` | I-817 / Application for Family Unity Benefits |
| uscis | `I-821` | I-821 / Application for Temporary Protected Status |
| uscis | `I-824` | I-824 / Application for Action on an Approved Application or Petition |
| uscis | `I-829` | I-829 / Petition by Investor to Remove Conditions on Permanent Resident Status |
| uscis | `I-854` | I-854 / Inter-Agency Alien Witness and Informant Record |
| uscis | `I-864A` | I-864A / Contract Between Sponsor and Household Member |
| uscis | `I-864P` | I-864P / HHS Poverty Guidelines for Affidavit of Support |
| uscis | `I-881` | I-881 / Application for Suspension of Deportation or Special Rule Cancellation of Removal (Pursuant to Section 203 of Public Law 105-100 (NACARA)) |
| uscis | `I-9` | I-9 / Employment Eligibility Verification |
| uscis | `I-90` | I-90 / Application to Replace Permanent Resident Card (Green Card) |
| uscis | `I-905` | I-905 / Application for Authorization to Issue Certification for Health Care Workers |
| uscis | `I-907` | I-907 / Request for Premium Processing Service |
| uscis | `I-914` | I-914 / Application for T Nonimmigrant Status |
| uscis | `I-918` | I-918 / Petition for U Nonimmigrant Status |
| uscis | `I-929` | I-929 / Petition for Qualifying Family Member of a U-1 Nonimmigrant |
| uscis | `I-941` | I-941 / Application for Entrepreneur Parole |
| uscis | `I-945` | I-945 / Public Charge Bond |
| uscis | `I-956` | I-956 / Application for Regional Center Designation |
| uscis | `I-956F` | I-956F / Application for Approval of an Investment in a Commercial Enterprise |
| uscis | `I-956G` | I-956G / Regional Center Annual Statement |
| uscis | `I-956H` | I-956H / Bona Fides of Persons Involved with Regional Center Program |
| uscis | `I-956K` | I-956K / Registration for Direct and Third-Party Promoters |
| uscis | `N-300` | N-300 / Application to File Declaration of Intention |
| uscis | `N-600` | N-600 / Application for Certificate of Citizenship |
| uscis | `N-600K` | N-600K / Application for Citizenship and Issuance of Certificate Under Section 322 |
| uscis | `N-644` | N-644 / Application for Posthumous Citizenship |

## Re-measured 2026-08-24: the citation basis is exhausted

`scripts/triage-sweep-findings.ts` re-run against production, read-only:

```
238 open findings; 229 readable registered sources.
read 157 pages, 72 unreadable or robots-disallowed.
discarded 36 match(es) that were site navigation rather than page text.

CITED by a page we already track: 0
NOT mentioned on any tracked page: 238
```

**Zero of 238.** That is a measurement, and it retires an inference. The earlier
note reasoned that the queue and the evidence basis must be disjoint, because
`SweepService.knownCodes()` excludes every code the catalogue already covers — so
a form our pages cite never enters the queue in the first place. The re-run
confirms it directly: not one of the 238 is named on any of the 157 pages we can
read.

Note the 36 discarded matches. They were real occurrences of real form codes,
and every one was site navigation — uscis.gov prints a "most accessed forms"
menu on every page. Without that filter this run would have reported dozens of
"cited" forms and the queue would have been cleared on furniture.

**So these 238 are blocked on evidence, not on effort.** No amount of triage
time moves them, because there is nothing to triage them against. Two things
would change that, and neither is triage:

* **Track more pages per authority.** VisaAI reads 30 canada.ca pages, not
  canada.ca. A form unmentioned across 30 pages mostly means we do not read the
  page that would mention it, which is why nothing here is ever marked
  `ignored`: that would convert our own coverage gap into a decision about a
  government form.
* **Regain access to the blocked authorities.** 72 of 229 registered sources are
  unreadable — the `immi.homeaffairs.gov.au` and `travel.state.gov` 403s. The
  USCIS half of this queue is unanswerable while the pages that would cite those
  forms cannot be fetched at all.

