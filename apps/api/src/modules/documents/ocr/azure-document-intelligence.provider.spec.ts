import {
  AzureDocumentIntelligenceProvider,
  mapIdDocumentFields,
  mapQueryFields,
  normalizeDate,
  resolveRoute,
} from './azure-document-intelligence.provider';
import {
  azureQueryFieldsFor,
  AZURE_QUERY_FIELD_LIMIT,
  extractionFieldsFor,
  KNOWN_EXTRACTION_TYPES,
} from './extraction-schema';
import { isRetryableError, OcrHttpError } from './retry';

/**
 * OCR-001 — the regional adapter that resolves the production deadlock.
 *
 * Production refuses to boot on a non-regional OCR provider, and every regional
 * provider was an unimplemented scaffold, so no production configuration could
 * both boot and read a document (see ocr-deadlock.spec.ts). This is the adapter
 * that closes that.
 *
 * It has never spoken to Azure. These tests drive it against a mocked fetch, so
 * what is verified is the request shape, the async poll loop, every terminal
 * status, and the field mapping. What is NOT verified is that Azure agrees —
 * that needs a real endpoint and key.
 *
 * The mapping tests carry the most weight. An OCR adapter that invents a field
 * is worse than one that fails: a wrong passport number looks exactly like a
 * right one, and it is being written against a real person's application.
 */
const ENDPOINT = 'https://ca-central.cognitiveservices.azure.com';
const OP_URL = 'https://ca-central.cognitiveservices.azure.com/op/123';

function provider(model?: string) {
  return new AzureDocumentIntelligenceProvider({
    endpoint: ENDPOINT,
    apiKey: 'test-key',
    region: 'ca-central-1',
    model,
  });
}

const INPUT = {
  signedUrl: 'https://storage.example/doc.png?sig=abc',
  mimeType: 'image/png',
  region: 'ca-central-1',
};

/**
 * An identity document. Routing is per document type now: only these reach
 * `prebuilt-idDocument`, because that model returns NOTHING for a bank
 * statement or an admission letter.
 */
const PASSPORT_INPUT = { ...INPUT, documentType: 'passport' };

/** Build a fetch stub: one POST (202 + Operation-Location) then N polls. */
function mockFetch(polls: unknown[], postStatus = 202) {
  let call = 0;
  return jest.fn((url: string | URL, init?: RequestInit): Promise<Response> => {
    // The adapter first reads the document out of OUR storage, then uploads the
    // bytes to Azure. That first GET is the signed-URL read.
    if (String(url).startsWith('https://storage.example')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map() as unknown as Headers,
        // NOTE: not `Buffer.from(s).buffer` — that hands back Node's whole
        // shared pool, not this string's slice.
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode('PDFBYTES').buffer),
      } as unknown as Response);
    }
    call += 1;
    const isPost = init?.method === 'POST';
    if (isPost) {
      return Promise.resolve({
        ok: postStatus >= 200 && postStatus < 300,
        status: postStatus,
        statusText: 'Accepted',
        headers: new Map([
          ['operation-location', OP_URL],
        ]) as unknown as Headers,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    }
    const body = polls[Math.min(call - 2, polls.length - 1)];
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map() as unknown as Headers,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  });
}

