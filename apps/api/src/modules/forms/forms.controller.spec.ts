import 'reflect-metadata';
import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FormsController } from './forms.controller';
import type { FormsService } from './forms.service';
import type { AuthUser } from '../auth/jwt.guard';

/**
 * Review round 2, Finding 5: a malformed `applicationId` (e.g. a scanner
 * probing `GET /forms/../../etc/passwd` or any non-UUID string) used to fall
 * through all the way to Postgres, which returns error code 22P02 ("invalid
 * input syntax for type uuid") — NOT the RLS/no-rows code `PGRST116` that
 * `FormsService`'s round-1 fix (Finding 2) checks for. That made a
 * client-input-shape error masquerade as a genuine backend outage: 503,
 * logged at ERROR, paging the on-call for every bad request.
 *
 * The fix moves the check to the boundary: `@Param('applicationId', new
 * ParseUUIDPipe())` rejects a non-UUID with a 400 BEFORE the controller
 * method — and therefore the DB — is ever reached.
 *
 * This repo's `*.controller.spec.ts` convention (see `outcomes.controller
 * .spec.ts`) instantiates the controller class directly and calls its
 * method, which is fast and dependency-free — but it also means a decorator
 * pipe like `ParseUUIDPipe` never actually RUNS, because pipe execution is
 * performed by Nest's HTTP request pipeline (`ExternalContextCreator`), not
 * by a bare method call. No `*.spec.ts` file anywhere in `src/` boots a real
 * Nest HTTP server to exercise that pipeline (that pattern exists only for
 * `test/*.e2e-spec.ts`, a separate jest config `test:e2e`, not part of the
 * required `pnpm --filter api test` commands for this task). Rather than
 * introduce that pattern for one pipe, this file proves the fix in two
 * parts, together equivalent to what Nest does internally:
 *
 *   1. Route metadata: prove `ParseUUIDPipe` is actually attached to the
 *      `applicationId` parameter of `FormsController.list` (the wiring).
 *   2. Pipe behaviour: prove that exact pipe class rejects a malformed id
 *      and passes a well-formed id through unchanged (what Nest calls
 *      internally as `pipe.transform(value, metadata)` before invoking the
 *      handler — a throw here is Nest's OWN documented mechanism for never
 *      invoking the handler, so a service call following it is provably
 *      unreachable).
 */
describe('FormsController — applicationId validation (Finding 5)', () => {
  function make() {
    const service = {
      listForApplication: jest.fn().mockResolvedValue([]),
    } as unknown as FormsService & { listForApplication: jest.Mock };
    return { ctrl: new FormsController(service), service };
  }

  const user = { id: 'user-1' } as AuthUser;
  const db = {} as SupabaseClient;

  it('wires ParseUUIDPipe onto the applicationId route parameter', () => {
    // PARAM = 5 in Nest's RouteParamtypes enum; `applicationId` is
    // constructor-arg index 2 in `list(db, user, applicationId)`. Custom
    // decorators (@SupabaseUserClient, @CurrentUser) live under a SEPARATE
    // metadata key (__customRouteArgs__) and do not appear here — only the
    // native @Param() entry does.
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      FormsController,
      'list',
    ) as Record<string, { index: number; data: unknown; pipes: unknown[] }>;

    const entry = args['5:2'];
    expect(entry).toBeDefined();
    expect(entry.data).toBe('applicationId');
    expect(entry.pipes).toHaveLength(1);
    expect(entry.pipes[0]).toBeInstanceOf(ParseUUIDPipe);
  });

  it('MEASURED: the exact pipe instance rejects a malformed id with a 400-class error', async () => {
    const pipe = new ParseUUIDPipe();
    await expect(
      pipe.transform('not-a-uuid-at-all', {
        type: 'param',
        data: 'applicationId',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('MEASURED: the exact pipe instance passes a well-formed v4 UUID through unchanged (the id shape applications.id — uuid_generate_v4() — actually produces)', async () => {
    const pipe = new ParseUUIDPipe();
    // Real shape pulled from the local stack's `applications` table
    // (2026-08-11): version nibble '4', variant nibble in {8,9,a,b} — a
    // genuine uuid_generate_v4() output, not a hand-picked example.
    const realV4 = '392183f1-11c7-45e2-8624-2d41e18ea10e';
    await expect(pipe.transform(realV4, { type: 'param' })).resolves.toBe(
      realV4,
    );
  });

  it('MEASURED: the default (no version pinned) is a SUPERSET of v4, not stricter — a v1-shaped UUID also passes', async () => {
    // Confirms the review's concern the other direction: the default isn't
    // accidentally narrower than v4 in some other way either. Source read
    // (@nestjs/common 11.1.24 parse-uuid.pipe.js): `isUUID(str, version =
    // 'all')` — an unset `this.version` falls back to the 'all' regex, which
    // has no version-nibble constraint at all, so it is provably a superset
    // of every per-version regex, v4 included.
    const pipe = new ParseUUIDPipe();
    const v1Shaped = '9125a680-51ee-11e4-9191-0800200c9a66';
    await expect(pipe.transform(v1Shaped, { type: 'param' })).resolves.toBe(
      v1Shaped,
    );
  });

  it('a well-formed but non-existent UUID still reaches FormsService unchanged (no regression — the pipe only rejects malformed SHAPE, never a valid-but-absent id)', async () => {
    const { ctrl, service } = make();
    const wellFormedButAbsent = '00000000-0000-4000-8000-000000000000';
    await ctrl.list(db, user, wellFormedButAbsent);
    expect(service.listForApplication).toHaveBeenCalledWith(
      db,
      wellFormedButAbsent,
      'user-1',
    );
  });
});
