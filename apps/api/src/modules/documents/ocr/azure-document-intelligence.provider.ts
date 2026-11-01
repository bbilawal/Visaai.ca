import type {
  OcrProvider,
  OcrExtractionInput,
  OcrExtractionResult,
} from './ocr-provider.interface';
import type { ExtractedFields } from '../graphs/document.state';
import { safeLog } from '../../shared/log/redact';
import {
  defaultSleep,
  MAX_RETRY_DELAY_MS,
  NonRetryableOcrError,
  OcrHttpError,
  parseRetryAfterMs,
  retryDelayMs,
  withRetryTimeout,
} from './retry';
import { parseCivilDate } from './civil-records';
import {
  azureQueryFieldsFor,
  isIdentityDocumentType,
  resolveExtractionType,
  type ExtractionField,
} from './extraction-schema';

export interface AzureDocIntelConfig {
  endpoint?: string;
  apiKey?: string;
  region: string;
  /**
   * Analysis model. `prebuilt-idDocument` is the default because it returns the
   * OCR'd text AND structured identity fields in ONE call — and the run_ocr node
   * marks a zero-field result `verificationResult: 'fail'`, so a text-only model
   * would fail every document. `prebuilt-read` is text-only and appropriate only
   * where field extraction is handled elsewhere.
   */
  model?: string;
  /** Injectable for tests (backoff waits and poll interval). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; returns [0, 1). */
  random?: () => number;
}

/** Azure's async analyze envelope. Only the parts this adapter reads. */
interface AzureAnalyzeOperation {
  status?: string;
  error?: { code?: string; message?: string };
  analyzeResult?: {
    content?: string;
    documents?: {
      docType?: string;
      fields?: Record<string, AzureField | undefined>;
    }[];
  };
}

interface AzureField {
  type?: string;
  valueString?: string;
  valueDate?: string;
  valueNumber?: number;
  valueCountryRegion?: string;
  content?: string;
}

const API_VERSION = '2024-11-30';
const DEFAULT_MODEL = 'prebuilt-idDocument';
/**
 * Layout + the `queryFields` add-on: names the fields we want and Azure returns
 * them, IN REGION. This is the general-purpose path for every document
 * `prebuilt-idDocument` cannot read — bank statements, admission letters, birth
 * certificates, deeds. Query fields are a premium add-on and are billed per
 * request, which is why identity documents keep the cheaper dedicated model.
 */
const QUERY_FIELD_MODEL = 'prebuilt-layout';
/**
 * Guard on the bytes we will base64 and hold in memory for one request. Well
 * above the upload cap (MAX_UPLOAD_BYTES), so it is a backstop against a
 * mis-sized object, not a second policy.
 */
const MAX_ANALYZE_BYTES = 25 * 1024 * 1024;
/** Azure analyze is async; poll until terminal. Bounded by the AbortSignal. */
const POLL_INTERVAL_MS = 1_000;
/**
 * Consecutive throttled (429/503) poll responses tolerated before giving up on
 * this attempt. Each one waits its Retry-After; the attempt timeout still bounds
 * the total.
 */
const MAX_THROTTLED_POLLS = 8;
/**
 * Operation `failed` codes that describe the service's moment, not the
 * document — worth another attempt. Anything else (InvalidImage, …) will fail
 * identically every time.
 */
const TRANSIENT_OPERATION_CODES = new Set([
  'internalservererror',
  'timeout',
  'servicetemporarilyunavailable',
  'toomanyrequests',
]);

/**
 * Azure Document Intelligence (regional — e.g. Canada Central, EU). REGIONAL:
 * document bytes stay in the configured Azure region, which is what makes it
 * usable under a residency mode.
 *
 * Called over the REST API with `fetch` rather than @azure-rest/ai-document-
 * intelligence. The REST surface used here is three requests and a poll loop;
 * pulling in an SDK for that would add a dependency tree to an artifact that is
 * licence-gated and OSV-scanned in CI, for no behaviour we do not write anyway.
 *
 * VALIDATED AGAINST LIVE AZURE 2026-08-16 (closes RT-001 for these paths). A
 * real analyze call to the production Canada resource confirmed: POST returns
 * 202 + Operation-Location, the poll reaches `succeeded`, `analyzeResult
 * .content` carries the full text, and `documents[0].fields` comes back keyed
 * by exactly the query-field names requested with `valueString` populated —
 * the shape mapQueryFields parses. The resource tier supports the premium
 * queryFields add-on.
 *
 * Still covered by azure-document-intelligence.provider.spec.ts against a
 * mocked fetch for the polling, error and mapping paths. It fails closed on
 * every unexpected shape, so the failure mode is a document that errors, never
 * a document with invented fields.
 */
