/**
 * Prefill matrix run — every supported destination country × every visa program
 * it registers, against a REAL API + a real local Supabase stack + the real
 * gpt-4o prefill graph.
 *
 * For each pair it seeds a distinct synthetic applicant (profile, account
 * details, verified checklist, dummy documents whose OCR output is written to
 * document_verifications exactly as the OCR pipeline writes it), then drives the
 * endpoints the Forms page calls:
 *
 *   POST   /intake/applications          (create — real path, real country gate)
 *   GET    /progress/:id                 (stage order regression)
 *   POST   /prefill/:id/generate
 *   GET    /prefill/:id
 *   PATCH  /prefill/:id/fields
 *   GET    /prefill/:id/official-forms
 *   GET    /forms/:id                    (documents page reference list)
 *   GET    /prefill/:id/pdf              (402 before payment, 200 after)
 *   GET    /prefill/:id/official-pdf/:code
 *
 * and audits the generated payload for: wrong country/visa, empty output,
 * placeholder/fabricated text, values that appear nowhere in the applicant's own
 * data (hallucination), and values belonging to ANOTHER scenario's applicant
 * (cross-contamination).
 *
 * Usage:
 *   source qa/visaai-autonomous-e2e/harness/qa-env.sh
 *   node qa/prefill-matrix/run-prefill-matrix.mjs [--limit N] [--concurrency N] [--only CA,FR]
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const require = createRequire(join(REPO, 'apps', 'api', 'package.json'));
const { createClient } = require('@supabase/supabase-js');

// ── config ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
const LIMIT = Number(flag('limit', '0')) || Infinity;
const CONCURRENCY = Number(flag('concurrency', '6'));
const ONLY = (flag('only', '') || '').split(',').filter(Boolean).map((s) => s.toUpperCase());

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4100';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SERVICE_KEY || !ANON_KEY) {
  console.error('missing SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY — source qa/visaai-autonomous-e2e/harness/qa-env.sh first');
  process.exit(1);
}

const OUT = join(HERE, 'results');
mkdirSync(OUT, { recursive: true });
const LEDGER = join(OUT, 'ledger.jsonl');
const PAYLOADS = join(OUT, 'payloads');
mkdirSync(PAYLOADS, { recursive: true });

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── synthetic applicants ──────────────────────────────────────────────────────
// Every value is fictional and every applicant is UNIQUE, which is what makes
// the cross-contamination check meaningful: a value from scenario N appearing in
// scenario M's form is a leak, not a coincidence.
const GIVEN = ['Amara', 'Bilal', 'Chiara', 'Dmitri', 'Elif', 'Farhan', 'Gita', 'Hiroshi', 'Ingrid', 'Jamal', 'Katarina', 'Luca'];
const FAMILY = ['Okonjo', 'Rahimi', 'Bellini', 'Volkov', 'Demir', 'Chowdhury', 'Iyer', 'Tanaka', 'Halvorsen', 'Nasser', 'Novak', 'Ferraro'];
const NATIONALITY = ['Nigeria', 'Pakistan', 'Italy', 'Georgia', 'Turkey', 'Bangladesh', 'India', 'Japan', 'Norway', 'Jordan', 'Croatia', 'Argentina'];
const CITY = ['Lagos', 'Karachi', 'Bologna', 'Tbilisi', 'Izmir', 'Chattogram', 'Pune', 'Sendai', 'Bergen', 'Amman', 'Split', 'Rosario'];
const EMPLOYER = ['Kestrel Logistics', 'Northwind Textiles', 'Marrow & Vale', 'Sable Analytics', 'Tessera Foods', 'Orbis Freight'];
const OCCUPATION = ['Operations manager', 'Mechanical engineer', 'Pharmacist', 'Data analyst', 'Schoolteacher', 'Architect'];

function persona(i, pair) {
  const g = GIVEN[i % GIVEN.length];
  const f = FAMILY[(i * 5 + 3) % FAMILY.length];
  // The numeric suffix makes the surname globally unique across the run without
  // making the name unrealistic enough to confuse the model.
  const family = `${f}${1000 + i}`;
  const nationality = NATIONALITY[(i * 7 + 2) % NATIONALITY.length];
  const city = CITY[(i * 7 + 2) % CITY.length];
  const passport = `X${String(4200000 + i * 37)}`;
  const dob = `19${String(70 + (i % 25)).padStart(2, '0')}-0${(i % 9) + 1}-1${i % 9}`;
  const employer = `${EMPLOYER[i % EMPLOYER.length]} ${1000 + i}`;
  return {
    index: i,
    given_name: g,
    family_name: family,
    full_name: `${g} ${family}`,
    nationality,
    date_of_birth: dob,
    passport_number: passport,
    passport_expiry: `203${i % 10}-11-2${i % 9}`,
    email: `qa.prefill.${i}@example.invalid`,
    phone: `+3670${String(1000000 + i * 13)}`,
    address_line1: `${10 + i} Rue Marchand`,
    city,
    region: 'Central',
    postal_code: `${10000 + i}`,
    country_of_residence: nationality,
    marital_status: i % 3 === 0 ? 'Married' : 'Single',
    occupation: OCCUPATION[i % OCCUPATION.length],
    employer,
    annual_income: `${40000 + i * 250}`,
    bank_balance: `${9000 + i * 111}`,
    bank_name: `Banque ${city}`,
    travel_start: `2026-1${i % 2}-0${(i % 8) + 1}`,
    travel_end: `2026-1${(i % 2) + 1}-2${i % 8}`,
    purpose_detail: pair.label,
    host_name: `${GIVEN[(i + 4) % GIVEN.length]} ${FAMILY[(i + 6) % FAMILY.length]}${2000 + i}`,
    institution: `${city} Institute of Technology`,
    course_name: 'MSc Renewable Energy',
    previous_visas: i % 4 === 0 ? 'Schengen C visa 2023' : 'None',
    refusals: i % 9 === 0 ? 'UK visitor visa refused 2021' : 'None',
  };
}

/**
 * Account-level details, shared by every scenario because they belong to the
 * ACCOUNT rather than the application. The prefill graph reads these for the
 * Contact/Address block.
 */
