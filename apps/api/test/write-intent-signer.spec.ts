import type { ConfigService } from '@nestjs/config';
import type { WritePlan } from '@visaai/types';
import { WriteIntentSigner } from '../src/modules/portal-fill/write-intent.signer';
import type { Env } from '../src/config/configuration';

const cfg = (secret = 'unit-secret') =>
  ({ get: () => secret }) as unknown as ConfigService<Env>;

const PLAN: WritePlan = {
  applicationId: 'app-1',
  preflightReviewId: 'pf-1',
  lockedDiffHash: 'LOCK',
  planHash: 'PLAN',
  entries: [
    {
      fieldKey: 'dob',
      selector: '#dob',
      mappedValue: '2031-03-14',
      expectedValueHash: 'vh:dob',
      category: 'dates',
    },
    {
      fieldKey: 'passport_number',
      selector: '#pp',
      mappedValue: 'X1',
      expectedValueHash: 'vh:pp',
      category: 'passport',
    },
  ],
};
const EXEC = 'exec-1';

describe('WriteIntentSigner (Phase 7D)', () => {
  it('signs one intent per plan entry, bound to execution + lock', () => {
    const s = new WriteIntentSigner(cfg());
    const intents = s.sign(PLAN, EXEC);
    expect(intents).toHaveLength(2);
    for (const i of intents) {
      expect(i.executionId).toBe(EXEC);
      expect(i.lockedDiffHash).toBe('LOCK');
      expect(i.sig).toBeTruthy();
      expect(s.verify(i)).toBe(true);
    }
  });

  it('rejects a tampered mapped value (expectedValueHash change)', () => {
    const s = new WriteIntentSigner(cfg());
    const [i] = s.sign(PLAN, EXEC);
    expect(s.verify({ ...i, expectedValueHash: 'vh:HACKED' })).toBe(false);
  });

  it('rejects field re-pointing', () => {
    const s = new WriteIntentSigner(cfg());
    const [i] = s.sign(PLAN, EXEC);
    expect(s.verify({ ...i, fieldKey: 'other_field' })).toBe(false);
  });

  it('rejects lock detachment', () => {
    const s = new WriteIntentSigner(cfg());
    const [i] = s.sign(PLAN, EXEC);
    expect(s.verify({ ...i, lockedDiffHash: 'DIFFERENT' })).toBe(false);
  });

  it('rejects cross-execution replay (different executionId => different sig)', () => {
    const s = new WriteIntentSigner(cfg());
    const a = s.sign(PLAN, 'exec-A')[0];
    const b = s.sign(PLAN, 'exec-B')[0];
    expect(a.sig).not.toBe(b.sig);
    expect(s.verify({ ...a, executionId: 'exec-B' })).toBe(false); // a's sig under B's id fails
  });

  it('rejects a forged signature', () => {
    const s = new WriteIntentSigner(cfg());
    const [i] = s.sign(PLAN, EXEC);
    expect(s.verify({ ...i, sig: i.sig.slice(0, -2) + 'zz' })).toBe(false);
  });

  it('is secret-bound (intent from one secret fails under another)', () => {
    const [i] = new WriteIntentSigner(cfg('secret-A')).sign(PLAN, EXEC);
    expect(new WriteIntentSigner(cfg('secret-B')).verify(i)).toBe(false);
  });
});
