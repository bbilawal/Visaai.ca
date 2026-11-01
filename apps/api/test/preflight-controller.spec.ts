import type { AuthUser } from '../src/modules/auth/jwt.guard';
import type { PreflightMappingInput } from '@visaai/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REQUIRED_ROLES_KEY } from '../src/modules/auth/roles.guard';
import { PreflightController } from '../src/modules/preflight/preflight.controller';
import type { PreflightService } from '../src/modules/preflight/preflight.service';

const APP = 'app-1';
const RID = 'pf-1';
const USER: AuthUser = {
  id: 'cons-1',
  email: 'c@x.com',
  role: 'authenticated',
  appRole: 'consultant',
};

/** An ordinary applicant opening the preflight on their own application. */
const APPLICANT: AuthUser = {
  id: 'appl-1',
  email: 'a@x.com',
  role: 'authenticated',
  appRole: 'user',
};
const MAPPINGS: PreflightMappingInput[] = [
  {
    fieldKey: 'passport_number',
    targetField: '#pp',
    mappedValue: 'X1',
    category: 'passport',
  },
];

function make() {
  const svc = {
    start: jest.fn().mockResolvedValue({ id: RID, status: 'in_review' }),
    assembleDiff: jest
      .fn()
      .mockResolvedValue({ applicationId: APP, entries: [], diffHash: 'dh' }),
    recordCheck: jest
      .fn()
      .mockResolvedValue({ id: RID, passport_reviewed: true }),
    complete: jest.fn().mockResolvedValue({
      id: RID,
      status: 'completed',
      locked_diff_hash: 'lh',
    }),
    validateLock: jest.fn().mockResolvedValue({
      valid: false,
      reasons: ['provenance_or_mapping_changed'],
    }),
    getActive: jest.fn().mockResolvedValue({ id: RID, status: 'in_review' }),
    getActiveFor: jest.fn().mockResolvedValue({ id: RID, status: 'in_review' }),
  };
  const mappingSvc = {
    forApplication: jest.fn().mockResolvedValue(MAPPINGS),
  };
  const editSvc = {
    editField: jest.fn().mockResolvedValue({
      mappings: MAPPINGS,
      review: null,
      formUpdated: true,
      provenanceUpdated: false,
    }),
  };
  const ctrl = new PreflightController(
    svc as unknown as PreflightService,
    mappingSvc as never,
    editSvc as never,
  );
  return { ctrl, svc, mappingSvc, editSvc };
}