/** The analyze POST — calls[0] is the storage read that precedes it. */
function analyzeCall(f: jest.Mock): [string, RequestInit] {
  const call = f.mock.calls.find(
    (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
  );
  if (!call) throw new Error('no analyze POST was made');
  return call as [string, RequestInit];
}

const succeeded = (fields: Record<string, unknown>, content = 'RAW TEXT') => ({
  status: 'succeeded',
  analyzeResult: { content, documents: [{ fields }] },
});

describe('AzureDocumentIntelligenceProvider', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('is declared IMPLEMENTED — this flag is what the boot guard reads', () => {
    // If this ever reverts to false, the production deadlock is back.
    expect(provider().capabilities.implemented).toBe(true);
    expect(provider().regional).toBe(true);
  });

  it('POSTs the analyze request with the key, model and urlSource', async () => {
    const f = mockFetch([succeeded({ DocumentNumber: { valueString: 'X1' } })]);
    global.fetch = f;

    await provider().extract(PASSPORT_INPUT);

    const [url, init] = analyzeCall(f);
    expect(url).toContain('/documentintelligence/documentModels/');
    expect(url).toContain('prebuilt-idDocument:analyze');
    expect(url).toContain('api-version=2024-11-30');
    expect(
      (init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key'],
    ).toBe('test-key');
    expect(JSON.parse(init.body as string)).toEqual({
      base64Source: Buffer.from('PDFBYTES').toString('base64'),
    });
  });

  it('honours a configured model override', async () => {
    const f = mockFetch([succeeded({})]);
    global.fetch = f;

    await provider('prebuilt-read').extract(INPUT);

    expect(analyzeCall(f)[0]).toContain('prebuilt-read:analyze');
  });

  it('polls while the operation is running, then returns the result', async () => {
    const f = mockFetch([
      { status: 'notStarted' },
      { status: 'running' },
      succeeded({ FirstName: { valueString: 'Ada' } }),
    ]);
    global.fetch = f;

    const out = await provider().extract(PASSPORT_INPUT);

    // 1 storage read + 1 POST + 3 polls.
    expect(f).toHaveBeenCalledTimes(5);
    expect(out.text).toBe('RAW TEXT');
    expect(out.fields.full_name).toBe('Ada');
  });

  it("throws when the operation reports failed, quoting Azure's code", async () => {
    global.fetch = mockFetch([
      {
        status: 'failed',
        error: { code: 'InvalidImage', message: 'bad file' },
      },
    ]);

    await expect(provider().extract(INPUT)).rejects.toThrow(/InvalidImage/);
  });

  it('fails closed on an unrecognised status instead of polling forever', async () => {
    // A status nobody anticipated must not be treated as "keep waiting" — that
    // spins until the timeout and reports nothing useful.
    global.fetch = mockFetch([{ status: 'somethingNew' }]);

    await expect(provider().extract(INPUT)).rejects.toThrow(
      /unexpected status/,
    );
  });

  it('throws when configuration is missing', async () => {
    const p = new AzureDocumentIntelligenceProvider({ region: 'ca-central-1' });
    await expect(p.extract(INPUT)).rejects.toThrow(/not configured/);
  });

  it('does not leak the signed URL into the error on an HTTP failure', async () => {
    global.fetch = mockFetch([], 403);

    await expect(provider().extract(INPUT)).rejects.toThrow(/HTTP 403/);
    await expect(provider().extract(INPUT)).rejects.not.toThrow(/sig=abc/);
  });
});

describe('mapIdDocumentFields — never invent a field', () => {
  it('maps every field Azure returned', () => {
    expect(
      mapIdDocumentFields({
        FirstName: { valueString: 'Grace' },
        LastName: { valueString: 'Hopper' },
        DocumentNumber: { valueString: 'P1234567' },
        DateOfBirth: { valueDate: '1906-12-09' },
        DateOfExpiration: { valueDate: '2030-01-01' },
        DateOfIssue: { valueDate: '2020-01-01' },
        Nationality: { valueCountryRegion: 'USA' },
      }),
    ).toEqual({
      full_name: 'Grace Hopper',
      given_name: 'Grace',
      family_name: 'Hopper',
      passport_number: 'P1234567',
      date_of_birth: '1906-12-09',
      expiry_date: '2030-01-01',
      issue_date: '2020-01-01',
      nationality: 'USA',
    });
  });

  it('omits keys Azure did not return — a missing field stays missing', () => {
    // The whole point. run_ocr counts fields to decide pass/warn/fail; a
    // defaulted or placeholder value would launder "we do not know" into
    // "we checked and it is this".
    const out = mapIdDocumentFields({ DocumentNumber: { valueString: 'A1' } });

    expect(out).toEqual({ passport_number: 'A1' });
    expect('full_name' in out).toBe(false);
    expect('date_of_birth' in out).toBe(false);
  });

  it('returns an empty object for an empty response, not a shaped skeleton', () => {
    expect(mapIdDocumentFields({})).toEqual({});
  });

  it('treats blank and whitespace-only values as absent', () => {
    expect(
      mapIdDocumentFields({
        FirstName: { valueString: '   ' },
        DocumentNumber: { valueString: '' },
      }),
    ).toEqual({});
  });

  it('builds full_name from whichever name parts exist', () => {
    expect(
      mapIdDocumentFields({ LastName: { valueString: 'Lovelace' } }),
    ).toEqual({ full_name: 'Lovelace', family_name: 'Lovelace' });
  });

  it('keeps multi-word given and family names as printed (audit 2026-10-18)', () => {
    expect(
      mapIdDocumentFields({
        FirstName: { valueString: 'MARIA JOSE' },
        LastName: { valueString: 'GARCIA LOPEZ' },
      }),
    ).toEqual({
      full_name: 'MARIA JOSE GARCIA LOPEZ',
      given_name: 'MARIA JOSE',
      family_name: 'GARCIA LOPEZ',
    });
  });

  it('a single name is the family name, the given name left blank', () => {
    const out = mapIdDocumentFields({ FirstName: { valueString: 'SUKARNO' } });
    expect(out).toEqual({ full_name: 'SUKARNO', family_name: 'SUKARNO' });
    expect('given_name' in out).toBe(false);
  });

  it('prefers Nationality over CountryRegion but accepts either', () => {
    expect(
      mapIdDocumentFields({
        Nationality: { valueCountryRegion: 'GBR' },
        CountryRegion: { valueCountryRegion: 'CAN' },
      }).nationality,
    ).toBe('GBR');
    expect(
      mapIdDocumentFields({ CountryRegion: { valueCountryRegion: 'CAN' } })
        .nationality,
    ).toBe('CAN');
  });

  it('falls back to content when no typed value is present', () => {
    expect(
      mapIdDocumentFields({ DocumentNumber: { content: 'Z9' } })
        .passport_number,
    ).toBe('Z9');
  });
});

/**
 * Document-type routing + query fields.
 *
 * `prebuilt-idDocument` returns identity fields only, so every non-identity
 * upload — bank statement, admission letter, birth certificate, deed — came
 * back with nothing and the applicant re-typed it. Layout + the queryFields
 * add-on reads those fields IN REGION, which is what keeps this off a
 * non-regional model and inside DATA_RESIDENCY_MODE.
 */
describe('mapIdDocumentFields — sex, MRZ and national ID number (#34)', () => {
  it('maps Sex and the machine-readable zone', () => {
    const out = mapIdDocumentFields({
      Sex: { valueString: 'M' },
      MachineReadableZone: {
        type: 'object',
        content:
          'P<PAKAHMAD<<MUZAFFAR<<<<<<<<<<<<<<<<<<<<<<<<<\nAB12345670PAK6106155M3001019<<<<<<<<<<<<<<02',
      },
    });
    expect(out.sex).toBe('M');
    expect(out.mrz).toMatch(/^P<PAK/);
  });

  it('files an ID card number as national_id_number, never passport_number', () => {
    const out = mapIdDocumentFields(
      { DocumentNumber: { valueString: '35202-1234567-1' } },
      { azureDocType: 'idDocument.nationalIdentityCard' },
    );
    expect(out).toEqual({ national_id_number: '35202-1234567-1' });
  });

  it('falls back to the requested document type when Azure gives no docType', () => {
    expect(
      mapIdDocumentFields(
        { DocumentNumber: { valueString: '35202-1234567-1' } },
        { documentType: 'national_id' },
      ),
    ).toEqual({ national_id_number: '35202-1234567-1' });
    expect(
      mapIdDocumentFields(
        { DocumentNumber: { valueString: 'AB1234567' } },
        { azureDocType: 'idDocument.passport', documentType: 'national_id' },
      ),
    ).toEqual({ passport_number: 'AB1234567' });
  });
});

describe('resolveRoute', () => {
  it('sends identity documents to the dedicated (cheaper) ID model', () => {
    const route = resolveRoute(undefined, 'passport');
    expect(route.model).toBe('prebuilt-idDocument');
    expect(route.queryFields).toEqual([]);
  });

  it('sends national ID cards (CNIC) to the ID model too', () => {
    for (const t of ['national_id', 'cnic', 'id_card']) {
      expect(resolveRoute(undefined, t).model).toBe('prebuilt-idDocument');
    }
  });

  it('sends everything else to layout + query fields', () => {
    const route = resolveRoute(undefined, 'admission_letter');
    expect(route.model).toBe('prebuilt-layout');
    expect(route.queryFields).toEqual(
      expect.arrayContaining([
        'InstitutionName',
        'ProgramStartDate',
        'TuitionAmount',
      ]),
    );
  });

  it('never exceeds the 20-field cap Azure documents', () => {
    for (const type of KNOWN_EXTRACTION_TYPES) {
      expect(
        resolveRoute(undefined, type).queryFields.length,
      ).toBeLessThanOrEqual(AZURE_QUERY_FIELD_LIMIT);
    }
  });

  it('honours an explicit model pin and adds NO billable query fields', () => {
    const route = resolveRoute('prebuilt-read', 'admission_letter');
    expect(route.model).toBe('prebuilt-read');
    expect(route.queryFields).toEqual([]);
  });
});

describe('query-field request shape', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('puts features and queryFields on the query string, per the REST contract', async () => {
    const f = mockFetch([succeeded({})]);
    global.fetch = f;

    await provider().extract({ ...INPUT, documentType: 'bank_statement' });

    const url = analyzeCall(f)[0];
    expect(url).toContain('prebuilt-layout:analyze');
    expect(url).toContain('api-version=2024-11-30');
    expect(url).toContain('features=queryFields');
    expect(decodeURIComponent(url)).toContain('queryFields=AccountHolderName');
    // The body carries the bytes, never a URL Azure would have to reach.
    const init = analyzeCall(f)[1];
    expect(JSON.parse(init.body as string)).toEqual({
      base64Source: Buffer.from('PDFBYTES').toString('base64'),
    });
  });

  it('maps a query-field response back onto our snake_case keys', async () => {
    global.fetch = mockFetch([
      succeeded({
        BankName: { valueString: 'Banque Nationale' },
        AccountBalance: { valueNumber: 18450 },
        StatementPeriodEnd: { valueDate: '2026-07-31' },
      }),
    ]);

    const out = await provider().extract({
      ...INPUT,
      documentType: 'bank_statement',
    });

    expect(out.fields).toMatchObject({
      bank_name: 'Banque Nationale',
      account_balance: 18450,
      statement_period_end: '2026-07-31',
    });
  });
});