export class AzureDocumentIntelligenceProvider implements OcrProvider {
  readonly name = 'azure-di';
  readonly regional = true;
  readonly capabilities = {
    implemented: true,
    mimeTypes: [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'application/pdf',
    ],
  };

  constructor(private cfg: AzureDocIntelConfig) {}

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    const endpoint = this.cfg.endpoint?.replace(/\/+$/, '');
    const apiKey = this.cfg.apiKey;
    if (!endpoint || !apiKey) {
      throw new Error(
        'azure-di OCR is not configured (AZURE_DOC_INTEL_ENDPOINT / key missing)',
      );
    }

    // Route by document type unless the operator pinned a model explicitly.
    // `prebuilt-idDocument` returns NOTHING for a bank statement or an
    // admission letter, so sending every upload to it is what left applicants
    // re-typing those documents by hand.
    const route = resolveRoute(this.cfg.model, input.documentType);

    return withRetryTimeout(
      async (signal) => {
        // Send the BYTES, not a URL. MEASURED in production 2026-08-16: every
        // analyze request failed `HTTP 403 Forbidden` because the signed URL is
        // built from SUPABASE_URL, which is http://127.0.0.1:54421 on this
        // deployment — Azure refuses to fetch a loopback/private address, and
        // fetch_document's own HEAD check passes because the API *can* reach
        // its own loopback, so the failure surfaced only at Azure. Uploading
        // the content removes the requirement that Azure reach into our network
        // at all, which also means no signed URL for a passport or a bank
        // statement ever has to be publicly fetchable.
        const base64Source = await this.readDocument(input.signedUrl, signal);
        const operationUrl = await this.startAnalysis(
          endpoint,
          apiKey,
          route,
          base64Source,
          signal,
        );
        const result = await this.pollUntilTerminal(
          operationUrl,
          apiKey,
          signal,
        );
        return this.toExtractionResult(result, route, input.documentType);
      },
      {
        // Analyze is asynchronous and a multi-page PDF can take tens of seconds,
        // so this is deliberately longer than the 30s shared default.
        attempts: 3,
        timeoutMs: 60_000,
        sleep: this.cfg.sleep,
        random: this.cfg.random,
        onAttempt: (n) =>
          safeLog.warn(
            'ocr.azure-di',
            `attempt ${n} region=${this.cfg.region} model=${route.model} ` +
              `fields=${route.queryFields.length} mime=${input.mimeType}`,
          ),
      },
    );
  }

  /**
   * Read the document out of our own storage. The signed URL points at the
   * storage API, which this process can always reach — including when that is
   * loopback-only, which is exactly the case Azure could not handle.
   */
  private async readDocument(
    signedUrl: string,
    signal: AbortSignal,
  ): Promise<string> {
    const res = await fetch(signedUrl, { signal });
    if (!res.ok) {
      // The URL is signed and can echo the storage path, so it is not logged.
      throw new OcrHttpError(
        `azure-di could not read the document from storage (HTTP ${res.status})`,
        res.status,
      );
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new NonRetryableOcrError(
        'azure-di read an empty document from storage',
      );
    }
    if (bytes.byteLength > MAX_ANALYZE_BYTES) {
      throw new NonRetryableOcrError(
        `azure-di document is ${bytes.byteLength} bytes, over the ` +
          `${MAX_ANALYZE_BYTES}-byte analyze limit`,
      );
    }
    return bytes.toString('base64');
  }

  /** POST the analyze request; Azure replies 202 + an Operation-Location. */
  private async startAnalysis(
    endpoint: string,
    apiKey: string,
    route: AnalyzeRoute,
    base64Source: string,
    signal: AbortSignal,
  ): Promise<string> {
    // features/queryFields go on the QUERY STRING, per the 2024-11-30 REST
    // contract — not in the JSON body.
    const query = route.queryFields.length
      ? `&features=queryFields&queryFields=${encodeURIComponent(
          route.queryFields.join(','),
        )}`
      : '';
    const url =
      `${endpoint}/documentintelligence/documentModels/` +
      `${encodeURIComponent(route.model)}:analyze?api-version=${API_VERSION}${query}`;

    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base64Source }),
    });

    if (!res.ok) {
      // The body can echo the signed URL, so it is not logged or surfaced.
      throw new OcrHttpError(
        `azure-di analyze request failed (HTTP ${res.status} ${res.statusText})`,
        res.status,
        parseRetryAfterMs(res.headers),
      );
    }

    const operationUrl = res.headers.get('operation-location');
    if (!operationUrl) {
      throw new Error(
        'azure-di analyze accepted but returned no Operation-Location header',
      );
    }
    return operationUrl;
  }

  /** Poll the operation until it succeeds, fails, or the signal aborts. */
  private async pollUntilTerminal(
    operationUrl: string,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<AzureAnalyzeOperation> {
    const sleep = this.cfg.sleep ?? defaultSleep;
    let throttled = 0;
    for (;;) {
      if (signal.aborted) throw new Error('azure-di analyze timed out');

      const res = await fetch(operationUrl, {
        method: 'GET',
        signal,
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      });
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res.headers);
        // Polling is the classic throttle source. A throttled poll is not a
        // failed analysis: wait it out and poll again rather than throwing,
        // which would make the retry wrapper re-POST (and re-bill) the
        // document.
        if (
          (res.status === 429 || res.status === 503) &&
          throttled < MAX_THROTTLED_POLLS
        ) {
          throttled += 1;
          const err = new OcrHttpError('throttled', res.status, retryAfterMs);
          await sleep(
            retryDelayMs(throttled, err, {
              baseDelayMs: POLL_INTERVAL_MS,
              random: this.cfg.random,
            }),
          );
          continue;
        }
        throw new OcrHttpError(
          `azure-di poll failed (HTTP ${res.status} ${res.statusText})`,
          res.status,
          retryAfterMs,
        );
      }
      throttled = 0;

      const body = (await res.json()) as AzureAnalyzeOperation;
      const status = body.status?.toLowerCase();

      if (status === 'succeeded') return body;
      if (status === 'failed') {
        const message =
          `azure-di analyze failed: ${body.error?.code ?? 'unknown'} ` +
          `${body.error?.message ?? ''}`.trim();
        const code = (body.error?.code ?? '').toLowerCase();
        if (TRANSIENT_OPERATION_CODES.has(code)) throw new Error(message);
        throw new NonRetryableOcrError(message);
      }
      if (status !== 'notstarted' && status !== 'running') {
        // An unrecognised status is not "keep waiting" — fail closed rather
        // than spin until the timeout with no diagnosis.
        throw new Error(
          `azure-di analyze returned unexpected status "${body.status ?? 'none'}"`,
        );
      }

      // Azure says how long to wait between polls; polling faster than that
      // is exactly what earns a 429.
      const hinted = parseRetryAfterMs(res.headers);
      await sleep(
        Math.min(
          MAX_RETRY_DELAY_MS,
          Math.max(POLL_INTERVAL_MS, hinted ?? POLL_INTERVAL_MS),
        ),
      );
    }
  }

  private toExtractionResult(
    op: AzureAnalyzeOperation,
    route: AnalyzeRoute,
    documentType?: string,
  ): OcrExtractionResult {
    const text = op.analyzeResult?.content ?? '';
    // Query fields land in the same documents[].fields collection as a prebuilt
    // model's own schema, keyed by the names we asked for. Merge across every
    // returned document: layout can split a multi-page upload.
    const raw: Record<string, AzureField | undefined> = {};
    for (const doc of op.analyzeResult?.documents ?? []) {
      for (const [k, v] of Object.entries(doc.fields ?? {})) {
        if (raw[k] === undefined) raw[k] = v;
      }
    }

    const azureDocType = op.analyzeResult?.documents?.find(
      (d) => d.docType,
    )?.docType;
    const fields = route.queryFields.length
      ? mapQueryFields(raw, route.fieldsByName)
      : mapIdDocumentFields(raw, { azureDocType, documentType });
    return { text, fields };
  }
}

