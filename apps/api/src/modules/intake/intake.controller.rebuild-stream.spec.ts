import type { Response } from 'express';
import { IntakeController } from './intake.controller';
import type { IntakeService } from './intake.service';
import type { AuthUser } from '../auth/jwt.guard';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The rebuild endpoint answers two ways on one URL: the JSON array it always
 * answered with, and — for a client that asks on the Accept header — the list
 * as the model writes it. The second exists because the generation runs 9-21s
 * and is the only source of a checklist for a route whose registry carries no
 * document-kind requirements, so the applicant otherwise stares at an empty
 * vault for all of it.
 */

const USER = { id: 'user-1' } as AuthUser;
const DB = {} as SupabaseClient;
const ITEM = { id: 'row-1', document_type: 'passport', label: 'Passport' };

/** Express response stand-in that records what was written. */
function makeRes() {
  const lines: string[] = [];
  const headers: Record<string, string> = {};
  const res = {
    writableEnded: false,
    statusCode: 0,
    jsonBody: undefined as unknown,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    write: (chunk: string) => {
      lines.push(chunk);
      return true;
    },
    end: () => {
      res.writableEnded = true;
    },
    status: (code: number) => {
      res.statusCode = code;
      return res;
    },
    json: (body: unknown) => {
      res.jsonBody = body;
      return res;
    },
  };
  return { res: res as unknown as Response, lines, headers, raw: res };
}

function makeController(rebuild: IntakeService['rebuildChecklist']) {
  return new IntakeController({ rebuildChecklist: rebuild } as IntakeService);
}

describe('IntakeController.rebuildChecklist — transport', () => {
  it('answers the plain JSON array when NDJSON is not asked for', async () => {
    // Everything already deployed — the mobile app, the extension — must keep
    // getting exactly what it got before.
    const rebuild = jest.fn().mockResolvedValue([ITEM]);
    const { res, raw, lines } = makeRes();

    await makeController(rebuild).rebuildChecklist(
      DB,
      USER,
      'app-1',
      'application/json',
      res,
    );

    expect(raw.statusCode).toBe(200);
    expect(raw.jsonBody).toEqual([ITEM]);
    expect(lines).toHaveLength(0);
    // No progress callback: nothing is listening for one.
    expect((rebuild.mock.calls[0] as unknown[])[3]).toBeUndefined();
  });

  it('streams each batch and terminates with the authoritative list', async () => {
    const rebuild = jest
      .fn()
      .mockImplementation(
        (
          _db: unknown,
          _id: string,
          _user: string,
          onProgress?: (items: unknown[]) => void,
        ) => {
          onProgress?.([{ document_type: 'passport', label: 'Passport' }]);
          onProgress?.([{ document_type: 'funds', label: 'Proof of funds' }]);
          return Promise.resolve([ITEM]);
        },
      );
    const { res, lines, headers, raw } = makeRes();

    await makeController(rebuild).rebuildChecklist(
      DB,
      USER,
      'app-1',
      'application/x-ndjson',
      res,
    );

    const parsed = lines.map((l) => JSON.parse(l) as { type: string });
    expect(parsed.map((p) => p.type)).toEqual(['items', 'items', 'done']);
    expect(headers['Content-Type']).toContain('application/x-ndjson');
    // Without this the proxy holds every line until the response ends, which
    // is the entire thing this is trying to avoid.
    expect(headers['X-Accel-Buffering']).toBe('no');
    expect(raw.writableEnded).toBe(true);
  });

  it('lets a failure BEFORE any output keep its real status', async () => {
    // Authorization runs before any work, so a denial must still be a 403 and
    // not a 200 carrying an apology.
    const denied = new Error('Access denied');
    const rebuild = jest.fn().mockRejectedValue(denied);
    const { res, lines } = makeRes();

    await expect(
      makeController(rebuild).rebuildChecklist(
        DB,
        USER,
        'app-1',
        'application/x-ndjson',
        res,
      ),
    ).rejects.toThrow('Access denied');

    // Nothing written means the status line was still Nest's to set.
    expect(lines).toHaveLength(0);
  });

  it('reports a failure AFTER output inside the stream', async () => {
    // The status is long gone by then, so a client holding only previews must
    // be told they are not the finished list.
    const rebuild = jest
      .fn()
      .mockImplementation(
        (
          _db: unknown,
          _id: string,
          _user: string,
          onProgress?: (items: unknown[]) => void,
        ) => {
          onProgress?.([{ document_type: 'passport', label: 'Passport' }]);
          return Promise.reject(new Error('model exploded'));
        },
      );
    const { res, lines, raw } = makeRes();

    await makeController(rebuild).rebuildChecklist(
      DB,
      USER,
      'app-1',
      'application/x-ndjson',
      res,
    );

    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed.map((p) => p.type)).toEqual(['items', 'error']);
    expect(parsed[1].message).toBe('model exploded');
    // Crucially NOT 'done' — the client must not treat previews as the list.
    expect(raw.writableEnded).toBe(true);
  });
});