describe('mapQueryFields', () => {
  const spec = azureQueryFieldsFor('bank_statement');

  it('ignores response keys we never asked for', () => {
    expect(
      mapQueryFields(
        {
          BankName: { valueString: 'RBC' },
          ApprovalOdds: { valueString: '95%' },
        },
        spec.byName,
      ),
    ).toEqual({ bank_name: 'RBC' });
  });

  it('parses a formatted amount into a number', () => {
    expect(
      mapQueryFields(
        { AccountBalance: { valueString: 'CAD 18,450.00' } },
        spec.byName,
      ).account_balance,
    ).toBe(18450);
  });

  it('drops an unparseable amount rather than storing a wrong balance', () => {
    // A wrong balance on a visa application is worse than a blank field.
    expect(
      mapQueryFields(
        { AccountBalance: { valueString: 'see attached' } },
        spec.byName,
      ),
    ).toEqual({});
    expect(
      mapQueryFields(
        { AccountBalance: { valueString: '1.234.567' } },
        spec.byName,
      ),
    ).toEqual({});
  });

  it('treats blank values as absent', () => {
    expect(
      mapQueryFields({ BankName: { valueString: '  ' } }, spec.byName),
    ).toEqual({});
  });

  it('returns an empty object when Azure found nothing', () => {
    expect(mapQueryFields({}, spec.byName)).toEqual({});
  });
});