/** Which Azure model to call, and the query fields to ask it for. */
export interface AnalyzeRoute {
  model: string;
  queryFields: string[];
  fieldsByName: Record<string, ExtractionField>;
}

/**
 * Pick the model.
 *
 * An explicitly configured AZURE_DOC_INTEL_MODEL always wins — an operator who
 * pinned a model gets that model, with no query fields silently added to their
 * bill. Otherwise: identity documents go to `prebuilt-idDocument`, everything
 * else to layout + query fields, which is the only way the non-identity
 * document types produce fields at all without leaving the region.
 */
export function resolveRoute(
  configuredModel: string | undefined,
  documentType: string | undefined,
): AnalyzeRoute {
  if (configuredModel) {
    return { model: configuredModel, queryFields: [], fieldsByName: {} };
  }
  if (isIdentityDocumentType(documentType)) {
    return { model: DEFAULT_MODEL, queryFields: [], fieldsByName: {} };
  }
  const { names, byName } = azureQueryFieldsFor(documentType);
  if (names.length === 0) {
    return { model: DEFAULT_MODEL, queryFields: [], fieldsByName: {} };
  }
  return {
    model: QUERY_FIELD_MODEL,
    queryFields: names,
    fieldsByName: byName,
  };
}

/**
 * Map an Azure query-field response back onto our snake_case keys.
 *
 * Only names we ASKED for are mapped — `fieldsByName` is built from the same
 * request — so a stray key in the response can never invent a field. Values are
 * coerced to the shape the schema declares, and a number that will not parse is
 * dropped rather than stored as a string a government form would reject.
 */
