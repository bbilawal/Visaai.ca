import { ForbiddenException } from '@nestjs/common';
import { AuditService } from '../src/modules/audit/audit.service';
import { ReviewItemsService } from '../src/modules/review-items/review-items.service';
import type {
  DecisionRow,
  DocumentRow,
  GeneratedRow,
  HolderConfirmationRow,
  IReviewItemsRepository,
} from '../src/modules/review-items/review-items.repository';
import { FakeAuditRepository } from './fakes/audit-repository.fake';

const APP = 'app-1';
const CONS = { id: 'cons-1', appRole: 'consultant' as const };
const OTHER = { id: 'cons-2', appRole: 'consultant' as const };
const ADMIN = { id: 'adm-1', appRole: 'admin' as const };

class FakeRepo implements IReviewItemsRepository {
  docs: DocumentRow[] = [
    {
      id: 'd1',
      application_id: APP,
      document_type: 'passport',
      file_name: 'pp.pdf',
      storage_path: 'u/app-1/pp.pdf',
      upload_status: 'complete',
      ocr_status: 'complete',
      created_at: '2026-10-01',
    },
    {
      id: 'dX',
      application_id: 'app-OTHER',
      document_type: 'passport',
      file_name: 'x.pdf',
      storage_path: 'v/x.pdf',
      upload_status: 'complete',
      ocr_status: 'complete',
      created_at: '2026-10-01',
    },
  ];
  gen: GeneratedRow[] = [
    {
      id: 'g1',
      application_id: APP,
      doc_type: 'loe',
      content_md: '**To: Visa Officer**',
      approved_by_user: true,
      generated_at: '2026-10-02',
    },
    {
      id: 'g2',
      application_id: APP,
      doc_type: 'prefilled_form_json',
      content_md: JSON.stringify({
        fields: [{ key: 'given_name', label: 'Given name', value: 'MUZAFFAR' }],
      }),
      approved_by_user: false,
      generated_at: null,
    },
  ];
  decisions: (DecisionRow & { application_id: string })[] = [];
  revisions: unknown[] = [];
  access: unknown[] = [];
  async listDocuments(a: string) {
    return this.docs.filter((d) => d.application_id === a);
  }
  async getDocument(a: string, id: string) {
    return this.docs.find((d) => d.application_id === a && d.id === id) ?? null;
  }
  async listVerifications() {
    return [
      {
        document_id: 'd1',
        verification_type: 'expiry',
        result: 'pass',
        details_json: {},
        verified_at: null,
      },
    ];
  }
  async listExtractedFields() {
    return [
      {
        source_document_id: 'd1',
        field_key: 'passport_number',
        value_snapshot: 'AK1182091',
        origin: 'ocr',
        confidence: 0.9,
      },
    ];
  }
  async listGenerated(a: string) {
    return this.gen.filter((g) => g.application_id === a);
  }
  async getGenerated(a: string, id: string) {
    return this.gen.find((g) => g.application_id === a && g.id === id) ?? null;
  }
  async listDecisions(a: string) {
    return this.decisions.filter((d) => d.application_id === a);
  }
  async insertDecision(row: DecisionRow & { application_id: string }) {
    this.decisions.push(row);
  }
  async insertRevision(row: unknown) {
    this.revisions.push(row);
  }
  async updateGeneratedContent(a: string, id: string, c: string) {
    const g = this.gen.find((x) => x.application_id === a && x.id === id)!;
    g.content_md = c;
    g.approved_by_user = false;
  }
  async signedDocumentUrl(p: string) {
    return `http://kong:8000/storage/v1/object/sign/documents/${p}?token=t`;
  }
  async logDocumentAccess(row: unknown) {
    this.access.push(row);
  }
  confirmations: HolderConfirmationRow[] = [];
  async listHolderConfirmations(a: string) {
    return this.confirmations.filter((c) => c.application_id === a);
  }
}

function make() {
  const repo = new FakeRepo();
  const auditRepo = new FakeAuditRepository();
  const audit = new AuditService(auditRepo);
  const consultant = {
    assertAssigned: jest.fn(async (_a: string, id: string) => {
      if (id !== CONS.id)
        throw new ForbiddenException(
          `consultant ${id} is not the active assignee`,
        );
    }),
  };
  const messaging = { postMessage: jest.fn().mockResolvedValue({ id: 'm1' }) };
  const supabase = {
    toPublicStorageUrl: (u: string) =>
      u.replace('http://kong:8000', 'https://db.visaai.co'),
  };
  const svc = new ReviewItemsService(
    repo,
    consultant as never,
    audit,
    messaging as never,
    supabase as never,
  );
  return { svc, repo, auditRepo, messaging };
}