/**
 * MEASURED IN PRODUCTION 2026-08-16: every analyze request came back
 * `HTTP 403 Forbidden` and not one document had ever reached ocr_status
 * 'complete'. Cause: the signed URL is built from SUPABASE_URL, which is
 * http://127.0.0.1:54421 on the self-hosted stack, and Azure refuses to fetch a
 * loopback/private address. fetch_document's own HEAD check passed because the
 * API *can* reach its own loopback, so nothing upstream noticed.
 *
 * The adapter now uploads the bytes. These tests pin that: no storage URL may
 * appear in what we send Azure, ever.
 */
describe('document is uploaded, never linked (prod 403 regression)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('never puts the signed URL in the analyze request', async () => {
    const f = mockFetch([succeeded({})]);
    global.fetch = f;

    await provider().extract({ ...INPUT, documentType: 'bank_statement' });

    const [url, init] = analyzeCall(f);
    expect(url).not.toContain('storage.example');
    expect(init.body as string).not.toContain('storage.example');
    expect(init.body as string).not.toContain('urlSource');
    expect(init.body as string).not.toContain('127.0.0.1');
  });

  it('reads the document from storage BEFORE calling Azure', async () => {
    const f = mockFetch([succeeded({})]);
    global.fetch = f;

    await provider().extract(PASSPORT_INPUT);

    expect(String(f.mock.calls[0][0])).toContain('storage.example');
  });

  it('fails with a clear message when the document cannot be read', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as unknown as Response),
    );

    await expect(provider().extract(PASSPORT_INPUT)).rejects.toThrow(
      /could not read the document from storage \(HTTP 404\)/,
    );
  });

  it('rejects an empty object rather than sending Azure nothing', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      } as unknown as Response),
    );

    await expect(provider().extract(PASSPORT_INPUT)).rejects.toThrow(
      /empty document/,
    );
  });
});

