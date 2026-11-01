import { ForbiddenException } from '@nestjs/common';
import { MessagingRepository } from './messaging.repository.impl';

/**
 * Stub for the two query chains insertConversation touches:
 *   db.from('conversations').insert(row).select('*').single()          // the INSERT
 *   db.from('conversations').select('*').eq(...).maybeSingle()         // the re-read
 * `insertError` drives the INSERT result; `selectRow` drives the re-read.
 */
function makeDb(opts: {
  insertError?: { code?: string; message?: string } | null;
  insertRow?: Record<string, unknown>;
  selectRow?: Record<string, unknown> | null;
}) {
  const db = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: opts.insertError
                      ? null
                      : (opts.insertRow ?? {
                          id: 'conv-new',
                          application_id: 'app-1',
                        }),
                    error: opts.insertError ?? null,
                  });
                },
              };
            },
          };
        },
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  return Promise.resolve({
                    data: opts.selectRow ?? null,
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };

  return db as any;
}

describe('MessagingRepository.insertConversation — concurrent get-or-create race', () => {
  const repo = new MessagingRepository();

  it('returns the winner row when the INSERT loses a race (Postgres 23505)', async () => {
    const existing = { id: 'conv-winner', application_id: 'app-1' };
    const db = makeDb({
      insertError: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "conversations_application_id_key"',
      },
      selectRow: existing,
    });
    await expect(repo.insertConversation(db, 'app-1')).resolves.toEqual(
      existing,
    );
  });

  it('maps an RLS denial (42501) to ForbiddenException, not a 500', async () => {
    const db = makeDb({
      insertError: { code: '42501', message: 'rls denied' },
      selectRow: null,
    });
    await expect(repo.insertConversation(db, 'app-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('still throws a plain Error for other insert errors', async () => {
    const db = makeDb({
      insertError: { code: '23502', message: 'not null' },
      selectRow: null,
    });
    const err = await repo.insertConversation(db, 'app-1').catch((e) => e);
    expect(err).not.toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe('not null');
  });

  it('returns the inserted row on the happy path', async () => {
    const db = makeDb({
      insertRow: { id: 'conv-new', application_id: 'app-1' },
    });
    await expect(repo.insertConversation(db, 'app-1')).resolves.toMatchObject({
      id: 'conv-new',
    });
  });
});
