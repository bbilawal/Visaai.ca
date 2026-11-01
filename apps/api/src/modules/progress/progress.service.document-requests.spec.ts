/* eslint-disable @typescript-eslint/no-explicit-any */
import { ProgressService } from './progress.service';
import { PrefillService } from '../prefill/prefill.service';
import { safeLog } from '../shared/log/redact';

/**
 * A slot whose document the consultant sent back (needs_reupload / rejected,
 * no replacement) is not "done" on the server either — the same rule as the
 * vault, so the Documents stage and the auto-generated prefill agree with it.
 */
function q(data: unknown, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  const b: any = {
    select: () => b,
    eq: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => result,
    single: () => result,
    then: (f: any, r: any) => result.then(f, r),
  };
  return b;
}

const CHECKLIST = [
  { id: 'pp', status: 'verified', required: true, meta: null },
  { id: 'bank', status: 'verified', required: true, meta: null },
];
const DOCS = [
  { id: 'd-pp', checklist_item_id: 'pp', created_at: '2026-10-01T09:00:00Z' },
  { id: 'd-bank', checklist_item_id: 'bank', created_at: '2026-10-01T09:00:00Z' },
];
const REQUEST = {
  item_kind: 'document',
  item_id: 'd-pp',
  decision: 'needs_reupload',
  note: 'cut off',
  created_at: '2026-10-02T10:00:00Z',
};

function db(reviews: unknown[] | 'error') {
  return {
    from(table: string) {
      switch (table) {
        case 'applications':
          return q({
            id: 'app-1',
            status: 'draft',
            visa_type_id: 'vt-1',
            destination_country: 'CA',
            visa_types: { visaai_id: 'ca-visitor-visa-temporary-resident-visa' },
          });
        case 'checklist_items':
          return q(CHECKLIST);
        case 'documents':
          return q(DOCS);
        case 'application_item_reviews':
          return reviews === 'error'
            ? q(null, { message: 'denied' })
            : q(reviews);
        default:
          return q(null);
      }
    },
  } as any;
}

const docsStage = async (reviews: unknown[] | 'error') =>
  (await new ProgressService().forApplication(db(reviews), 'app-1', 'u'))!
    .stages.find((s) => s.slug === 'documents')!;

describe('ProgressService — open consultant document requests', () => {
  it('both slots verified: the Documents stage is complete', async () => {
    expect((await docsStage([])).state).toBe('complete');
  });

  it('an open re-upload request un-completes the Documents stage', async () => {
    expect((await docsStage([REQUEST])).state).not.toBe('complete');
  });

  it('an unreadable review table counts the stored statuses', async () => {
    expect((await docsStage('error')).state).toBe('complete');
  });
});

describe('PrefillService.autoGenerateIfReady — open consultant document requests', () => {
  function prefill(reviews: unknown[] | 'error') {
    const svc = new PrefillService(
      { admin: db(reviews) } as never,
      { get: () => 'k' } as never,
      {} as never,
      {} as never,
    );
    // Stop before the model call: "ready" means it got past the completion check.
    const loadRecord = jest
      .spyOn(svc as any, 'loadRecord')
      .mockResolvedValue({ existing: true });
    return { svc, loadRecord };
  }

  it('proceeds when every required slot is verified', async () => {
    const { svc, loadRecord } = prefill([]);
    await expect(svc.autoGenerateIfReady('app-1')).resolves.toBe(false);
    expect(loadRecord).toHaveBeenCalled();
  });

  it('does not generate while a slot has an open request', async () => {
    const { svc, loadRecord } = prefill([REQUEST]);
    await expect(svc.autoGenerateIfReady('app-1')).resolves.toBe(false);
    expect(loadRecord).not.toHaveBeenCalled();
  });

  it('does not generate when the reviews cannot be read, and says so in the log', async () => {
    const warn = jest.spyOn(safeLog, 'warn').mockImplementation(() => {});
    const { svc, loadRecord } = prefill('error');
    await expect(svc.autoGenerateIfReady('app-1')).resolves.toBe(false);
    expect(loadRecord).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'prefill.auto',
      expect.stringContaining('open document requests unreadable'),
    );
    warn.mockRestore();
  });
});