/**
 * Date handling. MEASURED 2026-08-16 against a synthetic bank statement: Azure
 * returned "02 April 1998" for a date of birth and "to 31 July 2026" for a
 * period end (the label bled into the value). Neither is a date a government
 * form accepts; the prefill contract is YYYY-MM-DD.
 */
describe('normalizeDate', () => {
  it('passes ISO through unchanged', () => {
    expect(normalizeDate('2026-07-31')).toBe('2026-07-31');
  });

  it('normalizes spelled-out months in either order', () => {
    expect(normalizeDate('31 July 2026')).toBe('2026-07-31');
    expect(normalizeDate('02 April 1998')).toBe('1998-04-02');
    expect(normalizeDate('Jul 31 2026')).toBe('2026-07-31');
    expect(normalizeDate('July 31, 2026')).toBe('2026-07-31');
  });

  it('normalizes year-first numeric dates', () => {
    expect(normalizeDate('2026/07/31')).toBe('2026-07-31');
  });

  it('normalizes the civil-record prints from the 2026-10-15 dry run', () => {
    expect(normalizeDate('14-October-1989')).toBe('1989-10-14');
    expect(normalizeDate('SEPTEMBER 02,1995')).toBe('1995-09-02');
    expect(normalizeDate('NOV. 22,1995')).toBe('1995-11-22');
    // Unambiguous day-first numeric: 16 cannot be a month.
    expect(normalizeDate('16-9-1988')).toBe('1988-09-16');
    expect(normalizeDate('14/10/1989')).toBe('1989-10-14');
  });

  it('does NOT guess an ambiguous numeric date', () => {
    // 3 April or 4 March depending on who printed it. Guessing would put the
    // wrong date on an immigration filing, so the raw text is kept for review.
    expect(normalizeDate('03/04/2026')).toBe('03/04/2026');
  });

  it('keeps a polluted value rather than inventing a date', () => {
    expect(normalizeDate('to 31 July 2026')).toBe('to 31 July 2026');
  });

  it('returns undefined for empty input', () => {
    expect(normalizeDate('')).toBeUndefined();
    expect(normalizeDate(undefined)).toBeUndefined();
  });

  it('rejects an impossible month or day', () => {
    expect(normalizeDate('2026/13/01')).toBeUndefined();
    expect(normalizeDate('2026/01/45')).toBeUndefined();
  });

  // Audit 2026-10-18: other calendars were read as Gregorian.
  it('rejects a Persian (Solar Hijri) date instead of reading it as 1400 AD', () => {
    expect(normalizeDate('1400/03/25')).toBeUndefined();
  });

  it('rejects a Thai Buddhist year', () => {
    expect(normalizeDate('2504-05-14')).toBeUndefined();
    expect(normalizeDate('14 May 2504')).toBeUndefined();
  });

  it('accepts an expiry up to fifteen years ahead, not further', () => {
    const y = new Date().getUTCFullYear();
    expect(normalizeDate(`${y + 10}-01-09`)).toBe(`${y + 10}-01-09`);
    expect(normalizeDate(`${y + 16}-01-09`)).toBeUndefined();
    expect(normalizeDate('1899-12-31')).toBeUndefined();
    expect(normalizeDate('1900-01-01')).toBe('1900-01-01');
  });

  it('takes the date part of an ISO timestamp with an offset', () => {
    expect(normalizeDate('1990-05-14T00:00:00+05:00')).toBe('1990-05-14');
    expect(normalizeDate('1990-05-14T00:00:00Z')).toBe('1990-05-14');
    expect(normalizeDate('1990-05-14T00:00:00.000-0800')).toBe('1990-05-14');
  });

  it('still leaves an ambiguous day / month order unguessed', () => {
    expect(normalizeDate('05/06/1990')).toBe('05/06/1990');
  });
});

