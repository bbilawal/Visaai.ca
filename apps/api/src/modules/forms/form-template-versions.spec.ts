/**
 * Version history for cached government forms (spec §9).
 *
 * `form_templates` has a UNIQUE index on (country_code, program, form_code), so
 * a new revision of a form overwrites its predecessor's row. The bytes survived
 * that — storage paths are version-scoped — but every pointer to them did not,
 * leaving the previous PDF as an orphan blob no query could find. §9 asks for
 * the opposite: store a new version, mark the prior one superseded, preserve
 * history.
 *
 * These tests cover the write path that keeps that promise, including the two
 * failure modes this repository has already paid for elsewhere: numbering a new
 * version from the ACTIVE one rather than the highest (B-23, which deadlocked
 * visa_source_versions permanently), and re-filing content that is already on
 * record (the duplicate-review-item half of the same bug).
 */
import { FormTemplateStore } from './form-template.store';
import type { SupabaseService } from '../shared/supabase/supabase.service';

interface VersionRow {
  id: string;
  form_template_id: string;
  version_number: number;
  sha256: string;
  storage_path: string;
  is_active: boolean;
  superseded_at?: string | null;
  version_label?: string | null;
}

/**
 * Two-table fake: form_templates and form_template_versions.
 *
 * It enforces the one-active-version-per-form rule the database enforces with a
 * partial unique index, because a fake that permits what the database refuses
 * would let a test pass on behaviour production would reject.
 */
function fakeDb(
  opts: {
    template?: Record<string, unknown> | null;
    versions?: VersionRow[];
    failVersionWrite?: boolean;
  } = {},
) {
  const template = opts.template ?? null;
  const versions: VersionRow[] = [...(opts.versions ?? [])];
  const inserted: Record<string, unknown>[] = [];
  const updated: { id: string; patch: Record<string, unknown> }[] = [];
  let upserted: Record<string, unknown> | null = null;

  const from = (table: string) => {
    if (table === 'form_templates') {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: template, error: null });
      chain.upsert = async (row: Record<string, unknown>) => {
        upserted = row;
        return { data: null, error: null };
      };
      return chain;
    }

    if (table === 'form_template_versions') {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (_col: string, _v: unknown) => chain;
      chain.order = async () => {
        if (opts.failVersionWrite) {
          return {
            data: null,
            error: { message: 'history table unavailable' },
          };
        }
        return {
          data: [...versions].sort(
            (a, b) => b.version_number - a.version_number,
          ),
          error: null,
        };
      };
      chain.insert = async (row: Record<string, unknown>) => {
        // The partial unique index permits exactly one active row per form.
        const clash = versions.some(
          (v) =>
            v.form_template_id === row.form_template_id &&
            v.is_active &&
            row.is_active,
        );
        if (clash) {
          return {
            error: {
              message:
                'duplicate key value violates form_template_versions_one_active_idx',
            },
          };
        }
        inserted.push(row);
        versions.push(row as unknown as VersionRow);
        return { error: null };
      };
      chain.update = (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          updated.push({ id, patch });
          const v = versions.find((x) => x.id === id);
          if (v) Object.assign(v, patch);
          return { error: null };
        },
      });
      return chain;
    }

    throw new Error(`unexpected table ${table}`);
  };

  const service = { admin: { from } } as unknown as SupabaseService;
  return {
    service,
    get inserted() {
      return inserted;
    },
    get updated() {
      return updated;
    },
    get upserted() {
      return upserted;
    },
  };
}

const ROW = {
  country_code: 'CA',
  program: 'visitor_visa',
  form_code: 'IMM 5257',
  landing_url: 'https://example.test/imm5257',
};