const ACCOUNT_PROFILE = {
  first_name: 'QA',
  last_name: 'Matrix',
  phone: '+3670000000',
  address_line1: '1 Test Way',
  city: 'Testville',
  region: 'Central',
  postal_code: '10000',
  country: 'HU',
};

/** What the OCR pipeline would have written into document_verifications. */
function documentExtractions(p) {
  return {
    passport: {
      full_name: p.full_name,
      given_name: p.given_name,
      family_name: p.family_name,
      date_of_birth: p.date_of_birth,
      passport_number: p.passport_number,
      expiry_date: p.passport_expiry,
      nationality: p.nationality,
      sex: 'F',
    },
    bank_statement: {
      full_name: p.full_name,
      bank_name: p.bank_name,
      account_holder: p.full_name,
      closing_balance: p.bank_balance,
      currency: 'EUR',
      statement_period: '2026-05-01 to 2026-07-31',
    },
    employment_letter: {
      full_name: p.full_name,
      employer_name: p.employer,
      job_title: p.occupation,
      annual_salary: p.annual_income,
      employment_start_date: '2019-03-04',
    },
    travel_itinerary: {
      full_name: p.full_name,
      departure_date: p.travel_start,
      return_date: p.travel_end,
      accommodation: `Hotel Central, ${p.city}`,
    },
    admission_letter: {
      full_name: p.full_name,
      institution_name: p.institution,
      course_name: p.course_name,
      course_start_date: p.travel_start,
    },
  };
}

/** The intake profile the interview would have produced. */
function intakeProfile(p, pair) {
  return {
    full_name: p.full_name,
    date_of_birth: p.date_of_birth,
    nationality: p.nationality,
    country_of_residence: p.country_of_residence,
    marital_status: p.marital_status,
    occupation: p.occupation,
    employer: p.employer,
    annual_income: p.annual_income,
    purpose_of_travel: pair.label,
    destination_country: pair.countryName,
    intended_arrival: p.travel_start,
    intended_departure: p.travel_end,
    funds_available: p.bank_balance,
    host_or_sponsor: p.host_name,
    previous_visas: p.previous_visas,
    previous_refusals: p.refusals,
    ...(pair.programId === 'student_visa'
      ? { institution: p.institution, course: p.course_name }
      : {}),
  };
}

