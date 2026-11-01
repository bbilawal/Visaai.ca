import {
  AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES,
  backoffSeconds,
  buildSignatureHeader,
  computeSignature,
  decideNextDelivery,
  DEFAULT_TOLERANCE_SECONDS,
  MAX_DELIVERY_ATTEMPTS,
  parseSignatureHeader,
  shouldAutoDisable,
  signedPayload,
  verifySignature,
} from './partner-webhook-signature';

const SECRET = 'whsec_test_secret_value';
const OTHER_SECRET = 'whsec_other_secret_value';
const BODY = '{"id":"evt_1","type":"application.created"}';
const NOW = 1_754_400_000;

describe('signature construction', () => {
  it('signs the timestamp together with the body', () => {
    expect(signedPayload(NOW, BODY)).toBe(`${NOW}.${BODY}`);
  });

  it('produces a stable hex signature', () => {
    const a = computeSignature(BODY, SECRET, NOW);
    const b = computeSignature(BODY, SECRET, NOW);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the body changes', () => {
    expect(computeSignature(BODY, SECRET, NOW)).not.toBe(
      computeSignature(`${BODY} `, SECRET, NOW),
    );
  });

  it('changes when the timestamp changes', () => {
    expect(computeSignature(BODY, SECRET, NOW)).not.toBe(
      computeSignature(BODY, SECRET, NOW + 1),
    );
  });

  it('builds a header with the timestamp and one signature per secret', () => {
    const header = buildSignatureHeader(BODY, [SECRET, OTHER_SECRET], NOW);
    expect(header).toBe(
      `t=${NOW},v1=${computeSignature(BODY, SECRET, NOW)},v1=${computeSignature(BODY, OTHER_SECRET, NOW)}`,
    );
  });
});

describe('header parsing', () => {
  it('parses a well-formed header', () => {
    const parsed = parseSignatureHeader(`t=${NOW},v1=abc123`);
    expect(parsed).toEqual({ timestamp: NOW, signatures: ['abc123'] });
  });

  it('tolerates whitespace and ordering', () => {
    const parsed = parseSignatureHeader(` v1=ABCDEF , t=${NOW} `);
    expect(parsed).toEqual({ timestamp: NOW, signatures: ['abcdef'] });
  });

  // Forward compatibility: a v2 scheme must not break a v1 verifier.
  it('ignores unknown scheme versions', () => {
    const parsed = parseSignatureHeader(`t=${NOW},v1=abc,v2=def`);
    expect(parsed).toEqual({ timestamp: NOW, signatures: ['abc'] });
  });

  it.each([
    ['empty', ''],
    ['no timestamp', 'v1=abc'],
    ['no signature', `t=${NOW}`],
    ['non-numeric timestamp', 't=yesterday,v1=abc'],
    ['non-hex signature', `t=${NOW},v1=zzz!`],
    ['bare token', 'garbage'],
  ])('rejects a malformed header (%s)', (_label, header) => {
    expect(parseSignatureHeader(header)).toBeNull();
  });
});

describe('verification', () => {
  const header = buildSignatureHeader(BODY, [SECRET], NOW);

  it('accepts a correctly signed payload', () => {
    expect(verifySignature(BODY, header, [SECRET], NOW)).toEqual({
      valid: true,
      reason: null,
    });
  });

  it('rejects a modified body', () => {
    const result = verifySignature(`${BODY}x`, header, [SECRET], NOW);
    expect(result).toEqual({ valid: false, reason: 'no_matching_signature' });
  });

  it('rejects the wrong secret', () => {
    expect(verifySignature(BODY, header, [OTHER_SECRET], NOW).valid).toBe(
      false,
    );
  });

  it('rejects a malformed header', () => {
    expect(verifySignature(BODY, 'nonsense', [SECRET], NOW)).toEqual({
      valid: false,
      reason: 'malformed_header',
    });
  });

  it('accepts a timestamp inside the tolerance window', () => {
    const almost = NOW + DEFAULT_TOLERANCE_SECONDS;
    expect(verifySignature(BODY, header, [SECRET], almost).valid).toBe(true);
  });

  // Replay protection: this is the property the timestamp exists for.
  it('rejects a captured payload replayed after the tolerance window', () => {
    const later = NOW + DEFAULT_TOLERANCE_SECONDS + 1;
    expect(verifySignature(BODY, header, [SECRET], later)).toEqual({
      valid: false,
      reason: 'timestamp_outside_tolerance',
    });
  });

  // Both directions: a far-future timestamp would otherwise mint a payload
  // that stays replayable indefinitely.
  it('rejects a timestamp too far in the future', () => {
    const future = buildSignatureHeader(BODY, [SECRET], NOW + 10_000);
    expect(verifySignature(BODY, future, [SECRET], NOW).reason).toBe(
      'timestamp_outside_tolerance',
    );
  });

  it('honours a custom tolerance', () => {
    expect(verifySignature(BODY, header, [SECRET], NOW + 30, 10).valid).toBe(
      false,
    );
    expect(verifySignature(BODY, header, [SECRET], NOW + 30, 60).valid).toBe(
      true,
    );
  });

  // Rotation: old and new secrets both verify during the overlap window.
  it('accepts either secret during rotation', () => {
    const dual = buildSignatureHeader(BODY, [SECRET, OTHER_SECRET], NOW);
    expect(verifySignature(BODY, dual, [SECRET], NOW).valid).toBe(true);
    expect(verifySignature(BODY, dual, [OTHER_SECRET], NOW).valid).toBe(true);
  });

  it('accepts when the receiver holds several candidate secrets', () => {
    expect(
      verifySignature(BODY, header, [OTHER_SECRET, SECRET], NOW).valid,
    ).toBe(true);
  });

  it('rejects when the receiver holds no secrets', () => {
    expect(verifySignature(BODY, header, [], NOW).valid).toBe(false);
  });
});