describe('form template version history', () => {
  it('files version 1 for the first cached copy of a form', async () => {
    const db = fakeDb({ template: { id: 'tpl-1', sha256: null } });

    await new FormTemplateStore(db.service).upsert({
      ...ROW,
      sha256: 'aaa',
      storage_path: 'CA/visitor_visa/imm-5257/current-aaa.pdf',
      status: 'ok',
    });

    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({
      form_template_id: 'tpl-1',
      version_number: 1,
      sha256: 'aaa',
      is_active: true,
    });
  });

  it('files a new version and retires the previous one when the bytes change', async () => {
    const db = fakeDb({
      template: { id: 'tpl-1', sha256: 'aaa' },
      versions: [
        {
          id: 'v1',
          form_template_id: 'tpl-1',
          version_number: 1,
          sha256: 'aaa',
          storage_path: 'old.pdf',
          is_active: true,
        },
      ],
    });

    await new FormTemplateStore(db.service).upsert({
      ...ROW,
      sha256: 'bbb',
      storage_path: 'CA/visitor_visa/imm-5257/2026-bbb.pdf',
      status: 'ok',
    });

    // Retire before insert: the database permits exactly one active row, so the
    // other order is refused outright.
    expect(db.updated).toHaveLength(1);
    expect(db.updated[0].id).toBe('v1');
    expect(db.updated[0].patch).toMatchObject({ is_active: false });
    expect(db.updated[0].patch.superseded_at).toEqual(expect.any(String));

    expect(db.inserted[0]).toMatchObject({
      version_number: 2,
      sha256: 'bbb',
      is_active: true,
    });
  });

  it('keeps the superseded revision reachable at its own storage path', async () => {
    // The whole point. A superseded row that lost its storage_path would be a
    // record that a version existed, not the version.
    const db = fakeDb({
      template: { id: 'tpl-1', sha256: 'aaa' },
      versions: [
        {
          id: 'v1',
          form_template_id: 'tpl-1',
          version_number: 1,
          sha256: 'aaa',
          storage_path: 'CA/visitor_visa/imm-5257/2024-aaa.pdf',
          is_active: true,
        },
      ],
    });

    await new FormTemplateStore(db.service).upsert({
      ...ROW,
      sha256: 'bbb',
      storage_path: 'CA/visitor_visa/imm-5257/2026-bbb.pdf',
      status: 'ok',
    });

    expect(db.updated[0].patch).not.toHaveProperty('storage_path');
  });

  it('does not re-file content it has already recorded', async () => {
    // B-23's second half: a re-queued version that files itself again every
    // night hands a reviewer thirty identical items.
    const db = fakeDb({
      template: { id: 'tpl-1', sha256: 'zzz' },
      versions: [
        {
          id: 'v1',
          form_template_id: 'tpl-1',
          version_number: 1,
          sha256: 'aaa',
          storage_path: 'a.pdf',
          is_active: false,
          superseded_at: 'x',
        },
        {
          id: 'v2',
          form_template_id: 'tpl-1',
          version_number: 2,
          sha256: 'bbb',
          storage_path: 'b.pdf',
          is_active: true,
        },
      ],
    });

    await new FormTemplateStore(db.service).upsert({
      ...ROW,
      sha256: 'aaa', // an OLD revision served again
      storage_path: 'a.pdf',
      status: 'ok',
    });

    expect(db.inserted).toHaveLength(0);
    expect(db.updated).toHaveLength(0);
  });

  it('numbers from the highest version, not the active one', async () => {
    // B-23 exactly: an inactive version ABOVE the active one is a normal state,
    // and numbering from the active one collides forever.
    const db = fakeDb({
      template: { id: 'tpl-1', sha256: 'aaa' },
      versions: [
        {
          id: 'v1',
          form_template_id: 'tpl-1',
          version_number: 1,
          sha256: 'aaa',
          storage_path: 'a.pdf',
          is_active: true,
        },
        {
          id: 'v2',
          form_template_id: 'tpl-1',
          version_number: 2,
          sha256: 'bbb',
          storage_path: 'b.pdf',
          is_active: false,
          superseded_at: 'x',
        },
      ],
    });

    await new FormTemplateStore(db.service).upsert({
      ...ROW,
      sha256: 'ccc',
      storage_path: 'c.pdf',
      status: 'ok',
    });

    expect(db.inserted[0]).toMatchObject({ version_number: 3 });
  });

  it('writes no version when there is no cached file to version', async () => {
    // Failure paths upsert a row carrying an error and no bytes. A history row
    // for a form that was never downloaded would assert a revision that does
    // not exist.
    const db = fakeDb({ template: { id: 'tpl-1', sha256: null } });

    await new FormTemplateStore(db.service).upsert({
      ...ROW,
      status: 'error',
      error_message: '404',
    });

    expect(db.inserted).toHaveLength(0);
  });

  it('does not fail the refresh when the history write fails', async () => {
    // The form and its bytes are already stored by this point. Losing a history
    // row is bad — and logged at error level — but failing an otherwise
    // successful refresh over it would be worse.
    const db = fakeDb({
      template: { id: 'tpl-1', sha256: 'aaa' },
      failVersionWrite: true,
    });

    await expect(
      new FormTemplateStore(db.service).upsert({
        ...ROW,
        sha256: 'bbb',
        storage_path: 'b.pdf',
        status: 'ok',
      }),
    ).resolves.toBeUndefined();

    expect(db.upserted).toMatchObject({ form_code: 'IMM 5257' });
    expect(db.inserted).toHaveLength(0);
  });
});
