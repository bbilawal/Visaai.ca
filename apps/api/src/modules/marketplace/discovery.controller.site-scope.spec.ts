import type { ConfigService } from '@nestjs/config';
import { DiscoveryController } from './discovery.controller';
import type { DiscoveryService } from './discovery.service';
import type { Env } from '../../config/configuration';

describe('DiscoveryController — Canada site scope', () => {
  function make(mode?: 'canada') {
    const discovery = { listConsultants: jest.fn().mockResolvedValue([]) };
    const config = mode
      ? ({ get: () => mode } as unknown as ConfigService<Env>)
      : undefined;
    const controller = new DiscoveryController(
      discovery as unknown as DiscoveryService,
      config,
    );
    return { controller, discovery };
  }

  it('canada: pins the browse filter to Canadian consultants', async () => {
    const { controller, discovery } = make('canada');
    await controller.list({ country: 'US' }, 'Bearer t');
    expect(discovery.listConsultants).toHaveBeenCalledWith(
      't',
      expect.objectContaining({ country: 'CA' }),
    );
  });

  it('global: passes the requested country through', async () => {
    const { controller, discovery } = make();
    await controller.list({ country: 'US' }, 'Bearer t');
    expect(discovery.listConsultants).toHaveBeenCalledWith(
      't',
      expect.objectContaining({ country: 'US' }),
    );
  });
});