describe('backoff', () => {
  it('grows exponentially', () => {
    const noJitter = () => 1;
    expect(backoffSeconds(1, noJitter)).toBe(10);
    expect(backoffSeconds(2, noJitter)).toBe(20);
    expect(backoffSeconds(3, noJitter)).toBe(40);
  });

  it('keeps a floor of half the exponential delay', () => {
    expect(backoffSeconds(3, () => 0)).toBe(20);
  });

  it('caps the delay at six hours', () => {
    expect(backoffSeconds(50, () => 1)).toBe(6 * 3600);
  });

  // Without jitter every delivery that failed in one outage retries at the
  // same instant and recreates the outage.
  it('spreads retries across the jitter range', () => {
    const low = backoffSeconds(5, () => 0);
    const high = backoffSeconds(5, () => 1);
    expect(low).toBeLessThan(high);
  });

  it('never returns a negative delay for attempt zero', () => {
    expect(backoffSeconds(0, () => 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('delivery decisions', () => {
  const noJitter = () => 1;

  it.each([200, 201, 202, 204, 299])('treats %i as delivered', (statusCode) => {
    expect(
      decideNextDelivery({ statusCode, networkError: false }, 1, noJitter),
    ).toEqual({ next: 'delivered' });
  });

  it('retries a 500', () => {
    expect(
      decideNextDelivery({ statusCode: 500, networkError: false }, 1, noJitter),
    ).toEqual({ next: 'retry', delaySeconds: 10 });
  });

  it('retries a network error', () => {
    const decision = decideNextDelivery(
      { statusCode: null, networkError: true },
      2,
      noJitter,
    );
    expect(decision).toEqual({ next: 'retry', delaySeconds: 20 });
  });

  // A partner mid-deploy returns 404 or 401. Giving up on the first one loses
  // real events, so 4xx is retried like anything else.
  it.each([400, 401, 403, 404, 422, 429])('retries a %i', (statusCode) => {
    expect(
      decideNextDelivery({ statusCode, networkError: false }, 1, noJitter).next,
    ).toBe('retry');
  });

  // 410 Gone is the one explicit "stop sending". Honouring it is what
  // separates a webhook system from a denial-of-service.
  it('stops permanently on 410 Gone', () => {
    expect(
      decideNextDelivery({ statusCode: 410, networkError: false }, 1, noJitter),
    ).toEqual({ next: 'dead', reason: 'endpoint returned 410 Gone' });
  });

  it('gives up after the attempt budget', () => {
    const decision = decideNextDelivery(
      { statusCode: 500, networkError: false },
      MAX_DELIVERY_ATTEMPTS,
      noJitter,
    );
    expect(decision).toEqual({
      next: 'dead',
      reason: `exhausted ${MAX_DELIVERY_ATTEMPTS} attempts`,
    });
  });

  it('does not treat a 2xx as dead even at the attempt budget', () => {
    expect(
      decideNextDelivery(
        { statusCode: 200, networkError: false },
        MAX_DELIVERY_ATTEMPTS,
        noJitter,
      ),
    ).toEqual({ next: 'delivered' });
  });

  it('treats a network error with a stale status code as a failure', () => {
    expect(
      decideNextDelivery({ statusCode: 200, networkError: true }, 1, noJitter)
        .next,
    ).toBe('retry');
  });
});

describe('auto-disable', () => {
  it('disables at the consecutive-failure threshold', () => {
    expect(shouldAutoDisable(AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES)).toBe(
      true,
    );
  });

  it('leaves an endpoint enabled below the threshold', () => {
    expect(shouldAutoDisable(AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES - 1)).toBe(
      false,
    );
  });

  it('leaves a healthy endpoint alone', () => {
    expect(shouldAutoDisable(0)).toBe(false);
  });
});