describe('ReviewItemsService — authorization', () => {
  it.each([
    ['list', (s: ReviewItemsService) => s.list(APP, OTHER)],
    [
      'openDocument',
      (s: ReviewItemsService) => s.openDocument(APP, 'd1', OTHER),
    ],
    [
      'decide',
      (s: ReviewItemsService) =>
        s.decide(
          APP,
          OTHER,
          { itemKind: 'document', itemId: 'd1', decision: 'approved' },
          'tok',
        ),
    ],
    [
      'editGenerated',
      (s: ReviewItemsService) => s.editGenerated(APP, OTHER, 'g1', 'x'),
    ],
  ])(
    '%s refuses a consultant who is not the active assignee',
    async (_n, call) => {
      const { svc, repo } = make();
      await expect(call(svc)).rejects.toThrow(/not the active assignee/);
      expect(repo.decisions).toHaveLength(0);
      expect(repo.access).toHaveLength(0);
    },
  );

  it('admin may review', async () => {
    const { svc } = make();
    await expect(svc.list(APP, ADMIN)).resolves.toBeTruthy();
  });
});

describe('ReviewItemsService — list', () => {
  it('returns documents with verifications, extracted fields and the latest decision; letters; and the full form', async () => {
    const { svc, repo } = make();
    repo.decisions.push(
      {
        application_id: APP,
        item_kind: 'document',
        item_id: 'd1',
        decision: 'needs_reupload',
        note: 'blurry',
        reviewer_id: CONS.id,
        reviewer_role: 'consultant',
        created_at: '2026-10-10',
      },
      {
        application_id: APP,
        item_kind: 'document',
        item_id: 'd1',
        decision: 'approved',
        note: null,
        reviewer_id: CONS.id,
        reviewer_role: 'consultant',
        created_at: '2026-10-11',
      },
    );
    const out = await svc.list(APP, CONS);
    expect(out.documents).toHaveLength(1);
    expect(out.documents[0]).toMatchObject({
      id: 'd1',
      verifications: [{ verificationType: 'expiry', result: 'pass' }],
      extractedFields: [{ fieldKey: 'passport_number', value: 'AK1182091' }],
      decision: { decision: 'approved' },
    });
    expect(out.generated.map((g) => g.docType)).toEqual(['loe']);
    expect(out.form?.fields[0]).toMatchObject({
      key: 'given_name',
      value: 'MUZAFFAR',
    });
  });
});

describe("ReviewItemsService — the applicant's own passport confirmation", () => {
  it('comes from document_holder_confirmations (latest), never from the owner-writable details_json', async () => {
    const { svc, repo } = make();
    repo.confirmations.push(
      {
        application_id: APP,
        document_id: 'd1',
        confirmed_by: 'owner-1',
        holder_name: 'OLD',
        stated_name: 'Old',
        created_at: '2026-10-29T10:00:00Z',
      },
      {
        application_id: APP,
        document_id: 'd1',
        confirmed_by: 'owner-1',
        holder_name: 'QUEBEC ZULU',
        stated_name: 'Romeo Kilo',
        created_at: '2026-10-30T10:00:00Z',
      },
      {
        application_id: 'app-OTHER',
        document_id: 'dX',
        confirmed_by: 'x',
        holder_name: 'X',
        stated_name: 'X',
        created_at: '2026-10-30T10:00:00Z',
      },
    );
    const out = await svc.list(APP, CONS);
    expect(out.documents[0].applicantConfirmation).toEqual({
      confirmedBy: 'owner-1',
      confirmedAt: '2026-10-30T10:00:00Z',
      holderName: 'QUEBEC ZULU',
      statedName: 'Romeo Kilo',
    });
  });

  it('is null without a row, whatever details_json claims', async () => {
    const { svc, repo } = make();
    repo.listVerifications = async () => [
      {
        document_id: 'd1',
        verification_type: 'identity',
        result: 'pass',
        details_json: {
          holder_confirmation: { confirmed_at: '2026-10-30T10:00:00Z' },
        },
        verified_at: null,
      },
    ];
    const out = await svc.list(APP, CONS);
    expect(out.documents[0].applicantConfirmation).toBeNull();
  });
});

