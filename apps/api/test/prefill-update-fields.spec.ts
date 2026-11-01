import { ConflictException } from '@nestjs/common';
import type { PrefilledFormPayload } from '@visaai/types';
import { PrefillService } from '../src/modules/prefill/prefill.service';
import {
  ROUTE_UNANSWERED_NOTE,
  UNANSWERED_NOTE,
} from '../src/modules/prefill/graphs/nodes/finalize-fields';

/**
 * Review finding (2026-10-15): the applicant's Forms save replaced the whole
 * field array from the client and trusted the client's `source`. A stale tab
 * saving 56 after the consultant corrected the value to 62 silently reverted
 * auto-fill — and kept the "edited by consultant" badge on the reverted value.
 */
function stored(): PrefilledFormPayload {
  return {
    visaType: 'trv',
    countryCode: 'CA',
    generatedAt: '2026-10-01',
    fields: [
      {
        key: 'duration_of_stay_days',
        label: 'Duration',
        value: '62',
        source: 'consultant',
      },
      {
        key: 'occupation',
        label: 'Occupation',
        value: 'Retired',
        source: 'profile',
      },
    ],
  } as PrefilledFormPayload;
}

function make(initial: PrefilledFormPayload = stored()) {
  let raw = JSON.stringify(initial);
  const writes: string[] = [];
  const from = (table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) c[m] = () => c;
    c.single = () => Promise.resolve({ data: { id: 'app-1' }, error: null });
    c.limit = () => Promise.resolve({ data: [], error: null });
    c.maybeSingle = () =>
      Promise.resolve({
        data:
          table === 'generated_documents'
            ? { id: 'gd-1', content_md: raw, approved_by_user: false }
            : null,
        error: null,
      });
    c.update = (patch: { content_md: string }) => {
      const u: Record<string, unknown> = {};
      u.eq = () => {
        raw = patch.content_md;
        writes.push(raw);
        return Promise.resolve({ error: null });
      };
      return u;
    };
    return c;
  };
  const db = { from } as never;
  const listener = {
    onApplicantFormSaved: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new PrefillService(
    {} as never,
    { get: () => 'k' } as never,
    {} as never,
    listener as never,
  );
  return {
    svc,
    db,
    writes,
    listener,
    current: () => JSON.parse(raw) as PrefilledFormPayload,
  };
}

const fieldsFrom = (p: PrefilledFormPayload) => p.fields.map((f) => ({ ...f }));

