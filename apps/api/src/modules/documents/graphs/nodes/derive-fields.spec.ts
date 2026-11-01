import {
  makeDeriveFieldsNode,
  deriveFieldsEnabled,
  __testing,
} from './derive-fields';
import type { DocumentState } from '../document.state';

const { parseFields } = __testing;

function state(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    documentId: 'doc-1',
    applicationId: 'app-1',
    storagePath: 'u/a/f.png',
    mimeType: 'image/png',
    documentType: 'admission_letter',
    signedUrl: 'https://example.test/f.png',
    rawOcrText: 'Letter of Acceptance — University of Toronto',
    extractedFields: {},
    verificationResult: 'pass',
    verificationDetails: [],
    allDocsProcessed: false,
    error: null,
    ...overrides,
  } as unknown as DocumentState;
}

describe('parseFields', () => {
  const allowed = new Set([
    'institution_name',
    'tuition_amount',
    'program_start_date',
  ]);

  it('keeps allowed string and numeric values', () => {
    expect(
      parseFields(
        '{"institution_name":"University of Toronto","tuition_amount":42000}',
        allowed,
      ),
    ).toEqual({
      institution_name: 'University of Toronto',
      tuition_amount: 42000,
    });
  });

  it('drops keys outside the schema — an invented key would reach a government form', () => {
    expect(
      parseFields(
        '{"institution_name":"UofT","approval_probability":"95%"}',
        allowed,
      ),
    ).toEqual({ institution_name: 'UofT' });
  });

  it('drops the placeholders a model returns instead of omitting a key', () => {
    expect(
      parseFields(
        '{"institution_name":"N/A","tuition_amount":"unknown","program_start_date":"  "}',
        allowed,
      ),
    ).toEqual({});
  });

  it('tolerates prose or fences around the JSON', () => {
    expect(
      parseFields(
        'Here you go:\n```json\n{"institution_name":"UofT"}\n```',
        allowed,
      ),
    ).toEqual({ institution_name: 'UofT' });
  });

  it('returns nothing for unparseable or non-object output', () => {
    expect(parseFields('not json at all', allowed)).toEqual({});
    expect(parseFields('[1,2,3]', allowed)).toEqual({});
    expect(parseFields('{"institution_name":', allowed)).toEqual({});
  });

  it('drops non-finite numbers', () => {
    expect(parseFields('{"tuition_amount":null}', allowed)).toEqual({});
  });
});

/**
 * The residency gate. This pass ships OCR text (names, passport numbers,
 * balances) to OpenAI in the US. `run_ocr` already refuses a non-regional OCR
 * PROVIDER under any residency mode that pins data, so this must not become the
 * way around that guard: it FAILS CLOSED, and only an explicit operator opt-in
 * turns it on.
 */
describe('deriveFieldsEnabled', () => {
  it('is off by default under every residency mode that pins data', () => {
    expect(deriveFieldsEnabled('regional')).toBe(false);
    expect(deriveFieldsEnabled('jurisdiction-specific')).toBe(false);
    expect(deriveFieldsEnabled('regional', 'auto')).toBe(false);
  });

  it('is on by default only under global residency', () => {
    expect(deriveFieldsEnabled('global')).toBe(true);
  });

  it('honours an explicit operator opt-in', () => {
    expect(deriveFieldsEnabled('regional', 'on')).toBe(true);
  });

  it('honours an explicit opt-out even under global', () => {
    expect(deriveFieldsEnabled('global', 'off')).toBe(false);
  });
});

describe('makeDeriveFieldsNode', () => {
  it('never calls out under a pinning residency mode, even with a key', async () => {
    const node = makeDeriveFieldsNode({
      openaiKey: 'sk-test',
      residencyMode: 'regional',
    });
    // Fully populated state that WOULD otherwise trigger a call.
    await expect(node(state())).resolves.toEqual({});
  });

  it('is a no-op without an API key — the pipeline runs on provider fields alone', async () => {
    const node = makeDeriveFieldsNode({ residencyMode: 'global' });
    await expect(node(state())).resolves.toEqual({});
  });

  it('is a no-op when OCR already failed', async () => {
    const node = makeDeriveFieldsNode({
      openaiKey: 'sk-test',
      residencyMode: 'global',
    });
    await expect(
      node(state({ error: 'OCR failed: unsupported type' })),
    ).resolves.toEqual({});
  });

  it('is a no-op when there is no text to read', async () => {
    const node = makeDeriveFieldsNode({
      openaiKey: 'sk-test',
      residencyMode: 'global',
    });
    await expect(node(state({ rawOcrText: '   ' }))).resolves.toEqual({});
  });

  it('skips the model call when the provider already returned every key', async () => {
    const node = makeDeriveFieldsNode({
      openaiKey: 'sk-test',
      residencyMode: 'global',
    });
    // Every field of the `document` (unknown-type) schema is already present,
    // so there is nothing left to ask for and no call should be attempted.
    const complete = state({
      documentType: 'document',
      extractedFields: {
        full_name: 'Amira Haddad',
        date_of_birth: '1998-04-02',
        nationality: 'Tunisian',
        issue_date: '2021-01-05',
        expiry_date: '2031-01-04',
      },
    });
    await expect(node(complete)).resolves.toEqual({});
  });
});
