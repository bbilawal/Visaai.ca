import type { PartnerPrincipal } from '@visaai/types';
import { InMemoryPartnerRepository } from './in-memory-partner.repository';
import { idempotencyRequestHash } from './partner-governance';
import { PartnerIdempotencyService } from './partner-idempotency.service';

describe('PartnerIdempotencyService', () => {
  let repo: InMemoryPartnerRepository;
  let service: PartnerIdempotencyService;

  const supabase = { admin: {} } as never;

  const principal: PartnerPrincipal = {
    partnerId: 'p1',
    organizationId: 'org-1',
    applicationId: 'app-1',
    clientId: 'c1',
    environment: 'live',
    scopes: ['applications:write'],
    credentialKind: 'api_key',
    credentialId: 'k1',
    subjectUserId: null,
  };

  beforeEach(() => {
    repo = new InMemoryPartnerRepository();
    service = new PartnerIdempotencyService(supabase, repo);
  });

  it('runs the operation when no key is supplied', async () => {
    const operation = jest.fn().mockResolvedValue({ id: 'a' });
    const result = await service.run(
      principal,
      undefined,
      'POST',
      '/v1/applications',
      {},
      operation,
    );
    expect(result).toEqual({ id: 'a' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('runs the operation on a fresh key', async () => {
    const operation = jest.fn().mockResolvedValue({ id: 'a' });
    await service.run(
      principal,
      'k-1',
      'POST',
      '/v1/applications',
      {},
      operation,
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  // The behaviour the whole mechanism exists for.
  it('returns the stored response instead of running twice', async () => {
    const operation = jest.fn().mockResolvedValue({ id: 'a' });
    const first = await service.run(
      principal,
      'k-1',
      'POST',
      '/v1/applications',
      { country: 'CA' },
      operation,
    );
    const second = await service.run(
      principal,
      'k-1',
      'POST',
      '/v1/applications',
      { country: 'CA' },
      operation,
    );
    expect(second).toEqual(first);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('ignores body key ordering when matching', async () => {
    const operation = jest.fn().mockResolvedValue({ id: 'a' });
    await service.run(
      principal,
      'k-1',
      'POST',
      '/v1/applications',
      { a: 1, b: 2 },
      operation,
    );
    await service.run(
      principal,
      'k-1',
      'POST',
      '/v1/applications',
      { b: 2, a: 1 },
      operation,
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('rejects the same key with a different body', async () => {
    const operation = jest.fn().mockResolvedValue({ id: 'a' });
    await service.run(
      principal,
      'k-1',
      'POST',
      '/v1/applications',
      { country: 'CA' },
      operation,
    );
    await expect(
      service.run(
        principal,
        'k-1',
        'POST',
        '/v1/applications',
        { country: 'AU' },
        operation,
      ),
    ).rejects.toMatchObject({ code: 'idempotency_key_reuse' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('rejects the same key on a different route', async () => {
    const operation = jest.fn().mockResolvedValue({ id: 'a' });
    await service.run(
      principal,
      'k-1',
      'POST',
      '/v1/applications',
      {},
      operation,
    );
    await expect(
      service.run(principal, 'k-1', 'POST', '/v1/webhooks', {}, operation),
    ).rejects.toMatchObject({ code: 'idempotency_key_reuse' });
  });

  // Keys are per application, so two partners choosing "order-1" do not
  // collide.
  it('scopes keys to the application', async () => {
    const operation = jest.fn().mockResolvedValue({ id: 'a' });
    await service.run(
      principal,
      'k-1',
      'POST',
      '/v1/applications',
      {},
      operation,
    );
    await service.run(
      { ...principal, applicationId: 'app-2' },
      'k-1',
      'POST',
      '/v1/applications',
      {},
      operation,
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('reports 409 while a request with the same key is still in flight', async () => {
    // Claim without completing, as a crashed or concurrent request would.
    await repo.claimIdempotencyKey(
      null,
      'app-1',
      'k-1',
      idempotencyRequestHash('POST', '/v1/applications', {}),
      '/v1/applications',
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    const operation = jest.fn();
    await expect(
      service.run(principal, 'k-1', 'POST', '/v1/applications', {}, operation),
    ).rejects.toMatchObject({ code: 'idempotency_in_progress' });
    expect(operation).not.toHaveBeenCalled();
  });

  // A transient failure must not poison the key for 24 hours.
  it('releases the key when the operation throws, so a retry can succeed', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('upstream down'));
    await expect(
      service.run(principal, 'k-1', 'POST', '/v1/applications', {}, failing),
    ).rejects.toThrow('upstream down');

    const succeeding = jest.fn().mockResolvedValue({ id: 'a' });
    const result = await service.run(
      principal,
      'k-1',
      'POST',
      '/v1/applications',
      {},
      succeeding,
    );
    expect(result).toEqual({ id: 'a' });
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['too long', 'a'.repeat(256)],
    ['with a space', 'bad key'],
    ['with a slash', 'bad/key'],
  ])('rejects a malformed key (%s)', async (_label, key) => {
    const operation = jest.fn();
    await expect(
      service.run(principal, key, 'POST', '/v1/applications', {}, operation),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(operation).not.toHaveBeenCalled();
  });

  // An empty header is an absent header, not a malformed key: rejecting it
  // would fail requests from clients that send the header unconditionally.
  it('treats an empty key as no key', async () => {
    const operation = jest.fn().mockResolvedValue({ id: 'a' });
    await expect(
      service.run(principal, '', 'POST', '/v1/applications', {}, operation),
    ).resolves.toEqual({ id: 'a' });
  });
});
