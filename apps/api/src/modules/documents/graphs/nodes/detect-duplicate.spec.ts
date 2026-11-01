import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import {
  makeDetectDuplicateNode,
  contentHash,
  identityFingerprint,
  valueHash,
} from './detect-duplicate';

// Minimal chainable Supabase query-builder mock. Every builder method returns
// the builder; terminal methods resolve to a per-(table,call) queued result.
function qb(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of [
    'select',
    'insert',
    'update',
    'upsert',
    'eq',
    'neq',
    'is',
    'like',
    'order',
    'limit',
  ]) {
    builder[m] = jest.fn(() => builder);
  }
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.single = jest.fn(() => Promise.resolve(result));
  return builder;
}

function makeSupabase(
  routes: Record<string, { data: unknown; error: unknown }[]>,
) {
  const idx: Record<string, number> = {};
  const from = jest.fn((table: string) => {
    const arr = routes[table] ?? [];
    const i = idx[table] ?? 0;
    idx[table] = i + 1;
    return qb(arr[i] ?? { data: null, error: null });
  });
  return { from } as unknown as SupabaseClient;
}

function baseState(over: Partial<DocumentState> = {}): DocumentState {
  return {
    documentId: 'doc-self',
    applicationId: 'app-1',
    storagePath: 'p',
    mimeType: 'image/png',
    documentType: 'passport',
    signedUrl: '',
    rawOcrText: 'PASSPORT OF JANE DOE 123',
    extractedFields: {
      full_name: 'Jane Doe',
      date_of_birth: '1990-01-01',
      passport_number: 'X1234567',
    },
    verificationResult: 'pass',
    verificationDetails: [],
    allDocsProcessed: false,
    error: null,
    ...over,
  } as DocumentState;
}

describe('duplicate detection helpers', () => {
  it('contentHash is a stable sha256 of the text', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
    expect(contentHash('')).toBeUndefined();
  });

  it('identityFingerprint is stable and normalization-insensitive', () => {
    const a = identityFingerprint('passport', {
      full_name: ' Jane Doe ',
      date_of_birth: '1990-01-01',
      passport_number: 'X1234567',
    });
    const b = identityFingerprint('passport', {
      full_name: 'jane doe',
      date_of_birth: '1990-01-01',
      passport_number: 'x1234567',
    });
    expect(a).toBe(b);
  });

  it('identityFingerprint uses a national ID number as the identifier', () => {
    const a = identityFingerprint('national_id', {
      national_id_number: '35202-1234567-1',
    });
    const b = identityFingerprint('national_id', {
      national_id_number: '35202-7654321-3',
    });
    expect(a).toBeDefined();
    expect(a).not.toBe(b);
  });

  it('identityFingerprint returns undefined without enough identity signal', () => {
    expect(
      identityFingerprint('document', { employer: 'ACME' }),
    ).toBeUndefined();
  });

  it('valueHash matches the provenance normalization (trim + NFC)', () => {
    expect(valueHash(' X1 ')).toBe(valueHash('X1'));
  });
});

describe('detect_duplicate node', () => {
  it('flags an exact_dup on matching content hash', async () => {
    const supabase = makeSupabase({
      documents: [{ data: { id: 'doc-existing' }, error: null }],
    });
    const out = await makeDetectDuplicateNode(supabase)(baseState());
    expect(out.dupStatus).toBe('exact_dup');
    expect(out.duplicateOf).toBe('doc-existing');
    expect(out.contentHash).toBeDefined();
  });

  it('flags a likely_dup on matching identity fingerprint', async () => {
    const supabase = makeSupabase({
      // documents: [exact -> none, fp -> match]
      documents: [
        { data: null, error: null },
        { data: { id: 'doc-sibling' }, error: null },
      ],
      ocr_runs: [{ data: null, error: null }],
    });
    const out = await makeDetectDuplicateNode(supabase)(baseState());
    expect(out.dupStatus).toBe('likely_dup');
    expect(out.duplicateOf).toBe('doc-sibling');
  });

  it('flags likely_dup via passport value_hash in field_provenance', async () => {
    const supabase = makeSupabase({
      documents: [
        { data: null, error: null }, // exact
        { data: null, error: null }, // fp
      ],
      ocr_runs: [{ data: null, error: null }],
      field_provenance: [
        { data: { source_document_id: 'doc-prov' }, error: null },
      ],
    });
    const out = await makeDetectDuplicateNode(supabase)(baseState());
    expect(out.dupStatus).toBe('likely_dup');
    expect(out.duplicateOf).toBe('doc-prov');
  });

  it('returns unique when nothing matches', async () => {
    const supabase = makeSupabase({
      documents: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      ocr_runs: [{ data: null, error: null }],
      field_provenance: [{ data: null, error: null }],
    });
    const out = await makeDetectDuplicateNode(supabase)(baseState());
    expect(out.dupStatus).toBe('unique');
    expect(out.duplicateOf).toBeNull();
  });

  it('short-circuits on a pre-existing error', async () => {
    const supabase = makeSupabase({});
    const out = await makeDetectDuplicateNode(supabase)(
      baseState({ error: 'boom' }),
    );
    expect(out).toEqual({});
  });

  it('degrades to unique (never throws) when a lookup fails', async () => {
    const supabase = {
      from: () => {
        throw new Error('db down');
      },
    } as unknown as SupabaseClient;
    const out = await makeDetectDuplicateNode(supabase)(baseState());
    expect(out.dupStatus).toBe('unique');
    expect(out.contentHash).toBeDefined();
  });
});