describe('mapIdDocumentFields — place of birth (audit 2026-10-18)', () => {
  it('maps PlaceOfBirth', () => {
    expect(
      mapIdDocumentFields({ PlaceOfBirth: { valueString: 'HONG KONG' } }),
    ).toEqual({ place_of_birth: 'HONG KONG' });
  });
});

describe('a bank statement is never asked what it cannot know', () => {
  it('does not request nationality, issue or expiry from financial documents', () => {
    // MEASURED: asked for `nationality`, Azure answered "CANADA" — inferred
    // from the bank's NAME, printed nowhere as the holder's nationality.
    const asked = resolveRoute(undefined, 'bank_statement').queryFields;
    expect(asked).not.toContain('Nationality');
    expect(asked).not.toContain('IssueDate');
    expect(asked).not.toContain('ExpiryDate');
  });

  it('still asks a passport for them — a passport prints all three', () => {
    const fields = extractionFieldsFor('passport').map((f) => f.key);
    expect(fields).toEqual(
      expect.arrayContaining(['nationality', 'issue_date', 'expiry_date']),
    );
  });

  it('keeps expiry_date on every type whose expiry policy requires it', () => {
    // resolveExpiryPolicy marks these requiresExpiry — without the field in
    // the schema they could never satisfy it.
    for (const type of [
      'passport',
      'police_clearance',
      'medical_exam',
      'medical_insurance',
    ]) {
      expect(extractionFieldsFor(type).map((f) => f.key)).toContain(
        'expiry_date',
      );
    }
  });

  it('asks an unknown document only what any document about a person carries', () => {
    expect(extractionFieldsFor('document').map((f) => f.key)).toEqual([
      'full_name',
      'date_of_birth',
    ]);
  });
});

/**
 * Dry run 2026-10-14 (prod): 6 of 10 uploads ~6s apart failed with
 * `azure-di analyze request failed (HTTP 429 Too Many Requests)`.
 */