describe('PreflightController — thin delegation (Phase 3D)', () => {
  it('start opens the review (as authenticated reviewer) and builds the diff', async () => {
    const { ctrl, svc } = make();
    const out = await ctrl.start(APP, { mappings: MAPPINGS }, USER);
    expect(svc.start).toHaveBeenCalledWith(
      APP,
      { id: USER.id, role: 'consultant' },
      undefined,
    );
    expect(svc.assembleDiff).toHaveBeenCalledWith(APP, MAPPINGS);
    expect(out).toEqual({
      reviewId: RID,
      status: 'in_review',
      diff: { applicationId: APP, entries: [], diffHash: 'dh' },
    });
  });

  it('records an APPLICANT reviewer as an applicant, not a consultant', async () => {
    // The role was hardcoded to 'consultant', so an applicant opening their own
    // preflight was written into the audit trail — the one record showing who
    // actually checked the application — as if a consultant had reviewed it.
    const { ctrl, svc } = make();
    await ctrl.start(APP, { mappings: MAPPINGS }, APPLICANT);
    expect(svc.start).toHaveBeenCalledWith(
      APP,
      { id: APPLICANT.id, role: 'applicant' },
      undefined,
    );
  });

  it('recordCheck delegates verbatim', async () => {
    const { ctrl, svc } = make();
    await ctrl.recordCheck(
      APP,
      RID,
      {
        check: 'passport_reviewed',
        value: true,
      },
      USER,
    );
    expect(svc.recordCheck).toHaveBeenCalledWith(
      RID,
      'passport_reviewed',
      true,
      APP,
      { id: USER.id, role: 'consultant' },
    );
  });

  // An applicant could start a review on their own application, and since a
  // new review retires the live lock, knock out the consultant's lock at will.
  it.each(['start', 'recordCheck', 'complete'] as const)(
    '%s is consultant-only at the route',
    (handler) => {
      expect(
        Reflect.getMetadata(
          REQUIRED_ROLES_KEY,
          PreflightController.prototype[handler],
        ),
      ).toEqual(['consultant']);
    },
  );

  it('complete returns the locked review from the service', async () => {
    const { ctrl, svc } = make();
    const r = await ctrl.complete(APP, RID, { mappings: MAPPINGS }, USER);
    expect(svc.complete).toHaveBeenCalledWith(
      RID,
      MAPPINGS,
      { id: USER.id, role: 'consultant' },
      APP,
    );
    expect(r).toMatchObject({ status: 'completed', locked_diff_hash: 'lh' });
  });

  // Prod 2026-10-15: the body schema stripped `page`, so the client's mappings
  // never hashed like the server's and every Complete & lock answered 409.
  it("complete keeps a mapping's page and label (they are part of the lock)", async () => {
    const { ctrl, svc } = make();
    const paged = [
      { ...MAPPINGS[0], page: '/bio-data', label: 'Date of birth — year' },
    ];
    await ctrl.complete(APP, RID, { mappings: paged }, USER);
    expect(svc.complete.mock.calls[0][1]).toEqual(paged);
  });

  it('complete keeps how a target is operated (op/reveal/dialog are part of the lock)', async () => {
    const { ctrl, svc } = make();
    const ops = [
      {
        ...MAPPINGS[0],
        page: '/national-id-doc',
        label: 'Has a national identity document',
        op: 'radio' as const,
        reveal: true,
        dialog: true,
        awaitOptions: true,
        declaration: true,
      },
    ];
    await ctrl.complete(APP, RID, { mappings: ops }, USER);
    expect(svc.complete.mock.calls[0][1]).toEqual(ops);
  });

  it('validate returns reasons without mutation (pure passthrough)', async () => {
    const { ctrl, svc } = make();
    const v = await ctrl.validate(APP, RID, { mappings: MAPPINGS });
    expect(svc.validateLock).toHaveBeenCalledWith(RID, MAPPINGS, APP);
    expect(v).toEqual({
      valid: false,
      reasons: ['provenance_or_mapping_changed'],
    });
  });

  it('getActive delegates with the caller, so it can say who may lock', async () => {
    const { ctrl, svc } = make();
    await ctrl.getActive(APP, USER);
    expect(svc.getActiveFor).toHaveBeenCalledWith(APP, {
      id: USER.id,
      role: 'consultant',
    });
  });

  // The original form of this guard counted the controller's injected deps and
  // required exactly one. That was a proxy for the real rule in the file header
  // -- "no verification/consultant/eligibility interaction" -- and the proxy
  // broke as soon as a SECOND preflight-module service was injected, which is
  // not cross-layer coupling at all. Assert the rule itself: every import comes
  // from this module, and no forbidden layer is reachable from the controller.
  it('depends only on its own module (no cross-layer coupling)', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src/modules/preflight/preflight.controller.ts'),
      'utf8',
    );
    const moduleImports = [...src.matchAll(/from '(\.[^']+)'/g)].map(
      (m) => m[1],
    );
    const foreign = moduleImports.filter(
      (i) => i.startsWith('../') && !i.startsWith('../../common/'),
    );
    const allowed = [
      '../auth/application-access.guard',
      '../auth/jwt.guard',
      '../auth/current-user.decorator',
      '../auth/roles.guard',
    ];
    expect(foreign.filter((f) => !allowed.includes(f))).toEqual([]);

    for (const forbidden of [
      'verification',
      'consultant',
      'eligibility',
      'execution',
      'automation',
    ]) {
      expect(src).not.toContain(`../${forbidden}/`);
    }
  });

  it('exposes the server-derived mappings both sides must agree on', async () => {
    const { ctrl, mappingSvc } = make();
    await expect(ctrl.getMappings(APP)).resolves.toEqual(MAPPINGS);
    expect(mappingSvc.forApplication).toHaveBeenCalledWith(APP);
  });

  it('editField delegates as the authenticated editor with value + reason', async () => {
    const { ctrl, editSvc } = make();
    await ctrl.editField(
      APP,
      'duration_of_stay_days',
      { value: '62', reason: 'applicant corrected' },
      USER,
    );
    expect(editSvc.editField).toHaveBeenCalledWith(
      APP,
      { id: USER.id, appRole: 'consultant' },
      'duration_of_stay_days',
      '62',
      'applicant corrected',
    );
  });

  it('editField rejects a body without a string value', async () => {
    const { ctrl } = make();
    await expect(
      ctrl.editField(APP, 'k', { value: 5 }, USER),
    ).rejects.toThrow();
  });

  it('editField is consultant-only at the route (applicants edit on the Forms page)', () => {
    const roles = Reflect.getMetadata(
      REQUIRED_ROLES_KEY,
      PreflightController.prototype.editField,
    ) as string[] | undefined;
    expect(roles).toEqual(['consultant']);
  });
});
