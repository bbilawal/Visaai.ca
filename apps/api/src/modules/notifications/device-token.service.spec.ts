import { BadRequestException } from '@nestjs/common';
import { DeviceTokenService } from './device-token.service';
import type { IDeviceTokenRepository } from './device-token.repository';
import type { SupabaseService } from '../shared/supabase/supabase.service';

function make(): {
  svc: DeviceTokenService;
  repo: jest.Mocked<IDeviceTokenRepository>;
  forUser: jest.Mock;
} {
  const repo = {
    upsert: jest.fn().mockResolvedValue({ id: 'd1' }),
    listForUser: jest.fn().mockResolvedValue([]),
    deleteByToken: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IDeviceTokenRepository>;
  const forUser = jest.fn().mockReturnValue({ __scoped: true });
  const supabase = {
    forUser,
    admin: { __admin: true },
  } as unknown as SupabaseService;
  return { svc: new DeviceTokenService(repo, supabase), repo, forUser };
}

const caller = { id: 'user-1' };

describe('DeviceTokenService', () => {
  it('writes through the RLS-scoped client, never the service-role client', async () => {
    const { svc, repo, forUser } = make();
    await svc.register('jwt-abc', caller, { token: 'tok', platform: 'ios' });
    expect(forUser).toHaveBeenCalledWith('jwt-abc');
    expect(repo.upsert).toHaveBeenCalledWith(
      { __scoped: true },
      expect.objectContaining({
        userId: 'user-1',
        token: 'tok',
        platform: 'ios',
      }),
    );
  });

  it('rejects an empty token', async () => {
    const { svc } = make();
    await expect(
      svc.register('jwt', caller, { token: '   ', platform: 'ios' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown platform', async () => {
    const { svc } = make();
    await expect(
      svc.register('jwt', caller, { token: 'tok', platform: 'web' as 'ios' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an oversized token instead of letting the DB do it', async () => {
    const { svc } = make();
    await expect(
      svc.register('jwt', caller, {
        token: 'x'.repeat(513),
        platform: 'android',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clamps a hostile device name and normalises blanks to null', async () => {
    const { svc, repo } = make();
    await svc.register('jwt', caller, {
      token: 'tok',
      platform: 'android',
      deviceName: 'n'.repeat(500),
      appVersion: '   ',
    });
    const input = repo.upsert.mock.calls[0][1];
    expect(input.deviceName).toHaveLength(120);
    expect(input.appVersion).toBeNull();
  });

  it('unregister goes through the scoped client so RLS bounds the delete', async () => {
    const { svc, repo, forUser } = make();
    await svc.unregister('jwt-abc', caller, 'tok');
    expect(forUser).toHaveBeenCalledWith('jwt-abc');
    expect(repo.deleteByToken).toHaveBeenCalledWith({ __scoped: true }, 'tok');
  });

  it('unregister rejects a missing token', async () => {
    const { svc } = make();
    await expect(svc.unregister('jwt', caller, '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
