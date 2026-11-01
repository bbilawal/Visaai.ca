import {
  classifyChange,
  TemplateRevisionStore,
} from './template-revision.store';
import type { SupabaseService } from '../shared/supabase/supabase.service';

describe('classifyChange', () => {
  it('calls the first ever cache first_cache', () => {
    expect(classifyChange(null, null, '01-05-2026')).toBe('first_cache');
  });

  it('calls a new label with new bytes a revision', () => {
    expect(classifyChange('a'.repeat(64), '01-01-2023', '01-05-2026')).toBe(
      'revision',
    );
  });

  // The case the checksum exists for: the label a human reads says nothing
  // changed, but the bytes did — so any field mapping built against the old
  // revision keeps filling boxes that may have moved.
  it('calls same-label different-bytes a silent_reissue', () => {
    expect(classifyChange('a'.repeat(64), '01-05-2026', '01-05-2026')).toBe(
      'silent_reissue',
    );
    expect(classifyChange('a'.repeat(64), null, null)).toBe('silent_reissue');
  });
});

function fakeSupabase(onInsert: (row: Record<string, unknown>) => unknown) {
  return {
    admin: {
      from: () => ({
        insert: (row: Record<string, unknown>) =>
          Promise.resolve(onInsert(row) ?? { error: null }),
      }),
    },
  } as unknown as SupabaseService;
}

const INPUT = {
  source: 'form' as const,
  countryCode: 'CA',
  program: 'visitor_visa',
  code: 'IMM 5257',
  name: 'Application for Temporary Resident Visa',
  previousSha256: 'a'.repeat(64),
  newSha256: 'b'.repeat(64),
  previousVersionLabel: '01-01-2023',
  newVersionLabel: '01-05-2026',
};

describe('TemplateRevisionStore.record', () => {
  it('writes the classified change', async () => {
    const rows: Record<string, unknown>[] = [];
    const store = new TemplateRevisionStore(
      fakeSupabase((row) => {
        rows.push(row);
        return { error: null };
      }),
    );

    await store.record({ ...INPUT, newFieldCount: 42, previousFieldCount: 40 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'form',
      code: 'IMM 5257',
      change_kind: 'revision',
      previous_sha256: 'a'.repeat(64),
      new_sha256: 'b'.repeat(64),
      previous_field_count: 40,
      new_field_count: 42,
    });
  });

  // The contract the refresh services depend on. A run that successfully cached
  // a new government form must not be reported as failed because an audit
  // insert hit a constraint — that would turn a working cache into a `stale`
  // row and cost applicants the very document we just fetched.
  it('never throws when the insert fails', async () => {
    const store = new TemplateRevisionStore(
      fakeSupabase(() => ({ error: { message: 'constraint violation' } })),
    );
    await expect(store.record(INPUT)).resolves.toBeUndefined();
  });

  it('never throws when the client itself explodes', async () => {
    const store = new TemplateRevisionStore({
      admin: {
        from: () => {
          throw new Error('connection refused');
        },
      },
    } as unknown as SupabaseService);
    await expect(store.record(INPUT)).resolves.toBeUndefined();
  });
});
