import { NarrativeService } from '../src/modules/narrative/narrative.service';

/**
 * Review finding (2026-10-15): the applicant's "approve with edits" wrote the
 * letter in place, so a consultant's rewrite (or the applicant's own earlier
 * text) was gone for good. Every content overwrite now snapshots the previous
 * text into generated_document_revisions first.
 */
function make(opts: { revisionError?: string } = {}) {
  let content = '**Consultant version**';
  const updates: unknown[] = [];
  const revisions: unknown[] = [];
  const db = {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) c[m] = () => c;
      c.single = () =>
        Promise.resolve(
          table === 'applications'
            ? { data: { id: 'app-1' }, error: null }
            : {
                data: {
                  id: 'g1',
                  application_id: 'app-1',
                  content_md: content,
                },
                error: null,
              },
        );
      c.update = (patch: { content_md?: string }) => ({
        eq: () => {
          updates.push(patch);
          if (patch.content_md !== undefined) content = patch.content_md;
          return Promise.resolve({ error: null });
        },
      });
      return c;
    },
  };
  const admin = {
    from: () => ({
      insert: (row: unknown) => {
        if (opts.revisionError)
          return Promise.resolve({ error: { message: opts.revisionError } });
        revisions.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  };
  const svc = new NarrativeService(
    { admin } as never,
    { get: () => 'k' } as never,
    {} as never,
  );
  return { svc, db: db as never, updates, revisions, content: () => content };
}

describe('NarrativeService.approve — revisions', () => {
  it('snapshots the previous text before an applicant edit overwrites it', async () => {
    const { svc, db, revisions, content } = make();
    await svc.approve(db, 'g1', 'u1', 'Applicant version');
    expect(revisions).toEqual([
      expect.objectContaining({
        generated_document_id: 'g1',
        application_id: 'app-1',
        content_md: '**Consultant version**',
        edited_by: 'u1',
        edited_role: 'applicant',
      }),
    ]);
    expect(content()).toBe('Applicant version');
  });

  it('a plain approval (no new text) records no revision', async () => {
    const { svc, db, revisions } = make();
    await svc.approve(db, 'g1', 'u1');
    expect(revisions).toHaveLength(0);
  });

  it('does not overwrite when the snapshot cannot be saved', async () => {
    const { svc, db, updates, content } = make({ revisionError: 'denied' });
    await expect(svc.approve(db, 'g1', 'u1', 'x')).rejects.toThrow(/revision/i);
    expect(updates).toHaveLength(0);
    expect(content()).toBe('**Consultant version**');
  });
});

/**
 * Dry run 2026-10-14 (#8): editing a letter could only end in "Save &
 * Approve", so fixing a typo stamped the whole letter approved. Saving an edit
 * now keeps it a draft (and un-approves an approved letter): approval is its
 * own explicit act.
 */
describe('NarrativeService.saveDraft — edit without approving', () => {
  it('stores the edit, keeps the old text, and leaves the letter unapproved', async () => {
    const { svc, db, updates, revisions, content } = make();
    const out = await svc.saveDraft(db, 'g1', 'u1', 'Applicant fix');
    expect(out).toEqual({ saved: true, approved: false });
    expect(content()).toBe('Applicant fix');
    expect(updates).toEqual([
      { content_md: 'Applicant fix', approved_by_user: false },
    ]);
    expect(revisions).toHaveLength(1);
  });

  it('rejects an empty letter', async () => {
    const { svc, db, updates } = make();
    await expect(svc.saveDraft(db, 'g1', 'u1', '   ')).rejects.toThrow(
      /empty/i,
    );
    expect(updates).toHaveLength(0);
  });
});

describe('NarrativeService.keepPreviousLetter — regeneration history', () => {
  it('writes the replaced text as an applicant revision', async () => {
    const { svc, revisions } = make();
    await svc.keepPreviousLetter(
      'app-1',
      'u1',
    )({ id: 'g1', content_md: 'old' });
    expect(revisions).toEqual([
      expect.objectContaining({
        generated_document_id: 'g1',
        application_id: 'app-1',
        content_md: 'old',
        edited_by: 'u1',
        edited_role: 'applicant',
        note: 'Replaced by a regenerated draft',
      }),
    ]);
  });

  it('throws (so nothing is replaced) when the revision cannot be written', async () => {
    const { svc } = make({ revisionError: 'denied' });
    await expect(
      svc.keepPreviousLetter('app-1', 'u1')({ id: 'g1', content_md: 'old' }),
    ).rejects.toThrow(/previous/i);
  });
});