// ── grounding / hallucination audit ───────────────────────────────────────────
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const digits = (s) => String(s).replace(/\D+/g, '');

// Values a form legitimately contains that come from neither the applicant's
// data nor an invention: enum answers, the destination itself, and the visa
// program being applied for.
const GENERIC = new Set([
  'yes', 'no', 'na', 'notapplicable', 'none', 'nil', 'unknown', 'male', 'female', 'other',
  'single', 'married', 'divorced', 'widowed', 'separated', 'f', 'm', 'eur', 'usd', 'gbp', 'cad', 'aud',
  'tourism', 'business', 'study', 'work', 'visit', 'family', 'temporaryresidentvisa', 'visitorvisa',
  'selfemployed', 'employed', 'employee', 'student', 'passport', 'ordinary', 'ordinarypassport',
  'english', 'french', 'true', 'false', 'applicant', 'principalapplicant', 'primary',
]);

const FORBIDDEN = [
  { re: /guarantee(d|s)?\s+(your\s+)?(visa\s+)?approval/i, tag: 'approval-guarantee' },
  { re: /100%\s+(approval|success)/i, tag: 'approval-guarantee' },
  { re: /lorem ipsum/i, tag: 'placeholder' },
  { re: /\bTODO\b|\bFIXME\b/, tag: 'placeholder' },
  { re: /\{\{\s*\w+\s*\}\}|\[INSERT[^\]]*\]/i, tag: 'placeholder' },
  { re: /undefined|\bNaN\b|\[object Object\]/, tag: 'placeholder' },
  { re: /system prompt|"role"\s*:\s*"system"|sk-[A-Za-z0-9]{20}/i, tag: 'prompt-or-secret-leak' },
  { re: /consult (an? )?(immigration )?(lawyer|attorney|professional)/i, tag: 'legal-advice' },
];

function auditPayload({ payload, persona: p, pair, groundTruth, otherTokens }) {
  const findings = [];
  if (!payload) return [{ severity: 'P1', tag: 'no-payload', detail: 'generate returned no payload' }];

  if ((payload.countryCode ?? '').toUpperCase() !== pair.countryCode.toUpperCase()) {
    findings.push({ severity: 'P1', tag: 'wrong-country', detail: `payload.countryCode=${payload.countryCode} expected ${pair.countryCode}` });
  }
  if ((payload.visaType ?? '') !== pair.programId) {
    findings.push({ severity: 'P1', tag: 'wrong-visa-type', detail: `payload.visaType=${payload.visaType} expected ${pair.programId}` });
  }
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  if (fields.length < 10) {
    findings.push({ severity: 'P1', tag: 'too-few-fields', detail: `${fields.length} fields` });
  }

  const filled = fields.filter((f) => String(f.value ?? '').trim() !== '');
  if (filled.length === 0) {
    findings.push({ severity: 'P1', tag: 'nothing-prefilled', detail: 'every field came back empty' });
  }

  // The applicant's identity must actually reach the form.
  const allValues = filled.map((f) => norm(f.value)).join('|');
  for (const [key, label] of [['family_name', 'surname'], ['passport_number', 'passport number']]) {
    if (!allValues.includes(norm(p[key]))) {
      findings.push({ severity: 'P2', tag: 'identity-missing', detail: `${label} (${p[key]}) is nowhere in the prefilled form` });
    }
  }

  for (const f of fields) {
    const value = String(f.value ?? '');
    if (!value.trim()) continue;

    for (const { re, tag } of FORBIDDEN) {
      if (re.test(value) || re.test(f.label ?? '')) {
        findings.push({ severity: 'P1', tag, detail: `${f.key}="${value}"` });
      }
    }

    // Cross-contamination: another synthetic applicant's unique token.
    for (const [token, owner] of otherTokens) {
      if (norm(value).includes(token)) {
        findings.push({ severity: 'P0', tag: 'cross-contamination', detail: `${f.key}="${value}" contains ${owner}'s data` });
      }
    }

    // Grounding: a value the model did not get from this applicant's own data.
    if (f.source === 'inferred') continue;
    const n = norm(value);
    if (!n || GENERIC.has(n)) continue;
    const d = digits(value);
    const grounded =
      groundTruth.some((g) => g.includes(n) || n.includes(g)) ||
      (d.length >= 4 && groundTruth.some((g) => digits(g).length >= 4 && (digits(g).includes(d) || d.includes(digits(g)))));
    if (!grounded) {
      findings.push({ severity: 'P2', tag: 'ungrounded-value', detail: `${f.key}="${value}" (source=${f.source}) appears in no supplied document or profile` });
    }
  }
  return findings;
}

