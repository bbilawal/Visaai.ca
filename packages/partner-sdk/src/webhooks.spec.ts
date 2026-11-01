import { createHmac } from 'node:crypto';
import { VisaAiSignatureError } from './errors';
import { isValidWebhook, verifyWebhook } from './webhooks';

/**
 * The SDK verifier must accept exactly what the server signs and nothing else.
 * The fixtures below are built with the same construction the server uses
 * (`<timestamp>.<raw body>`), so a change on either side breaks this test
 * before it breaks a partner.
 */
const SECRET = 'whsec_abc123';
const NOW = 1_754_400_000;
const BODY = JSON.stringify({
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  type: 'application.created',
  created_at: '2026-08-06T00:00:00.000Z',
  environment: 'live',
  sequence: 42,
  data: { status: 'draft' },
});

function sign(body: string, secret: string, ts: number): string {
  const v1 = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${v1}`;
}

describe('verifyWebhook', () => {
  it('accepts and parses a correctly signed payload', () => {
    const payload = verifyWebhook(BODY, sign(BODY, SECRET, NOW), SECRET, {
      nowSeconds: NOW,
    });
    expect(payload.type).toBe('application.created');
    expect(payload.sequence).toBe(42);
  });

  it('rejects a tampered body', () => {
    const header = sign(BODY, SECRET, NOW);
    const tampered = BODY.replace('draft', 'ready');
    expect(() =>
      verifyWebhook(tampered, header, SECRET, { nowSeconds: NOW }),
    ).toThrow(VisaAiSignatureError);
  });

  it('rejects the wrong secret', () => {
    expect(() =>
      verifyWebhook(BODY, sign(BODY, SECRET, NOW), 'whsec_other', {
        nowSeconds: NOW,
      }),
    ).toThrow(/no matching signature/);
  });

  // Replay protection.
  it('rejects a payload replayed after the tolerance window', () => {
    expect(() =>
      verifyWebhook(BODY, sign(BODY, SECRET, NOW), SECRET, {
        nowSeconds: NOW + 301,
      }),
    ).toThrow(/tolerance/);
  });

  it('accepts inside the tolerance window', () => {
    expect(
      verifyWebhook(BODY, sign(BODY, SECRET, NOW), SECRET, {
        nowSeconds: NOW + 299,
      }),
    ).toBeDefined();
  });

  it('rejects a far-future timestamp', () => {
    expect(() =>
      verifyWebhook(BODY, sign(BODY, SECRET, NOW + 10_000), SECRET, {
        nowSeconds: NOW,
      }),
    ).toThrow(/tolerance/);
  });

  it('honours a custom tolerance', () => {
    expect(() =>
      verifyWebhook(BODY, sign(BODY, SECRET, NOW), SECRET, {
        nowSeconds: NOW + 60,
        toleranceSeconds: 10,
      }),
    ).toThrow(/tolerance/);
  });

  it.each([
    ['empty', ''],
    ['no timestamp', 'v1=abc'],
    ['no signature', `t=${NOW}`],
    ['garbage', 'nonsense'],
    ['non-numeric timestamp', 't=abc,v1=def'],
  ])('rejects a malformed header (%s)', (_label, header) => {
    expect(() => verifyWebhook(BODY, header, SECRET, { nowSeconds: NOW })).toThrow(
      /malformed/,
    );
  });

  // Rotation: during the overlap the server sends two v1 values.
  it('accepts a payload signed with either secret during rotation', () => {
    const oldSig = createHmac('sha256', 'whsec_old')
      .update(`${NOW}.${BODY}`)
      .digest('hex');
    const newSig = createHmac('sha256', 'whsec_new')
      .update(`${NOW}.${BODY}`)
      .digest('hex');
    const header = `t=${NOW},v1=${oldSig},v1=${newSig}`;

    expect(
      verifyWebhook(BODY, header, 'whsec_old', { nowSeconds: NOW }),
    ).toBeDefined();
    expect(
      verifyWebhook(BODY, header, 'whsec_new', { nowSeconds: NOW }),
    ).toBeDefined();
  });

  it('ignores an unknown signature version', () => {
    const v1 = createHmac('sha256', SECRET).update(`${NOW}.${BODY}`).digest('hex');
    expect(
      verifyWebhook(BODY, `t=${NOW},v1=${v1},v2=future`, SECRET, {
        nowSeconds: NOW,
      }),
    ).toBeDefined();
  });

  it('tolerates whitespace in the header', () => {
    const v1 = createHmac('sha256', SECRET).update(`${NOW}.${BODY}`).digest('hex');
    expect(
      verifyWebhook(BODY, ` t=${NOW} , v1=${v1} `, SECRET, { nowSeconds: NOW }),
    ).toBeDefined();
  });

  // Re-stringifying a parsed body can reorder keys; the signature covers bytes.
  it('fails when the body was parsed and re-serialised with different key order', () => {
    const header = sign(BODY, SECRET, NOW);
    const reordered = JSON.stringify({
      data: { status: 'draft' },
      sequence: 42,
      environment: 'live',
      created_at: '2026-08-06T00:00:00.000Z',
      type: 'application.created',
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    });
    expect(() =>
      verifyWebhook(reordered, header, SECRET, { nowSeconds: NOW }),
    ).toThrow(VisaAiSignatureError);
  });
});

describe('isValidWebhook', () => {
  it('returns true for a valid payload', () => {
    expect(
      isValidWebhook(BODY, sign(BODY, SECRET, NOW), SECRET, { nowSeconds: NOW }),
    ).toBe(true);
  });

  it('returns false instead of throwing', () => {
    expect(isValidWebhook(BODY, 'garbage', SECRET, { nowSeconds: NOW })).toBe(false);
  });
});