describe('throttling (HTTP 429 / 503)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  type Reply = {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
  };

  /** Scripted fetch: storage read always OK; POSTs and polls from queues. */
  function scripted(posts: Reply[], polls: Reply[]) {
    const f = jest.fn((url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith('https://storage.example')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map() as unknown as Headers,
          arrayBuffer: () =>
            Promise.resolve(new TextEncoder().encode('PDFBYTES').buffer),
        } as unknown as Response);
      }
      const r =
        init?.method === 'POST'
          ? (posts.shift() ?? { status: 500 })
          : (polls.shift() ?? { status: 500 });
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        statusText: r.status === 429 ? 'Too Many Requests' : 'X',
        headers: new Map(Object.entries(r.headers ?? {})) as unknown as Headers,
        json: () => Promise.resolve(r.body ?? {}),
      } as unknown as Response);
    });
    return f;
  }

  function throttledProvider(sleep: jest.Mock) {
    return new AzureDocumentIntelligenceProvider({
      endpoint: ENDPOINT,
      apiKey: 'test-key',
      region: 'ca-central-1',
      sleep,
      random: () => 0,
    });
  }

  const accepted: Reply = {
    status: 202,
    headers: { 'operation-location': OP_URL },
  };
  const done: Reply = {
    status: 200,
    body: succeeded({ FirstName: { valueString: 'Ada' } }),
  };

  it('retries an analyze POST that got 429, waiting the Retry-After', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    global.fetch = scripted(
      [{ status: 429, headers: { 'retry-after': '4' } }, accepted],
      [done],
    );

    const out = await throttledProvider(sleep).extract(PASSPORT_INPUT);

    expect(out.fields.full_name).toBe('Ada');
    expect(sleep).toHaveBeenCalledWith(4000);
  });

  it('retries a 503 on the analyze POST', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    global.fetch = scripted([{ status: 503 }, accepted], [done]);

    await expect(
      throttledProvider(sleep).extract(PASSPORT_INPUT),
    ).resolves.toBeDefined();
  });

  it('keeps polling through a throttled poll instead of failing the document', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    const f = scripted(
      [accepted],
      [{ status: 429, headers: { 'retry-after-ms': '2500' } }, done],
    );
    global.fetch = f;

    await throttledProvider(sleep).extract(PASSPORT_INPUT);

    // Exactly one POST — a poll 429 must not restart the analysis (and bill it).
    expect(
      f.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST'),
    ).toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(2500);
  });

  it('honours Retry-After on a running operation as the poll interval', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    global.fetch = scripted(
      [accepted],
      [
        {
          status: 200,
          headers: { 'retry-after': '3' },
          body: { status: 'running' },
        },
        done,
      ],
    );

    await throttledProvider(sleep).extract(PASSPORT_INPUT);

    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('fails fast (one POST) on a non-retryable 400', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    const f = scripted([{ status: 400 }, accepted], [done]);
    global.fetch = f;

    const err = await throttledProvider(sleep)
      .extract(PASSPORT_INPUT)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OcrHttpError);
    expect(isRetryableError(err)).toBe(false);
    expect(
      f.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST'),
    ).toHaveLength(1);
  });

  it('treats an operation that failed on the document as non-retryable', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    global.fetch = scripted(
      [accepted, accepted],
      [
        {
          status: 200,
          body: { status: 'failed', error: { code: 'InvalidImage' } },
        },
        done,
      ],
    );

    const err = await throttledProvider(sleep)
      .extract(PASSPORT_INPUT)
      .catch((e: unknown) => e);
    expect(isRetryableError(err)).toBe(false);
  });

  it('a 429 that never clears surfaces as a retryable error for the job queue', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    global.fetch = scripted(
      [{ status: 429 }, { status: 429 }, { status: 429 }],
      [],
    );

    const err = await throttledProvider(sleep)
      .extract(PASSPORT_INPUT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrHttpError);
    expect(isRetryableError(err)).toBe(true);
    expect(String(err)).toMatch(/HTTP 429/);
  });
});
