import { readFileSync } from 'node:fs';
import { isAllowed } from '../src/modules/visa-sync/robots';
const txt = readFileSync('/tmp/ca-robots.txt', 'utf8');
const UA = 'VisaAI-SourceMonitor/1.0 (+https://visaai.co/bots; visa requirement change monitoring)';
const urls = [
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/visitor-visa.html',
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eligibility.html',
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/apply-visitor-visa.html',
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5484.html',
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html',
];
for (const u of urls) {
  const v = isAllowed(txt, u, UA);
  console.log(`${v.allowed ? 'ALLOWED ' : 'BLOCKED '} delay=${v.crawlDelaySeconds ?? '-'} rule=${v.matchedRule ?? 'none'}  ${u.split('/').pop()}`);
}