export function mapQueryFields(
  raw: Record<string, AzureField | undefined>,
  fieldsByName: Record<string, ExtractionField>,
): ExtractedFields {
  const fields: ExtractedFields = {};

  for (const [name, spec] of Object.entries(fieldsByName)) {
    const azureField = raw[name];
    if (!azureField) continue;

    if (spec.type === 'number') {
      const n =
        typeof azureField.valueNumber === 'number'
          ? azureField.valueNumber
          : parseAmount(str(azureField));
      if (n !== undefined) fields[spec.key] = n;
      continue;
    }

    const value = str(azureField);
    if (!value) continue;

    if (spec.type === 'date') {
      const iso = normalizeDate(azureField.valueDate ?? value);
      if (iso) fields[spec.key] = iso;
      continue;
    }

    fields[spec.key] = value;
  }

  return fields;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * Normalise a date to YYYY-MM-DD, or return undefined.
 *
 * MEASURED 2026-08-16 on a synthetic bank statement: a query field asked for
 * the statement period end came back as `"to 31 July 2026"` (the label bled
 * into the value) and a date of birth as `"02 April 1998"`. Neither is a date a
 * government form accepts, and the prefill contract is YYYY-MM-DD.
 *
 * Only UNAMBIGUOUS forms are converted:
 *   - already ISO                        2026-07-31 (also 2026-07-31T00:00:00+05:00)
 *   - a spelled-out month, either order  31 July 2026 / July 31, 2026
 *   - year-first numeric                 2026/07/31
 *
 * A year outside 1900..(this year + 15) is another calendar (Persian
 * 1400/03/25, Thai Buddhist 2504) and gives undefined, never a date.
 *
 * A bare numeric date like 03/04/2026 is deliberately NOT converted: it is
 * 3 April or 4 March depending on the country that printed it, and this is an
 * immigration form. The raw string is kept so the applicant can correct it on
 * the review screen — guessing would silently put the wrong date on a filing.
 */
export function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v) return undefined;

  // ISO, also as a timestamp with an offset ("1990-05-14T00:00:00+05:00"):
  // the date part is the date as printed — converting the instant to UTC
  // would move a midnight birth date back a day.
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      v,
    );
  if (iso) return pad(+iso[1], +iso[2], +iso[3]);

  const yearFirst = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(v);
  if (yearFirst) {
    return pad(+yearFirst[1], +yearFirst[2], +yearFirst[3]);
  }

  // 31 July 2026 / 31 Jul 2026
  const dayFirst = /^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(v);
  if (dayFirst) {
    const m = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()];
    if (m) return pad(+dayFirst[3], m, +dayFirst[1]);
  }

  // July 31, 2026 / Jul 31 2026
  const monthFirst = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
  if (monthFirst) {
    const m = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()];
    if (m) return pad(+monthFirst[3], m, +monthFirst[2]);
  }

  // Civil-record prints: 14-October-1989, SEPTEMBER 02,1995, and a numeric
  // date whose order is unambiguous (16-9-1988 — 16 cannot be a month).
  const civil = parseCivilDate(v);
  if (civil)
    return pad(+civil.slice(0, 4), +civil.slice(5, 7), +civil.slice(8));

  // Ambiguous or polluted ("to 31 July 2026"): keep the raw text rather than
  // invent a date. It is shown to the applicant for review before filing.
  return v;
}

/**
 * Years a birth, issue or expiry date can have: 1900 to fifteen years ahead
 * (a passport or ID card issued today expires within ten). Anything else is
 * another calendar read as Gregorian — a Persian (Solar Hijri) 1400/03/25, a
 * Thai Buddhist 2504-… — and is never a date to file.
 */