describe('ReviewItemsService — a regenerated letter needs a fresh review', () => {
  const decision = (created_at: string) => ({
    application_id: APP,
    item_kind: 'generated' as const,
    item_id: 'g1',
    decision: 'approved' as const,
    note: null,
    reviewer_id: CONS.id,
    reviewer_role: 'consultant' as const,
    created_at,
  });

  it('drops a consultant decision made before the letter was (re)generated', async () => {
    const { svc, repo } = make();
    repo.gen[0].generated_at = '2026-10-14T12:00:00Z';
    repo.decisions.push(decision('2026-10-14T09:00:00Z'));
    const out = await svc.list(APP, CONS);
    expect(out.generated[0].decision).toBeNull();
  });

  it('keeps a decision made after the letter was generated', async () => {
    const { svc, repo } = make();
    repo.gen[0].generated_at = '2026-10-14T12:00:00Z';
    repo.decisions.push(decision('2026-10-14T13:00:00Z'));
    const out = await svc.list(APP, CONS);
    expect(out.generated[0].decision).toMatchObject({ decision: 'approved' });
  });
});

describe('ReviewItemsService — open a document', () => {
  it('returns a short-lived public signed URL and logs the view', async () => {
    const { svc, repo } = make();
    const out = await svc.openDocument(APP, 'd1', CONS);
    expect(out.url).toMatch(/^https:\/\/db\.visaai\.co\//);
    expect(out.expiresIn).toBeLessThanOrEqual(300);
    expect(repo.access).toEqual([
      {
        document_id: 'd1',
        application_id: APP,
        user_id: CONS.id,
        action: 'view',
      },
    ]);
  });

  it('cannot open a document from another application via this application', async () => {
    const { svc, repo } = make();
    await expect(svc.openDocument(APP, 'dX', CONS)).rejects.toThrow(
      /not found/i,
    );
    expect(repo.access).toHaveLength(0);
  });
});

describe('ReviewItemsService — decisions', () => {
  it('records a needs-reupload with a note, audits it, and tells the applicant in the conversation', async () => {
    const { svc, repo, auditRepo, messaging } = make();
    const out = await svc.decide(
      APP,
      CONS,
      {
        itemKind: 'document',
        itemId: 'd1',
        decision: 'needs_reupload',
        note: 'The scan is cut off',
      },
      'tok',
    );
    expect(repo.decisions[0]).toMatchObject({
      item_id: 'd1',
      decision: 'needs_reupload',
      note: 'The scan is cut off',
      reviewer_role: 'consultant',
    });
    expect(auditRepo.rows.at(-1)).toMatchObject({
      event_type: 'CONSULTANT_REVIEWED',
      actor_id: CONS.id,
      document_id: 'd1',
    });
    expect(messaging.postMessage).toHaveBeenCalledWith(
      'tok',
      CONS,
      APP,
      expect.objectContaining({
        category: 'documents',
        body: expect.stringContaining('The scan is cut off'),
      }),
    );
    expect(out.notified).toBe(true);
  });

  it('an approval needs no note and sends no message', async () => {
    const { svc, messaging } = make();
    await svc.decide(
      APP,
      CONS,
      { itemKind: 'generated', itemId: 'g1', decision: 'approved' },
      'tok',
    );
    expect(messaging.postMessage).not.toHaveBeenCalled();
  });

  it('requires a note for anything but an approval', async () => {
    const { svc } = make();
    await expect(
      svc.decide(
        APP,
        CONS,
        {
          itemKind: 'generated',
          itemId: 'g1',
          decision: 'changes_requested',
          note: ' ',
        },
        'tok',
      ),
    ).rejects.toThrow(/note/i);
  });

  it('refuses a decision that does not fit the item kind', async () => {
    const { svc } = make();
    await expect(
      svc.decide(
        APP,
        CONS,
        {
          itemKind: 'generated',
          itemId: 'g1',
          decision: 'needs_reupload',
          note: 'x',
        },
        'tok',
      ),
    ).rejects.toThrow(/not valid/i);
  });

  it('refuses an item that belongs to another application', async () => {
    const { svc } = make();
    await expect(
      svc.decide(
        APP,
        CONS,
        { itemKind: 'document', itemId: 'dX', decision: 'approved' },
        'tok',
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('keeps the decision when the conversation message fails', async () => {
    const { svc, repo, messaging } = make();
    messaging.postMessage.mockRejectedValue(new Error('down'));
    const out = await svc.decide(
      APP,
      CONS,
      {
        itemKind: 'document',
        itemId: 'd1',
        decision: 'rejected',
        note: 'Not a passport',
      },
      'tok',
    );
    expect(repo.decisions).toHaveLength(1);
    expect(out.notified).toBe(false);
  });
});

describe('ReviewItemsService — edit a generated letter', () => {
  it('keeps the prior content as a revision, saves, resets the applicant approval, audits hashes only', async () => {
    const { svc, repo, auditRepo } = make();
    const out = await svc.editGenerated(
      APP,
      CONS,
      'g1',
      '**To: The Visa Officer**',
      'tone',
    );
    expect(repo.revisions[0]).toMatchObject({
      generated_document_id: 'g1',
      content_md: '**To: Visa Officer**',
      edited_by: CONS.id,
      edited_role: 'consultant',
      note: 'tone',
    });
    expect(out).toMatchObject({
      id: 'g1',
      contentMd: '**To: The Visa Officer**',
      approvedByUser: false,
    });
    const ev = auditRepo.rows.at(-1)!;
    expect(ev.event_type).toBe('CONSULTANT_REVIEWED');
    expect(ev.payload).toMatchObject({
      action: 'generated_edited',
      doc_type: 'loe',
    });
    expect(JSON.stringify(ev.payload)).not.toContain('Visa Officer');
  });

  it('refuses to edit the form JSON as a blob (it is edited field by field)', async () => {
    const { svc } = make();
    await expect(svc.editGenerated(APP, CONS, 'g2', '{}')).rejects.toThrow(
      /field by field/i,
    );
  });

  it('refuses an empty letter', async () => {
    const { svc } = make();
    await expect(svc.editGenerated(APP, CONS, 'g1', '   ')).rejects.toThrow(
      /empty/i,
    );
  });
});

describe('ReviewItemsController — route guards', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ReviewItemsController } = require('../src/modules/review-items/review-items.controller');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { REQUIRED_ROLES_KEY, RolesGuard } = require('../src/modules/auth/roles.guard');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ApplicationAccessGuard } = require('../src/modules/auth/application-access.guard');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { JwtGuard } = require('../src/modules/auth/jwt.guard');

  it('is consultant-only and application-scoped at the class level', () => {
    const guards = Reflect.getMetadata('__guards__', ReviewItemsController) as unknown[];
    expect(guards).toEqual([JwtGuard, ApplicationAccessGuard, RolesGuard]);
    expect(Reflect.getMetadata(REQUIRED_ROLES_KEY, ReviewItemsController)).toEqual(['consultant']);
  });
});

/**
 * Live 2026-10-20: an application was approvable while one of its documents
 * was marked "Needs re-upload". The review module registers an approval
 * blocker with ConsultantApprovalService.
 */
describe('ReviewItemsService — approval blocker', () => {
  const reupload = (at: string) => ({
    application_id: APP,
    item_kind: 'document' as const,
    item_id: 'd1',
    decision: 'needs_reupload' as const,
    note: 'blurry' as string | null,
    reviewer_id: CONS.id,
    reviewer_role: 'consultant' as const,
    created_at: at,
  });

  it('registers itself with the approval service at module init', () => {
    const register = jest.fn();
    const svc = new ReviewItemsService(
      new FakeRepo(),
      { registerApplicationApprovalBlocker: register } as never,
      new AuditService(new FakeAuditRepository()),
      {} as never,
      {} as never,
    );
    svc.onModuleInit();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('is clear with no decisions', async () => {
    const { svc } = make();
    await expect(svc.approvalBlocker(APP)).resolves.toBeNull();
  });

  it('names a document with an open re-upload request', async () => {
    const { svc, repo } = make();
    repo.docs[0].checklist_item_id = 'slot-1';
    repo.decisions.push(reupload('2026-10-10T10:00:00Z'));
    const reason = await svc.approvalBlocker(APP);
    expect(reason).toMatch(/Cannot approve yet/);
    expect(reason).toContain('pp.pdf (re-upload requested)');
  });

  it('names a rejected document', async () => {
    const { svc, repo } = make();
    repo.decisions.push({
      ...reupload('2026-10-10T10:00:00Z'),
      decision: 'rejected' as never,
    });
    expect(await svc.approvalBlocker(APP)).toContain('pp.pdf (rejected)');
  });

  it('clears once the consultant approves the document', async () => {
    const { svc, repo } = make();
    repo.decisions.push(reupload('2026-10-10T10:00:00Z'), {
      ...reupload('2026-10-11T10:00:00Z'),
      decision: 'approved' as never,
      note: null,
    });
    await expect(svc.approvalBlocker(APP)).resolves.toBeNull();
  });

  it('a multi-file slot: a file uploaded before the request does not clear it', async () => {
    const { svc, repo } = make();
    repo.docs[0].checklist_item_id = 'slot-1';
    repo.docs[0].created_at = '2026-10-01T09:00:00Z';
    repo.docs.push({
      ...repo.docs[0],
      id: 'd2',
      file_name: 'statement-b.pdf',
      created_at: '2026-10-02T09:00:00Z',
    });
    repo.decisions.push(reupload('2026-10-10T10:00:00Z'));
    expect(await svc.approvalBlocker(APP)).toContain('pp.pdf (re-upload requested)');
  });

  it('deleting the requested document keeps the request open', async () => {
    const { svc, repo } = make();
    repo.decisions.push(reupload('2026-10-10T10:00:00Z'));
    repo.docs = repo.docs.filter((d) => d.id !== 'd1');
    expect(await svc.approvalBlocker(APP)).toContain(
      'a document the applicant deleted (re-upload requested)',
    );
  });

  describe('a requested document the applicant deleted', () => {
    function deletedSetup() {
      const ctx = make();
      ctx.repo.decisions.push(reupload('2026-10-10T10:00:00Z'));
      ctx.repo.docs = ctx.repo.docs.filter((d) => d.id !== 'd1');
      return ctx;
    }

    it('is listed for the consultant as deleted, with its decision', async () => {
      const { svc } = deletedSetup();
      const items = await svc.list(APP, CONS);
      const d = items.documents.find((x) => x.id === 'd1');
      expect(d).toMatchObject({
        deleted: true,
        uploadStatus: 'deleted',
        decision: expect.objectContaining({ decision: 'needs_reupload' }),
      });
    });

    it('the consultant can approve it, which closes the request and the blocker', async () => {
      const { svc, messaging } = deletedSetup();
      expect(await svc.approvalBlocker(APP)).toMatch(/Deleted by the applicant/);
      await svc.decide(
        APP,
        CONS,
        { itemKind: 'document', itemId: 'd1', decision: 'approved' },
        'tok',
      );
      await expect(svc.approvalBlocker(APP)).resolves.toBeNull();
      expect(messaging.postMessage).not.toHaveBeenCalled();
      expect(
        (await svc.list(APP, CONS)).documents.some((x) => x.id === 'd1'),
      ).toBe(false);
    });

    it('only an approval applies to a deleted document', async () => {
      const { svc } = deletedSetup();
      await expect(
        svc.decide(
          APP,
          CONS,
          {
            itemKind: 'document',
            itemId: 'd1',
            decision: 'rejected',
            note: 'still wrong',
          },
          'tok',
        ),
      ).rejects.toThrow(/deleted by the applicant/);
    });

    it('a document id with no decision and no row is still not found', async () => {
      const { svc } = make();
      await expect(
        svc.decide(
          APP,
          CONS,
          {
            itemKind: 'document',
            itemId: '00000000-0000-0000-0000-000000000000',
            decision: 'approved',
          },
          'tok',
        ),
      ).rejects.toThrow(/document not found/);
    });
  });

  it('clears once a newer document is uploaded into the same slot', async () => {
    const { svc, repo } = make();
    repo.docs[0].checklist_item_id = 'slot-1';
    repo.docs[0].created_at = '2026-10-01T09:00:00Z';
    repo.docs.push({
      ...repo.docs[0],
      id: 'd2',
      file_name: 'pp-new.pdf',
      created_at: '2026-10-12T09:00:00Z',
    });
    repo.decisions.push(reupload('2026-10-10T10:00:00Z'));
    await expect(svc.approvalBlocker(APP)).resolves.toBeNull();
  });
});
