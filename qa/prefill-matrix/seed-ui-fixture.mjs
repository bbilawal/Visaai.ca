/**
 * Seeds ONE applicant the browser check can log in as: a Canada visitor-visa
 * application with every required document verified and a prefill already
 * generated, so the Forms page has something real to render.
 *
 * Writes results/ui-fixture.json (email, password, applicationId).
 *
 *   source qa/prefill-matrix/api-env.sh
 *   node qa/prefill-matrix/seed-ui-fixture.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const require = createRequire(join(REPO, 'apps', 'api', 'package.json'));
const { createClient } = require('@supabase/supabase-js');

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4200';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const matrix = JSON.parse(readFileSync(join(HERE, 'matrix.json'), 'utf8'));
const pair = matrix.pairs.find((p) => p.countryCode === 'CA' && p.programId === 'visitor_visa');

const email = `qa.prefill.ui.${Date.now()}@example.invalid`;
const password = 'QaPrefill!2026Ui';
const { data: created, error: userErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true, user_metadata: { full_name: 'Noor Haddad' },
});
if (userErr) throw new Error(userErr.message);
const userId = created.user.id;
await admin.from('users').update({ full_name: 'Noor Haddad', nationality: 'Jordan' }).eq('id', userId);
await admin.from('user_profiles').upsert({
  user_id: userId, first_name: 'Noor', last_name: 'Haddad', phone: '+96279123456',
  address_line1: '14 Rainbow Street', city: 'Amman', region: 'Amman', postal_code: '11181', country: 'JO',
});

const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email, password });
if (signErr) throw new Error(signErr.message);
const token = session.session.access_token;

const { data: fw } = await admin.from('country_frameworks').upsert(
  {
    country_code: pair.countryCode, visa_type: pair.programId, purpose: pair.label,
    requirements_json: {
      base_documents: pair.documents.map((d) => ({ type: d.code, label: d.label, owner: d.ownedBy })),
      base_forms: pair.forms.map((f) => ({ form_code: f.formCode, form_name: f.formName, source_url: f.sourceUrl })),
    },
  },
  { onConflict: 'country_code,visa_type,purpose' },
).select('id').single();

const res = await fetch(`${API}/intake/applications`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ country: pair.countryCode }),
});
const { applicationId } = await res.json();
await admin.from('applications').update({ framework_id: fw.id }).eq('id', applicationId);

await admin.from('application_profiles').upsert({
  application_id: applicationId,
  profile_json: {
    full_name: 'Noor Haddad', date_of_birth: '1992-06-14', nationality: 'Jordan',
    country_of_residence: 'Jordan', marital_status: 'Single', occupation: 'Pharmacist',
    employer: 'Amman Care Pharmacy', annual_income: '38000', purpose_of_travel: 'Tourism',
    destination_country: 'Canada', intended_arrival: '2026-11-02', intended_departure: '2026-11-20',
    funds_available: '14500', previous_refusals: 'None',
  },
}, { onConflict: 'application_id' });

await admin.from('checklist_items').insert([
  ...pair.documents.map((d) => ({
    application_id: applicationId, document_type: d.code, label: d.label,
    required: d.required, status: 'verified', added_reason: 'base_requirement',
    meta: { kind: 'document', owner: d.ownedBy },
  })),
  ...pair.forms.map((f) => ({
    application_id: applicationId,
    document_type: `form_${f.formCode.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    label: `Form ${f.formCode} — ${f.formName}`, required: true, status: 'missing',
    added_reason: 'base_form',
    meta: { kind: 'form', owner: 'applicant', form_code: f.formCode, form_name: f.formName, source_url: f.sourceUrl },
  })),
]);

const EXTRACTIONS = {
  passport: { full_name: 'Noor Haddad', given_name: 'Noor', family_name: 'Haddad', date_of_birth: '1992-06-14', passport_number: 'J4471902', expiry_date: '2031-03-09', nationality: 'Jordan' },
  bank_statement: { full_name: 'Noor Haddad', bank_name: 'Arab Bank', closing_balance: '14500', currency: 'JOD' },
  employment_letter: { full_name: 'Noor Haddad', employer_name: 'Amman Care Pharmacy', job_title: 'Pharmacist', annual_salary: '38000' },
  travel_itinerary: { full_name: 'Noor Haddad', departure_date: '2026-11-02', return_date: '2026-11-20', accommodation: 'Hotel Bonaventure, Montreal' },
};
for (const [docType, extracted_fields] of Object.entries(EXTRACTIONS)) {
  const { data: doc } = await admin.from('documents').insert({
    application_id: applicationId, document_type: docType,
    storage_path: `qa/${applicationId}/${docType}.pdf`, mime_type: 'application/pdf',
    file_name: `${docType}.pdf`, upload_status: 'complete', ocr_status: 'complete',
  }).select('id').single();
  await admin.from('document_verifications').insert({
    document_id: doc.id, verification_type: 'identity', result: 'pass',
    details_json: { extracted_fields, raw_ocr_length: 2048 },
  });
}

const gen = await fetch(`${API}/prefill/${applicationId}/generate`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}` },
});
if (!gen.ok) throw new Error(`generate failed: ${gen.status} ${await gen.text()}`);
const body = await gen.json();

mkdirSync(join(HERE, 'results'), { recursive: true });
const out = { email, password, applicationId, fields: body.payload?.fields?.length ?? 0 };
writeFileSync(join(HERE, 'results', 'ui-fixture.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