function plausibleYear(y: number): boolean {
  return y >= 1900 && y <= new Date().getUTCFullYear() + 15;
}

function pad(y: number, m: number, d: number): string | undefined {
  if (!plausibleYear(y)) return undefined;
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * "CAD 18,450.00" / "$18,450" -> 18450. Returns undefined when there is no
 * unambiguous number, because a wrong balance on a visa application is worse
 * than a blank the applicant fills in themselves.
 */
function parseAmount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  // Strip currency symbols/codes and thousands separators, keep sign+decimal.
  const cleaned = value.replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return undefined;
  // More than one decimal point means we cannot tell the format apart.
  if ((cleaned.match(/\./g) ?? []).length > 1) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** Read one Azure field as a string, whatever its declared value type. */
function str(f: AzureField | undefined): string | undefined {
  if (!f) return undefined;
  const v =
    f.valueString ??
    f.valueDate ??
    f.valueCountryRegion ??
    f.content ??
    undefined;
  const t = typeof v === 'string' ? v.trim() : undefined;
  return t ? t : undefined;
}

/**
 * Map `prebuilt-idDocument` output onto ExtractedFields.
 *
 * Only keys Azure actually returned are set. A key is never defaulted, inferred
 * or filled with a placeholder: a missing field must stay missing so run_ocr can
 * see a low field count and mark the document for review, rather than being
 * handed a confident-looking wrong value.
 */
export function mapIdDocumentFields(
  raw: Record<string, AzureField | undefined>,
  context: {
    /** Azure's own classification, e.g. `idDocument.nationalIdentityCard`. */
    azureDocType?: string;
    /** The type we asked about (checklist slot / filename). */
    documentType?: string;
  } = {},
): ExtractedFields {
  const fields: ExtractedFields = {};

  const first = str(raw.FirstName);
  const last = str(raw.LastName);
  const full = [first, last].filter(Boolean).join(' ');
  if (full) fields.full_name = full;
  // The halves as the document prints them. Joined into full_name only, they
  // were split again downstream on the LAST word: MARIA JOSE / GARCIA LOPEZ
  // came back as family name "LOPEZ" (audit 2026-10-18). A single name is
  // the family name (IRCC: "if you have only one name, enter it as your
  // last name"; the given name stays blank), whichever half Azure put it in.
  if (first && last) {
    fields.given_name = first;
    fields.family_name = last;
  } else if (first || last) {
    fields.family_name = (first ?? last)!;
  }

  const dob = str(raw.DateOfBirth);
  if (dob) fields.date_of_birth = dob;

  // DocumentNumber is the passport number ONLY on a passport. On an ID card
  // it is the national identity number (Pakistan CNIC), and filing it as a
  // passport number made it "mismatch" the real passport (#34). Azure's own
  // docType decides; the requested type is the fallback.
  const num = str(raw.DocumentNumber);
  if (num) {
    if (isIdCardDocument(context)) fields.national_id_number = num;
    else fields.passport_number = num;
  }

  const sex = str(raw.Sex);
  if (sex) fields.sex = sex;

  // The MRZ text (a passport's, or a TD1 card's). Prefill reads sex and the
  // passport type out of it when the typed fields are missing.
  const mrz = str(raw.MachineReadableZone);
  if (mrz) fields.mrz = mrz;

  const exp = str(raw.DateOfExpiration);
  if (exp) fields.expiry_date = exp;

  const iss = str(raw.DateOfIssue);
  if (iss) fields.issue_date = iss;

  // Nationality is the passport-holder's nationality; CountryRegion is the
  // issuing state. They coincide on most passports but not all, so prefer the
  // explicit one and fall back rather than merging them.
  const nat = str(raw.Nationality) ?? str(raw.CountryRegion);
  if (nat) fields.nationality = nat;

  // Printed on passports (and some ID cards); IRCC asks for the city and
  // country of birth.
  const pob = str(raw.PlaceOfBirth);
  if (pob) fields.place_of_birth = pob;

  return fields;
}

function isIdCardDocument(context: {
  azureDocType?: string;
  documentType?: string;
}): boolean {
  const azure = (context.azureDocType ?? '').toLowerCase();
  if (azure.startsWith('iddocument.passport')) return false;
  if (azure.startsWith('iddocument.nationalidentitycard')) return true;
  return resolveExtractionType(context.documentType) === 'national_id';
}
