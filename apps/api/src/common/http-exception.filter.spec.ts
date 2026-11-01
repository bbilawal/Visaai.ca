import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

/**
 * The envelope used to drop everything but `message`. PATCH visa-type refuses
 * an ineligible route with `code: 'ROUTE_INELIGIBLE'` and the right route's id,
 * and the web selector keys its message on that code — so in prod
 * (2026-10-16) a refused eTA showed the generic "could not save" instead of
 * "Citizens of Pakistan need a visitor visa (TRV)…".
 */
function run(exception: unknown) {
  let status = 0;
  let body: Record<string, unknown> = {};
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        status: (c: number) => {
          status = c;
          return {
            json: (b: Record<string, unknown>) => {
              body = b;
            },
          };
        },
      }),
      getRequest: () => ({ url: '/x', method: 'PATCH' }),
    }),
  };
  new AllExceptionsFilter().catch(exception, host as never);
  return { status, body };
}

describe('AllExceptionsFilter', () => {
  it('keeps a machine-readable code and its structured fields', () => {
    const { status, body } = run(
      new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'ROUTE_INELIGIBLE',
        message: 'Citizens of Pakistan need a visitor visa (TRV).',
        eligibility: 'ineligible',
        recommendedVisaaiId: 'ca-visitor-visa-temporary-resident-visa',
      }),
    );
    expect(status).toBe(400);
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'ROUTE_INELIGIBLE',
      message: 'Citizens of Pakistan need a visitor visa (TRV).',
      details: {
        eligibility: 'ineligible',
        recommendedVisaaiId: 'ca-visitor-visa-temporary-resident-visa',
      },
    });
  });

  it('leaves a plain exception’s envelope as it was', () => {
    const { body } = run(new NotFoundException('nope'));
    expect(body).toMatchObject({ statusCode: 404, message: 'nope' });
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('details');
  });

  it('never exposes a 5xx message or code', () => {
    const { status, body } = run(new Error('internal detail'));
    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(body).not.toHaveProperty('code');
  });
});