describe('PrefillService.updateFields — concurrency + source', () => {
  it('get() hands out a version token for the form it returns', async () => {
    const { svc, db } = make();
    const out = await svc.get(db, 'app-1', 'u1');
    expect(out.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses (409) a save based on an older version — the consultant edited it', async () => {
    const { svc, db, writes } = make();
    const stale = stored();
    stale.fields[0].value = '56';
    await expect(
      svc.updateFields(
        db,
        'app-1',
        'u1',
        fieldsFrom(stale),
        'not-the-current-version',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes).toHaveLength(0);
  });

  it('without a version token, refuses to overwrite a consultant correction', async () => {
    const { svc, db, writes } = make();
    const stale = stored();
    stale.fields[0].value = '56';
    await expect(
      svc.updateFields(db, 'app-1', 'u1', fieldsFrom(stale)),
    ).rejects.toThrow(/consultant/i);
    expect(writes).toHaveLength(0);
  });

  it('a deliberate change on the current version is saved with source applicant', async () => {
    const { svc, db } = make();
    const { version } = await svc.get(db, 'app-1', 'u1');
    const next = stored();
    next.fields[0].value = '70';
    const out = await svc.updateFields(
      db,
      'app-1',
      'u1',
      fieldsFrom(next),
      version!,
    );
    expect(out.payload.fields[0]).toMatchObject({
      value: '70',
      source: 'applicant',
    });
    expect(out.version).not.toBe(version);
  });

  it('never trusts a client-sent source: unchanged keeps the stored source, a forged one is ignored', async () => {
    const { svc, db } = make();
    const { version } = await svc.get(db, 'app-1', 'u1');
    const forged = stored();
    forged.fields[0].source = 'profile'; // value unchanged → stored 'consultant' kept
    forged.fields[1] = {
      ...forged.fields[1],
      value: 'Teacher',
      source: 'consultant',
    };
    const out = await svc.updateFields(
      db,
      'app-1',
      'u1',
      fieldsFrom(forged),
      version!,
    );
    expect(out.payload.fields[0].source).toBe('consultant');
    expect(out.payload.fields[1]).toMatchObject({
      value: 'Teacher',
      source: 'applicant',
    });
  });

  it('tells the preflight review which keys the applicant changed', async () => {
    const { svc, db, listener } = make();
    const { version } = await svc.get(db, 'app-1', 'u1');
    const next = stored();
    next.fields[1].value = 'Teacher';
    await svc.updateFields(db, 'app-1', 'u1', fieldsFrom(next), version!);
    expect(listener.onApplicantFormSaved).toHaveBeenCalledWith('app-1', [
      'occupation',
    ]);
  });

  it('an unanswered IRCC question stays unanswered until typed, then is the applicant’s', async () => {
    const withQuestions = stored();
    withQuestions.fields.push(
      {
        key: 'father_occupation',
        label: "What is your father's current occupation?",
        value: '',
        group: 'Family',
        needsReview: true,
        note: UNANSWERED_NOTE,
      },
      {
        key: 'travel_by_air',
        label: 'Are you travelling to Canada by air? (Yes/No)',
        value: '',
        group: 'Travel',
        needsReview: true,
        note: UNANSWERED_NOTE,
      },
    );
    const { svc, db } = make(withQuestions);
    const { version } = await svc.get(db, 'app-1', 'u1');
    const next = fieldsFrom(withQuestions);
    next[2].value = 'Retired';
    const out = await svc.updateFields(db, 'app-1', 'u1', next, version!);
    const [, , father, air] = out.payload.fields;
    expect(father).toEqual({
      key: 'father_occupation',
      label: "What is your father's current occupation?",
      value: 'Retired',
      group: 'Family',
      source: 'applicant',
    });
    // Still empty: kept, still flagged, and still nobody's answer.
    expect(air).toMatchObject({
      value: '',
      needsReview: true,
      note: UNANSWERED_NOTE,
    });
    expect(air.source).toBeUndefined();
  });

  it('a spousal question added unanswered stops asking once typed', async () => {
    const withQuestion = stored();
    withQuestion.fields.push({
      key: 'first_met_date',
      label: 'Date you first met in person',
      value: '',
      group: 'Relationship',
      source: 'inferred',
      note: ROUTE_UNANSWERED_NOTE,
    });
    const { svc, db } = make(withQuestion);
    const { version } = await svc.get(db, 'app-1', 'u1');
    const next = fieldsFrom(withQuestion);
    next[2].value = '2022-09-10';
    const out = await svc.updateFields(db, 'app-1', 'u1', next, version!);
    expect(out.payload.fields[2].note).toBeUndefined();
    expect(out.payload.fields[2].source).toBe('applicant');
  });
});

describe('changedFormKeys', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { changedFormKeys } = require('../src/modules/prefill/prefill.service');
  it('lists keys whose value changed, appeared or disappeared', () => {
    const a = [
      { key: 'a', label: '', value: '1' },
      { key: 'b', label: '', value: '2' },
      { key: 'c', label: '', value: '3' },
    ];
    const b = [
      { key: 'a', label: '', value: '1' },
      { key: 'b', label: '', value: '9' },
      { key: 'd', label: '', value: '4' },
    ];
    expect(changedFormKeys(a, b).sort()).toEqual(['b', 'c', 'd']);
    expect(changedFormKeys(null, b).sort()).toEqual(['a', 'b', 'd']);
  });
});