// ── http ──────────────────────────────────────────────────────────────────────
async function api(path, { token, method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

// ── per-scenario run ──────────────────────────────────────────────────────────
async function seedScenario(i, pair, token, userId) {
  const p = persona(i, pair);

  // 1. framework (country + the SPECIFIC program) — visa_type is the program id,
  //    which form-catalog resolves directly.
  const { data: fw, error: fwErr } = await admin
    .from('country_frameworks')
    .upsert(
      {
        country_code: pair.countryCode,
        visa_type: pair.programId,
        purpose: pair.label,
        requirements_json: {
          base_documents: pair.documents.map((d) => ({ type: d.code, label: d.label, owner: d.ownedBy })),
          base_forms: pair.forms.map((f) => ({ form_code: f.formCode, form_name: f.formName, source_url: f.sourceUrl })),
        },
      },
      { onConflict: 'country_code,visa_type,purpose' },
    )
    .select('id')
    .single();
  if (fwErr) throw new Error(`framework upsert failed: ${fwErr.message}`);

  // 2. application through the REAL endpoint (exercises the country gate)
  const created = await api('/intake/applications', { token, method: 'POST', body: { country: pair.countryCode } });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`create application failed: ${created.status} ${created.text?.slice(0, 200)}`);
  }
  const applicationId = created.json.applicationId;

  // 3. attach the framework (intake leaves framework_id null; the Forms stage
  //    reads visa type through it, so a matrix run must set it)
  await admin.from('applications').update({ framework_id: fw.id }).eq('id', applicationId);

  // 4. intake profile
  await admin
    .from('application_profiles')
    .upsert({ application_id: applicationId, profile_json: intakeProfile(p, pair) }, { onConflict: 'application_id' });

  // 5. checklist — required documents verified, forms left as forms
  const items = [
    ...pair.documents.map((d) => ({
      application_id: applicationId,
      document_type: d.code,
      label: d.label,
      required: d.required,
      status: 'verified',
      added_reason: 'base_requirement',
      meta: { kind: 'document', owner: d.ownedBy },
    })),
    ...pair.forms.map((f) => ({
      application_id: applicationId,
      document_type: `form_${f.formCode.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      label: `Form ${f.formCode} — ${f.formName}`,
      required: true,
      status: 'missing',
      added_reason: 'base_form',
      meta: { kind: 'form', owner: 'applicant', form_code: f.formCode, form_name: f.formName, source_url: f.sourceUrl },
    })),
  ];
  const { error: ciErr } = await admin.from('checklist_items').insert(items);
  if (ciErr) throw new Error(`checklist insert failed: ${ciErr.message}`);

  // 6. dummy documents + the OCR output the pipeline would have written
  const extractions = documentExtractions(p);
  const docTypes = ['passport', 'bank_statement', 'employment_letter', 'travel_itinerary'];
  if (pair.programId === 'student_visa') docTypes.push('admission_letter');
  for (const docType of docTypes) {
    const { data: doc, error: dErr } = await admin
      .from('documents')
      .insert({
        application_id: applicationId,
        document_type: docType,
        storage_path: `qa/${applicationId}/${docType}.pdf`,
        mime_type: 'application/pdf',
        file_name: `${docType}.pdf`,
        upload_status: 'complete',
        ocr_status: 'complete',
      })
      .select('id')
      .single();
    if (dErr) throw new Error(`document insert failed: ${dErr.message}`);
    const { error: vErr } = await admin.from('document_verifications').insert({
      document_id: doc.id,
      verification_type: 'identity',
      result: 'pass',
      details_json: { extracted_fields: extractions[docType], raw_ocr_length: 1234 },
    });
    if (vErr) throw new Error(`verification insert failed: ${vErr.message}`);
  }

  // 7. account-level details (the Contact/Address block of the form)
  await admin.from('users').update({ full_name: p.full_name, nationality: p.nationality }).eq('id', userId);

  const groundTruth = [
    ...Object.values(intakeProfile(p, pair)),
    ...docTypes.flatMap((t) => Object.values(extractions[t])),
    p.email, p.phone, p.address_line1, p.city, p.region, p.postal_code, p.given_name, p.family_name,
    pair.countryName, pair.countryCode, pair.label,
    // The account record (users + user_profiles) is supplied data too — the
    // prefill graph reads it deliberately for the Contact/Address block, so
    // omitting it here would report every contact field as ungrounded.
    ...Object.values(ACCOUNT_PROFILE),
  ].filter((v) => v != null && String(v).trim() !== '').map(norm);

  return { applicationId, persona: p, groundTruth };
}

async function runScenario(i, pair, token, userId, otherTokens) {
  const started = new Date().toISOString();
  const row = {
    scenario_id: `${pair.countryCode}-${pair.programId}`,
    index: i,
    country: pair.countryCode,
    country_name: pair.countryName,
    program: pair.programId,
    label: pair.label,
    started_at: started,
    checks: {},
    findings: [],
    status: 'fail',
  };
  try {
    const { applicationId, persona: p, groundTruth } = await seedScenario(i, pair, token, userId);
    row.application_id = applicationId;

    // progress: stage order regression (Forms must sit at index 3, Readiness 4)
    const progress = await api(`/progress/${applicationId}`, { token });
    row.checks.progress_status = progress.status;
    if (progress.status === 200) {
      const slugs = (progress.json.stages ?? []).map((s) => s.slug);
      row.checks.stage_order = slugs.join('>');
      const expected = 'intake>documents>narrative>prefill>readiness>submission';
      if (slugs.join('>') !== expected) {
        row.findings.push({ severity: 'P1', tag: 'stage-order', detail: `${slugs.join('>')} != ${expected}` });
      }
      // Every required DOCUMENT is verified in the seed; only blank government
      // forms remain outstanding. The documents stage must therefore read
      // complete and Submit must not be locked.
      const stageState = Object.fromEntries((progress.json.stages ?? []).map((s) => [s.slug, s]));
      row.checks.documents_state = `${stageState.documents?.state}/${stageState.documents?.pct}%`;
      row.checks.submission_state = stageState.submission?.state;
      if (stageState.documents?.state !== 'complete') {
        row.findings.push({ severity: 'P1', tag: 'documents-not-complete', detail: `documents=${stageState.documents?.state} ${stageState.documents?.pct}% with every required document verified` });
      }
      if (stageState.submission?.state === 'locked') {
        row.findings.push({ severity: 'P1', tag: 'submission-locked', detail: 'submit stayed locked with every required document verified' });
      }
    } else {
      row.findings.push({ severity: 'P2', tag: 'progress-failed', detail: `GET /progress -> ${progress.status}` });
    }

    // generate
    const gen = await api(`/prefill/${applicationId}/generate`, { token, method: 'POST' });
    row.checks.generate_status = gen.status;
    if (gen.status !== 200 && gen.status !== 201) {
      row.findings.push({ severity: 'P1', tag: 'generate-failed', detail: `${gen.status} ${gen.text?.slice(0, 300)}` });
      throw new Error(`generate ${gen.status}`);
    }
    const payload = gen.json?.payload ?? null;
    row.checks.field_count = payload?.fields?.length ?? 0;
    writeFileSync(join(PAYLOADS, `${row.scenario_id}.json`), JSON.stringify({ persona: p, payload }, null, 2));

    row.findings.push(...auditPayload({ payload, persona: p, pair, groundTruth, otherTokens }));

    // read back
    const got = await api(`/prefill/${applicationId}`, { token });
    row.checks.get_status = got.status;
    if (got.status !== 200 || !got.json?.payload) {
      row.findings.push({ severity: 'P1', tag: 'get-failed', detail: `${got.status}` });
    } else if ((got.json.payload.fields ?? []).length !== (payload?.fields ?? []).length) {
      row.findings.push({ severity: 'P2', tag: 'persist-mismatch', detail: 'stored field count differs from generated' });
    }
    if (got.json?.paid !== false) {
      row.findings.push({ severity: 'P2', tag: 'paid-default', detail: `paid=${got.json?.paid} before any payment` });
    }

    // edit + save
    const edited = (payload?.fields ?? []).map((f, idx) => (idx === 0 ? { ...f, value: 'QA-EDITED' } : f));
    const patched = await api(`/prefill/${applicationId}/fields`, { token, method: 'PATCH', body: { fields: edited } });
    row.checks.patch_status = patched.status;
    if (patched.status !== 200) {
      row.findings.push({ severity: 'P1', tag: 'save-failed', detail: `PATCH -> ${patched.status} ${patched.text?.slice(0, 200)}` });
    } else {
      const after = await api(`/prefill/${applicationId}`, { token });
      if (after.json?.payload?.fields?.[0]?.value !== 'QA-EDITED') {
        row.findings.push({ severity: 'P1', tag: 'edit-not-persisted', detail: 'saved value did not come back' });
      }
    }

    // official forms (Forms page) + reference list (documents page)
    const official = await api(`/prefill/${applicationId}/official-forms`, { token });
    row.checks.official_forms_status = official.status;
    const offered = official.json?.forms ?? [];
    row.checks.official_forms = offered.map((f) => f.form_code).join(',');
    if (official.status !== 200) {
      row.findings.push({ severity: 'P1', tag: 'official-forms-failed', detail: `${official.status}` });
    } else if (offered.length !== pair.forms.length) {
      row.findings.push({ severity: 'P2', tag: 'official-forms-count', detail: `offered ${offered.length}, program requires ${pair.forms.length}` });
    }

    const formsRef = await api(`/forms/${applicationId}`, { token });
    row.checks.forms_endpoint_status = formsRef.status;
    if (formsRef.status !== 200 || !Array.isArray(formsRef.json)) {
      row.findings.push({ severity: 'P2', tag: 'forms-endpoint', detail: `GET /forms -> ${formsRef.status}` });
    }

    // paywall: locked before payment
    const lockedPdf = await api(`/prefill/${applicationId}/pdf`, { token, raw: true });
    row.checks.pdf_unpaid_status = lockedPdf.status;
    if (lockedPdf.status !== 402) {
      row.findings.push({ severity: 'P0', tag: 'paywall-bypass', detail: `unpaid PDF download returned ${lockedPdf.status}, expected 402` });
    }

    // pay, then download
    const { error: payErr } = await admin.from('payments').insert({
      user_id: userId,
      application_id: applicationId,
      feature: 'prefill',
      plan_tier: 'self_service',
      status: 'complete',
      amount_cents: 2900,
    });
    if (payErr) throw new Error(`payment seed failed: ${payErr.message}`);

    const paidPdf = await api(`/prefill/${applicationId}/pdf`, { token, raw: true });
    row.checks.pdf_paid_status = paidPdf.status;
    row.checks.pdf_bytes = paidPdf.bytes?.length ?? 0;
    if (paidPdf.status !== 200 || paidPdf.bytes.subarray(0, 4).toString() !== '%PDF') {
      row.findings.push({ severity: 'P1', tag: 'pdf-failed', detail: `paid PDF -> ${paidPdf.status}, ${paidPdf.bytes?.length ?? 0} bytes` });
    }

    for (const form of offered.filter((f) => f.official_supported)) {
      const stamped = await api(`/prefill/${applicationId}/official-pdf/${encodeURIComponent(form.form_code)}`, { token, raw: true });
      row.checks[`official_pdf_${form.form_code}`] = `${stamped.status}/${stamped.bytes?.length ?? 0}`;
      if (stamped.status === 200) {
        if (stamped.bytes.subarray(0, 4).toString() !== '%PDF') {
          row.findings.push({ severity: 'P1', tag: 'official-pdf-not-pdf', detail: `${form.form_code} returned non-PDF bytes` });
        }
      } else if (stamped.status !== 503) {
        row.findings.push({ severity: 'P1', tag: 'official-pdf-failed', detail: `${form.form_code} -> ${stamped.status}` });
      }
    }

    row.status = row.findings.some((f) => f.severity === 'P0' || f.severity === 'P1') ? 'fail' : 'pass';
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
    if (!row.findings.length) row.findings.push({ severity: 'P1', tag: 'threw', detail: row.error });
    row.status = 'fail';
  }
  row.finished_at = new Date().toISOString();
  appendFileSync(LEDGER, JSON.stringify(row) + '\n');
  const worst = row.findings.reduce((w, f) => (f.severity < w ? f.severity : w), 'P3');
  console.log(
    `${row.status === 'pass' ? '✅' : '❌'} ${row.scenario_id.padEnd(26)} fields=${String(row.checks.field_count ?? '-').padStart(3)} ` +
    `gen=${row.checks.generate_status ?? '-'} pdf=${row.checks.pdf_unpaid_status ?? '-'}/${row.checks.pdf_paid_status ?? '-'} ` +
    `forms=${row.checks.official_forms || '-'} findings=${row.findings.length}${row.findings.length ? ` (worst ${worst})` : ''}`,
  );
  return row;
}

// ── main ──────────────────────────────────────────────────────────────────────
const matrix = JSON.parse(readFileSync(join(HERE, 'matrix.json'), 'utf8'));
let pairs = matrix.pairs;
if (ONLY.length) pairs = pairs.filter((p) => ONLY.includes(p.countryCode));
pairs = pairs.slice(0, LIMIT === Infinity ? undefined : LIMIT);

// One account per run, reused by every scenario — the applications are what the
// matrix varies, and a shared owner also proves scenarios cannot see each other.
const email = `qa.prefill.matrix.${Date.now()}@example.invalid`;
const password = 'QaPrefill!2026Matrix';
const { data: created, error: userErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true, user_metadata: { full_name: 'QA Prefill Matrix' },
});
if (userErr) throw new Error(`could not create the test user: ${userErr.message}`);
const userId = created.user.id;

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email, password });
if (signErr) throw new Error(`sign-in failed: ${signErr.message}`);
const token = session.session.access_token;

await admin.from('user_profiles').upsert({ user_id: userId, ...ACCOUNT_PROFILE });

console.log(`running ${pairs.length} country×program scenarios against ${API} as ${email}\n`);

// Unique tokens of every OTHER applicant, for the contamination check.
const tokensByIndex = pairs.map((pair, i) => {
  const p = persona(i, pair);
  return [norm(p.passport_number), norm(p.family_name), norm(p.employer)];
});

const results = [];
let cursor = 0;
async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= pairs.length) return;
    const otherTokens = [];
    tokensByIndex.forEach((toks, j) => {
      if (j !== i) toks.forEach((t) => otherTokens.push([t, `applicant#${j}`]));
    });
    results.push(await runScenario(i, pairs[i], token, userId, otherTokens));
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, worker));

// ── summary ───────────────────────────────────────────────────────────────────
const pass = results.filter((r) => r.status === 'pass').length;
const bySeverity = {};
for (const r of results) for (const f of r.findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
const byTag = {};
for (const r of results) for (const f of r.findings) byTag[f.tag] = (byTag[f.tag] ?? 0) + 1;

const summary = {
  ran_at: new Date().toISOString(),
  api: API,
  scenarios: results.length,
  pass,
  fail: results.length - pass,
  countries: new Set(results.map((r) => r.country)).size,
  programs: new Set(results.map((r) => r.program)).size,
  findings_by_severity: bySeverity,
  findings_by_tag: byTag,
  failures: results.filter((r) => r.status !== 'pass').map((r) => ({ scenario: r.scenario_id, findings: r.findings, error: r.error })),
};
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`\n${pass}/${results.length} passed · findings ${JSON.stringify(bySeverity)} · tags ${JSON.stringify(byTag)}`);
console.log(`ledger: ${LEDGER}\nsummary: ${join(OUT, 'summary.json')}`);
process.exit(summary.fail > 0 ? 1 : 0);
