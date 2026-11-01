/**
 * The Portal Assistant attaches the applicant's reviewed VisaAI documents on
 * IRCC /doc-upload (dry run 2026-10-17: every form page was filled, then each
 * file still had to be found and attached by hand).
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import { PORTAL_FILL_PROTOCOL_VERSION } from '@visaai/types';
import type { SignedWriteIntent } from '@visaai/types';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import {
  IRCC_UPLOAD_SLOTS,
  documentForSlot,
  documentIdOf,
  uploadValue,
  type PortalDocument,
} from '../src/modules/automation/portal-fills/ircc-uploads';
import { loadPortalDocuments } from '../src/modules/preflight/portal-documents';
import {
  PORTAL_UPLOAD_MAX_BYTES,
  toPortalFile,
} from '../src/modules/portal-fill/portal-document-files';
import {
  SocketExtensionTransport,
  type ExtensionSocket,
} from '../src/modules/portal-fill/socket-extension.transport';

const doc = (over: Partial<PortalDocument>): PortalDocument => ({
  id: '00000000-0000-4000-8000-000000000001',
  documentType: 'national_id',
  fileName: 'cnic.jpg',
  mimeType: 'image/jpeg',
  approved: false,
  createdAt: '2026-10-15T00:00:00Z',
  ...over,
});
const slot = (key: string) => IRCC_UPLOAD_SLOTS.find((s) => s.key === key)!;

describe('which document goes in which IRCC slot', () => {
  it('prefers a consultant-approved document, then the newest', () => {
    const p = {
      _portal_documents: [
        doc({
          id: '00000000-0000-4000-8000-00000000000a',
          createdAt: '2026-10-16T00:00:00Z',
        }),
        doc({ id: '00000000-0000-4000-8000-00000000000b', approved: true }),
      ],
    };
    expect(documentForSlot(p, slot('national_id'))?.id).toBe(
      '00000000-0000-4000-8000-00000000000b',
    );
  });

  it("uses the slot's document types in order (proof of funds before a bank statement)", () => {
    const p = {
      _portal_documents: [
        doc({
          id: '00000000-0000-4000-8000-0000000000b1',
          documentType: 'bank_statement',
          approved: true,
        }),
        doc({
          id: '00000000-0000-4000-8000-0000000000f1',
          documentType: 'proof_of_funds',
        }),
      ],
    };
    expect(documentForSlot(p, slot('funds'))?.documentType).toBe(
      'proof_of_funds',
    );
  });

  it('a slot with no document is not written', () => {
    expect(documentForSlot({}, slot('passport'))).toBeUndefined();
  });

  it('the review value names the file and the document id', () => {
    const v = uploadValue(doc({ fileName: 'AK1182091.pdf' }));
    expect(v).toBe('AK1182091.pdf [doc:00000000-0000-4000-8000-000000000001]');
    expect(documentIdOf(v)).toBe('00000000-0000-4000-8000-000000000001');
    expect(documentIdOf('AK1182091.pdf')).toBeNull();
  });

  it('the IRCC mapping writes each slot that has a document, labelled "Upload: …"', () => {
    const inputs = buildMappingInputs(resolvePortalFill('ircc')!, {
      uses_representative: false,
      _portal_documents: [
        doc({}),
        doc({
          id: '00000000-0000-4000-8000-000000000002',
          documentType: 'passport_copy',
          fileName: 'Passport.pdf',
          mimeType: 'application/pdf',
        }),
      ],
    }).filter((m) => m.page === '/doc-upload');
    expect(inputs.map((m) => [m.label, m.mappedValue])).toEqual([
      [
        'Upload: National identity document',
        'cnic.jpg [doc:00000000-0000-4000-8000-000000000001]',
      ],
      [
        'Upload: Passport',
        'Passport.pdf [doc:00000000-0000-4000-8000-000000000002]',
      ],
    ]);
  });
});

describe('a form to sign (IMM 5476) goes in only once the consultant approved the signed copy', () => {
  const imm = (approved: boolean) =>
    doc({
      id: '00000000-0000-4000-8000-000000005476',
      documentType: 'imm5476',
      fileName: 'IMM5476.pdf',
      mimeType: 'application/pdf',
      approved,
    });
  const docUploadLeft = (p: Record<string, unknown>) =>
    (
      portalFillCoverage(resolvePortalFill('ircc')!, p).pages.find(
        (x) => x.page === '/doc-upload',
      )?.left ?? []
    ).filter((l) => /IMM 5476/.test(l.label));
  const upload = (p: Record<string, unknown>) =>
    buildMappingInputs(resolvePortalFill('ircc')!, p).filter(
      (m) => m.label === 'Upload: Use of a Representative (IMM 5476)',
    );

  it('an undecided copy is not attached, and the applicant is told why', () => {
    const p = { uses_representative: true, _portal_documents: [imm(false)] };
    expect(documentForSlot(p, slot('representative'))).toBeUndefined();
    expect(upload(p)).toEqual([]);
    const left = docUploadLeft(p);
    expect(left).toHaveLength(1);
    expect(left[0].label).toBe('Upload: Use of a Representative (IMM 5476)');
    expect(left[0].note).toMatch(/not confirmed as signed/);
  });

  it('an approved copy is attached and nothing is left', () => {
    const p = { uses_representative: true, _portal_documents: [imm(true)] };
    expect(upload(p).map((m) => m.mappedValue)).toEqual([
      'IMM5476.pdf [doc:00000000-0000-4000-8000-000000005476]',
    ]);
    expect(docUploadLeft(p)).toEqual([]);
  });

  it('no copy at all: print, sign and upload it', () => {
    const left = docUploadLeft({ uses_representative: true });
    expect(left.map((l) => l.note)).toEqual([
      expect.stringMatching(/Print the pre-filled form/),
    ]);
  });

  it('no representative: nothing to sign', () => {
    expect(docUploadLeft({ uses_representative: false })).toEqual([]);
  });
});

describe('slot document types on every route (live E2E 2026-10-18)', () => {
  it.each([
    ['passport', 'passport_valid_entire_stay'],
    ['passport', 'passport_biographic_page'],
    ['funds', 'bank_statement_3mo'],
    ['funds', 'bank_statement_6mo'],
  ])('%s slot takes %s', (key, documentType) => {
    const p = { _portal_documents: [doc({ documentType })] };
    expect(documentForSlot(p, slot(key))?.documentType).toBe(documentType);
  });

  it('a US green card upload is not the passport', () => {
    const p = {
      _portal_documents: [doc({ documentType: 'us_green_card_and_passport' })],
    };
    expect(documentForSlot(p, slot('passport'))).toBeUndefined();
  });

  it('an exact type still wins over a prefix match', () => {
    const p = {
      _portal_documents: [
        doc({
          id: '00000000-0000-4000-8000-0000000000aa',
          documentType: 'bank_statement_3mo',
          createdAt: '2026-10-17T00:00:00Z',
        }),
        doc({
          id: '00000000-0000-4000-8000-0000000000bb',
          documentType: 'bank_statement',
        }),
      ],
    };
    expect(documentForSlot(p, slot('funds'))?.documentType).toBe(
      'bank_statement',
    );
  });
});

describe('which documents may be attached at all', () => {
  function db(
    docs: unknown[],
    reviews: unknown[],
    verifications: unknown[] = [],
  ) {
    const q = (rows: unknown[]) => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error: null }),
      }),
    });
    return {
      from: (t: string) =>
        t === 'documents'
          ? q(docs)
          : t === 'document_verifications'
            ? q(verifications)
            : q(reviews),
    } as never;
  }
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    document_type: 'passport_copy',
    file_name: `${id}.pdf`,
    mime_type: 'application/pdf',
    upload_status: 'complete',
    ocr_status: 'complete',
    dup_status: 'unique',
    created_at: '2026-10-15T00:00:00Z',
    ...over,
  });

  it('keeps read, unique, not rejected documents; the latest consultant decision counts', async () => {
    const docs = await loadPortalDocuments(
      db(
        [
          row('a'),
          row('b', { ocr_status: 'failed' }),
          row('c', { dup_status: 'exact_dup' }),
          row('d'),
          row('e'),
          row('f', { document_type: null }),
        ],
        [
          {
            item_kind: 'document',
            item_id: 'd',
            decision: 'approved',
            created_at: '1',
          },
          {
            item_kind: 'document',
            item_id: 'd',
            decision: 'rejected',
            created_at: '2',
          },
          {
            item_kind: 'document',
            item_id: 'e',
            decision: 'needs_reupload',
            created_at: '1',
          },
          {
            item_kind: 'document',
            item_id: 'e',
            decision: 'approved',
            created_at: '2',
          },
        ],
      ),
      'app',
    );
    expect(docs.map((d) => [d.id, d.approved])).toEqual([
      ['a', false],
      ['e', true],
    ]);
  });

  it('skips a card whose holder is unknown unless the consultant approved it (live E2E 2026-10-18)', async () => {
    const unknown = (id: string) => ({
      document_id: id,
      verification_type: 'identity',
      details_json: { extracted_fields: { holder_unknown: true } },
    });
    const docs = await loadPortalDocuments(
      db(
        [
          row('a', { document_type: 'national_id' }),
          row('b', { document_type: 'national_id' }),
          row('c', { document_type: 'national_id' }),
        ],
        [
          {
            item_kind: 'document',
            item_id: 'b',
            decision: 'approved',
            created_at: '1',
          },
        ],
        [unknown('a'), unknown('b')],
      ),
      'app',
    );
    expect(docs.map((d) => d.id)).toEqual(['b', 'c']);
  });

  it('a failed read attaches nothing', async () => {
    const broken = {
      from: () => {
        throw new Error('down');
      },
    } as never;
    expect(await loadPortalDocuments(broken, 'app')).toEqual([]);
  });
});

describe('the file handed to the extension', () => {
  it('carries name, type, size and a sha256 of the bytes', () => {
    const f = toPortalFile(
      'a.pdf',
      'application/pdf',
      Buffer.from('%PDF-1.4'),
    )!;
    expect(f).toMatchObject({
      name: 'a.pdf',
      mimeType: 'application/pdf',
      size: 8,
    });
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(f.base64, 'base64').toString()).toBe('%PDF-1.4');
  });

  it('refuses what IRCC refuses: over 5 MB, an unsupported type, an empty file', () => {
    expect(
      toPortalFile(
        'a.pdf',
        'application/pdf',
        Buffer.alloc(PORTAL_UPLOAD_MAX_BYTES + 1),
      ),
    ).toBeNull();
    expect(toPortalFile('a.gif', 'image/gif', Buffer.from('x'))).toBeNull();
    expect(
      toPortalFile('a.pdf', 'application/pdf', Buffer.alloc(0)),
    ).toBeNull();
  });
});

describe('the transport attaches the bytes for an attach_file write', () => {
  const ID = '00000000-0000-4000-8000-000000000009';
  const intent = (): SignedWriteIntent => ({
    executionId: 'exec-1',
    fieldKey: 'ircc_upload_passport',
    page: '/doc-upload',
    selector: '::upload:\\bpassport\\b',
    mappedValue: `Passport.pdf [doc:${ID}]`,
    expectedValueHash: 'vh',
    category: 'passport',
    op: 'attach_file',
    lockedDiffHash: 'l',
    sig: 's',
  });
  class Sock implements ExtensionSocket {
    sent: unknown[] = [];
    readonly id = 'sock';
    emit(_e: string, payload: unknown, ack: (r: unknown) => void) {
      this.sent.push(payload);
      ack({
        protocol: PORTAL_FILL_PROTOCOL_VERSION,
        kind: 'field_result',
        executionId: 'exec-1',
        fieldKey: 'ircc_upload_passport',
        outcome: 'verified',
        actualValueHash: 'vh',
        selectorFound: true,
      });
      return true;
    }
  }

  it('reads the document the locked value names, for the bound application', async () => {
    const load = jest.fn(() =>
      Promise.resolve(
        toPortalFile('Passport.pdf', 'application/pdf', Buffer.from('%PDF')),
      ),
    );
    const t = new SocketExtensionTransport({ load } as never);
    const s = new Sock();
    t.bind('exec-1', s, 'app-1');
    const res = await t.send(intent());
    expect(load).toHaveBeenCalledWith('app-1', ID, 'ircc_upload_passport');
    expect(res.outcome).toBe('verified');
    expect((s.sent[0] as { file?: { name: string } }).file?.name).toBe(
      'Passport.pdf',
    );
  });

  it('carries the label the applicant confirmed, for the panel to show', async () => {
    const t = new SocketExtensionTransport({
      load: () =>
        Promise.resolve(
          toPortalFile('Passport.pdf', 'application/pdf', Buffer.from('%PDF')),
        ),
    } as never);
    const s = new Sock();
    t.bind('exec-1', s, 'app-1');
    await t.send({ ...intent(), label: 'Upload: Passport' });
    expect((s.sent[0] as { label?: string }).label).toBe('Upload: Passport');
  });

  it('fails the write — and sends nothing — when the document cannot be read', async () => {
    const t = new SocketExtensionTransport({
      load: () => Promise.resolve(null),
    } as never);
    const s = new Sock();
    t.bind('exec-1', s, 'app-1');
    const res = await t.send(intent());
    expect(res).toMatchObject({ outcome: 'failed', reason: 'transport_error' });
    expect(s.sent).toHaveLength(0);
  });

  it('never attaches for an execution bound without its application', async () => {
    const load = jest.fn();
    const t = new SocketExtensionTransport({ load } as never);
    const s = new Sock();
    t.bind('exec-1', s);
    expect((await t.send(intent())).outcome).toBe('failed');
    expect(load).not.toHaveBeenCalled();
  });
});
