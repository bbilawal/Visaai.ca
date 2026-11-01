import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ReviewItemsController } from '../src/modules/review-items/review-items.controller';
import { ReviewItemsService } from '../src/modules/review-items/review-items.service';
import { JwtGuard } from '../src/modules/auth/jwt.guard';
import { ApplicationAccessGuard } from '../src/modules/auth/application-access.guard';
import { RolesGuard } from '../src/modules/auth/roles.guard';

/**
 * Review finding: a non-UUID item id reached Postgres, which rejected the cast
 * and the route answered 500. Malformed ids are a 400 at the edge.
 */
describe('ReviewItemsController — id validation', () => {
  let app: INestApplication;
  const svc = {
    openDocument: jest.fn().mockResolvedValue({ url: 'u', expiresIn: 300 }),
    editGenerated: jest.fn().mockResolvedValue({}),
  };

  beforeAll(async () => {
    const allow = {
      canActivate: (ctx: {
        switchToHttp: () => { getRequest: () => { user?: unknown } };
      }) => {
        ctx.switchToHttp().getRequest().user = {
          id: 'c1',
          appRole: 'consultant',
        };
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [ReviewItemsController],
      providers: [{ provide: ReviewItemsService, useValue: svc }],
    })
      .overrideGuard(JwtGuard)
      .useValue(allow)
      .overrideGuard(ApplicationAccessGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  const UUID = '0e0a6a4c-c495-4798-a609-49337626e6ef';

  it('400s a malformed document id without calling the service', async () => {
    await request(app.getHttpServer())
      .get(`/applications/${UUID}/review-items/documents/not-a-uuid/url`)
      .expect(400);
    expect(svc.openDocument).not.toHaveBeenCalled();
  });

  it('400s a malformed generated id', async () => {
    await request(app.getHttpServer())
      .put(`/applications/${UUID}/review-items/generated/nope`)
      .send({ contentMd: 'x' })
      .expect(400);
    expect(svc.editGenerated).not.toHaveBeenCalled();
  });

  it('400s a malformed application id', async () => {
    await request(app.getHttpServer())
      .get(`/applications/nope/review-items/documents/${UUID}/url`)
      .expect(400);
  });

  it('passes well-formed ids through', async () => {
    await request(app.getHttpServer())
      .get(`/applications/${UUID}/review-items/documents/${UUID}/url`)
      .expect(200);
    expect(svc.openDocument).toHaveBeenCalledWith(
      UUID,
      UUID,
      expect.objectContaining({ id: 'c1' }),
    );
  });
});
