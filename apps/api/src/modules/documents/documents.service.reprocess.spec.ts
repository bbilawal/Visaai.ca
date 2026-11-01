import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { makeFakeDb } from './family-gaps/__fixtures__/fake-db';
import type { AuthUser } from '../auth/jwt.guard';

/**
 * POST /documents/item/:documentId/reprocess.
 *
 * Parser fixes (#111) only reached new uploads: the client's nikah nama,
 * uploaded before the fix, kept yielding the old wrong marriage date. A
 * re-read runs the same pipeline as an upload on the file already stored.
 */

const DOC = {
  id: 'doc-1',
  application_id: 'app-1',
  storage_path: 'owner-1/app-1/nikah.pdf',
  mime_type: 'application/pdf',
  document_type: 'sponsor_proof_of_relationship',
  ocr_status: 'complete',
  checklist_item_id: 'item-1',
};

function setup(
  opts: {
    existingJobState?: string | null;
    assignments?: Array<Record<string, unknown>>;
    addFails?: boolean;
  } = {},
) {
  const fake = makeFakeDb({
    documents: [{ ...DOC }],
    applications: [{ id: 'app-1', user_id: 'owner-1' }],
    consultant_assignments: opts.assignments ?? [],
    document_access_logs: [],
  });
  const removed: string[] = [];
  const queue = {
    add: jest.fn((..._args: unknown[]) =>
      opts.addFails
        ? Promise.reject(new Error('redis down'))
        : Promise.resolve({ id: 'job' }),
    ),
    getJob: jest.fn((id: string) =>
      Promise.resolve(
        opts.existingJobState
          ? {
              id,
              getState: () => Promise.resolve(opts.existingJobState),
              remove: () => {
                removed.push(id);
                return Promise.resolve();
              },
            }
          : undefined,
      ),
    ),
  };
  const svc = new DocumentsService(
    { admin: fake.client } as never,
    {} as never,
    queue as never,
  );
  return { svc, fake, queue, removed };
}

const owner: AuthUser = { id: 'owner-1', appRole: 'user' } as AuthUser;

describe('DocumentsService.reprocessDocument', () => {
  it('re-enqueues the stored file through the upload pipeline', async () => {
    const { svc, fake, queue } = setup();
    const res = await svc.reprocessDocument('doc-1', owner);

    expect(res).toEqual({
      documentId: 'doc-1',
      queued: true,
      status: 'queued',
    });
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data, jobOpts] = queue.add.mock.calls[0] as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(name).toBe('process');
    expect(data).toEqual({
      documentId: 'doc-1',
      applicationId: 'app-1',
      storagePath: DOC.storage_path,
      mimeType: DOC.mime_type,
      documentType: DOC.document_type,
    });
    // One job per document at a time; the id frees once the job is done.
    expect(jobOpts).toMatchObject({
      jobId: 'reprocess-doc-1',
      attempts: 3,
      removeOnComplete: true,
      removeOnFail: true,
    });
    // Shown as processing again; the slot linkage is untouched.
    expect(fake.tables.documents[0]).toMatchObject({
      ocr_status: 'pending',
      checklist_item_id: 'item-1',
      storage_path: DOC.storage_path,
    });
    // Audit-logged like every other document action.
    expect(fake.tables.document_access_logs).toEqual([
      expect.objectContaining({
        document_id: 'doc-1',
        application_id: 'app-1',
        user_id: 'owner-1',
        action: 'ocr',
      }),
    ]);
  });

  it('is idempotent: a re-read already queued or running is not queued again', async () => {
    for (const state of ['waiting', 'active', 'delayed']) {
      const { svc, queue, fake } = setup({ existingJobState: state });
      const res = await svc.reprocessDocument('doc-1', owner);
      expect(res).toEqual({
        documentId: 'doc-1',
        queued: false,
        status: 'already_queued',
      });
      expect(queue.add).not.toHaveBeenCalled();
      expect(fake.tables.document_access_logs).toEqual([]);
    }
  });

  it('replaces a finished job left behind under the same id', async () => {
    const { svc, queue, removed } = setup({ existingJobState: 'failed' });
    const res = await svc.reprocessDocument('doc-1', owner);
    expect(res.queued).toBe(true);
    expect(removed).toEqual(['reprocess-doc-1']);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('allows an admin and the actively assigned consultant', async () => {
    const admin = { id: 'admin-9', appRole: 'admin' } as AuthUser;
    await expect(
      setup().svc.reprocessDocument('doc-1', admin),
    ).resolves.toMatchObject({
      queued: true,
    });

    const consultant = { id: 'c-1', appRole: 'consultant' } as AuthUser;
    const { svc, fake } = setup({
      assignments: [
        { application_id: 'app-1', consultant_id: 'c-1', status: 'active' },
      ],
    });
    await expect(
      svc.reprocessDocument('doc-1', consultant),
    ).resolves.toMatchObject({
      queued: true,
    });
    expect(fake.tables.document_access_logs[0].user_id).toBe('c-1');
  });

  it('refuses anyone else — as not found, so it is not an existence oracle', async () => {
    const stranger = { id: 'x-1', appRole: 'user' } as AuthUser;
    const { svc, queue } = setup();
    await expect(
      svc.reprocessDocument('doc-1', stranger),
    ).rejects.toBeInstanceOf(NotFoundException);

    const revoked = { id: 'c-2', appRole: 'consultant' } as AuthUser;
    const s2 = setup({
      assignments: [
        { application_id: 'app-1', consultant_id: 'c-2', status: 'revoked' },
      ],
    });
    await expect(
      s2.svc.reprocessDocument('doc-1', revoked),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('answers not found for a document that does not exist', async () => {
    await expect(
      setup().svc.reprocessDocument('nope', owner),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('restores the previous status when the job cannot be queued', async () => {
    const { svc, fake } = setup({ addFails: true });
    await expect(svc.reprocessDocument('doc-1', owner)).rejects.toThrow(
      /redis down/,
    );
    expect(fake.tables.documents[0].ocr_status).toBe('complete');
    expect(fake.tables.document_access_logs).toEqual([]);
  });
});
