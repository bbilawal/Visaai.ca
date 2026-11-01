-- Record the form-sweep evidence pass: 19 findings confirmed in scope.
--
-- Migration 20260821260000 closed 8 findings on the only basis that needed no
-- judgement -- the form code is cited by an ACTIVE visa requirement. That basis
-- is exhausted: re-running it against the remaining 257 matches nothing.
--
-- THE SECOND BASIS, AND WHY IT IS STILL A MEASUREMENT
--
-- scripts/triage-sweep-findings.ts fetches every readable registered source and
-- asks which findings are NAMED on a page VisaAI already tracks. A form the
-- authority itself links from a page in visa_sources is, by the registry's own
-- reckoning, part of a route we cover.
--
-- THE FIRST RUN WAS MOSTLY WRONG, IN A SPECIFIC WAY
--
-- It found 25, and most were site furniture: uscis.gov prints a "most accessed
-- forms" menu on every page, so I-9, I-90, N-400 and I-129F appeared on all six
-- USCIS pages we track -- identically, in the navigation, at the same offset.
-- A signal that fires from a site menu says nothing about the route.
--
-- Same shape as the site-wide-republish rule in check-source-freshness.ts, and
-- the same treatment: a match is discarded when the 160-character window around
-- it appears verbatim on three or more other pages of the same host. 71 matches
-- were discarded. What survives is a sentence written about the page.
--
-- ACKNOWLEDGED, NOT ADDED
--
-- 'added' should mean the template was ingested, and nothing here ingests one.
-- 'acknowledged' is the schema's "seen it, still open" state and is exactly
-- what these are.
--
-- AND NOTHING WAS IGNORED
--
-- 'ignored' is terminal, and absence of a mention is weak evidence: VisaAI
-- tracks 6 canada.ca pages, not canada.ca. Zero of the 166 IRCC findings were
-- cited -- which measures OUR Canadian source coverage, not those forms' scope.
-- Marking them terminal would convert a gap of ours into a decision about a
-- government form.

begin;


update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.uscis.gov/i-485). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'AR-11' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 3 official page(s) VisaAI already tracks (https://www.uscis.gov/i-130 +2 more). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'G-1145' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.uscis.gov/i-129). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'G-1450' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.uscis.gov/i-129). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'G-1650' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.uscis.gov/i-485). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'G-28' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.uscis.gov/family/family-of-us-citizens). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-129F' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 2 official page(s) VisaAI already tracks (https://www.uscis.gov/i-485 +1 more). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-131' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.uscis.gov/i-485). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-140' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 2 official page(s) VisaAI already tracks (https://www.cbp.gov/travel/international-visitors/visa-waiver-program +1 more). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-192' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 2 official page(s) VisaAI already tracks (https://www.uscis.gov/i-130 +1 more). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-360' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 2 official page(s) VisaAI already tracks (https://www.uscis.gov/i-129 +1 more). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-539' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.uscis.gov/i-765). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-589' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility.html). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-751' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.uscis.gov/i-765). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-821D' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.uscis.gov/i-130). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-824' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility.html). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-829' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.uscis.gov/i-765). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-881' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 1 official page(s) VisaAI already tracks (https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility.html). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-90' and status = 'new';

update public.template_sweep_findings
set status = 'acknowledged', note = 'In scope by the registry''s own reading: named on 2 official page(s) VisaAI already tracks (https://www.uscis.gov/i-485 +1 more). Acknowledged, not added — the template has not been ingested. Recorded by scripts/triage-sweep-findings.ts.', updated_at = now()
where authority = 'uscis' and code = 'I-907' and status = 'new';


do $$
declare n int;
begin
  select count(*) into n from public.template_sweep_findings where status = 'acknowledged';
  if n <> 19 then
    raise warning 'Expected 19 acknowledged findings, found %. The sweep may have re-opened one, which is not an error -- the weekly upsert never resets a terminal state, and acknowledged is not terminal.', n;
  end if;
end $$;

commit;
