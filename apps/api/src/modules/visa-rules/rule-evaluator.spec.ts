import {
  evaluateRule,
  explainRule,
  factsUsed,
  validateRule,
} from './rule-evaluator';
import type { RuleNode } from './rule.types';

describe('validateRule', () => {
  it('accepts the rule shapes the spec requires', () => {
    const rules: RuleNode[] = [
      { fact: 'nationality', op: 'in', value: ['IN', 'PK'] },
      { fact: 'residence_country', op: 'eq', value: 'AE' },
      { fact: 'age', op: 'lt', value: 18 },
      { fact: 'has_sponsor', op: 'eq', value: true },
      { fact: 'has_dependants', op: 'exists' },
      { fact: 'stay_duration_days', op: 'gt', value: 90 },
      { fact: 'visa_subclass', op: 'eq', value: '600' },
      {
        all: [
          { fact: 'nationality', op: 'in', value: ['IN'] },
          {
            any: [
              { fact: 'age', op: 'lt', value: 18 },
              { fact: 'has_sponsor', op: 'eq', value: true },
            ],
          },
        ],
      },
      { not: { fact: 'has_insurance', op: 'eq', value: true } },
    ];
    for (const r of rules) expect(validateRule(r)).toEqual([]);
  });

  it('rejects an unknown fact', () => {
    const errs = validateRule({
      fact: 'favourite_colour',
      op: 'eq',
      value: 'blue',
    });
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('unknown fact');
  });

  it('rejects an unknown operator', () => {
    const errs = validateRule({ fact: 'age', op: 'approximately', value: 18 });
    expect(errs[0].message).toContain('unknown operator');
  });

  it('rejects a numeric operator given a string', () => {
    const errs = validateRule({ fact: 'age', op: 'lt', value: 'eighteen' });
    expect(errs[0].message).toContain('numeric');
  });

  it('rejects in/nin without a non-empty array', () => {
    expect(
      validateRule({ fact: 'nationality', op: 'in', value: 'IN' })[0].message,
    ).toContain('array');
    expect(
      validateRule({ fact: 'nationality', op: 'in', value: [] })[0].message,
    ).toContain('array');
  });

  it('rejects an empty combinator rather than treating it as vacuously true', () => {
    // `all: []` evaluating true would silently make a conditional requirement
    // unconditional — the exact class of bug this layer exists to prevent.
    expect(validateRule({ all: [] })[0].message).toContain('non-empty');
    expect(validateRule({ any: [] })[0].message).toContain('non-empty');
  });

  it('rejects a combinator mixed with other keys', () => {
    const errs = validateRule({
      all: [{ fact: 'age', op: 'lt', value: 18 }],
      fact: 'age',
    });
    expect(errs.some((e) => e.message.includes('only key'))).toBe(true);
  });

  it('reports the path of a nested error', () => {
    const errs = validateRule({
      all: [
        { fact: 'age', op: 'lt', value: 18 },
        { fact: 'nope', op: 'eq', value: 1 },
      ],
    });
    expect(errs[0].path).toBe('$.all[1].fact');
  });

  it('rejects non-object rules', () => {
    expect(validateRule('always')).toHaveLength(1);
    expect(validateRule(null)).toHaveLength(1);
    expect(validateRule([{ fact: 'age', op: 'lt', value: 18 }])).toHaveLength(
      1,
    );
  });
});

describe('evaluateRule', () => {
  it('treats a null rule as unconditional', () => {
    expect(evaluateRule(null, {})).toBe('true');
    expect(evaluateRule(undefined, {})).toBe('true');
  });

  it('evaluates nationality membership', () => {
    const rule: RuleNode = {
      fact: 'nationality',
      op: 'in',
      value: ['IN', 'PK'],
    };
    expect(evaluateRule(rule, { nationality: 'IN' })).toBe('true');
    expect(evaluateRule(rule, { nationality: 'FR' })).toBe('false');
  });

  it('compares country codes case-insensitively', () => {
    // Nationality reaches this layer from intake answers, OCR extraction and
    // the partner API, none of which agree on casing.
    const rule: RuleNode = { fact: 'nationality', op: 'in', value: ['IN'] };
    expect(evaluateRule(rule, { nationality: 'in' })).toBe('true');
    expect(evaluateRule(rule, { nationality: ' In ' })).toBe('true');
  });

  it('evaluates numeric comparisons including boundaries', () => {
    const under18: RuleNode = { fact: 'age', op: 'lt', value: 18 };
    expect(evaluateRule(under18, { age: 17 })).toBe('true');
    expect(evaluateRule(under18, { age: 18 })).toBe('false');
    const over90: RuleNode = {
      fact: 'stay_duration_days',
      op: 'gt',
      value: 90,
    };
    expect(evaluateRule(over90, { stay_duration_days: 90 })).toBe('false');
    expect(evaluateRule(over90, { stay_duration_days: 91 })).toBe('true');
  });

  it('coerces numeric strings, because form inputs arrive as strings', () => {
    expect(
      evaluateRule({ fact: 'age', op: 'lt', value: 18 }, { age: '17' }),
    ).toBe('true');
  });

  it('returns unknown for a missing fact rather than false', () => {
    // The whole point of the three-valued verdict: a requirement gated on a
    // question the applicant has not reached must not disappear from the
    // checklist and let them believe they are ready.
    expect(evaluateRule({ fact: 'age', op: 'lt', value: 18 }, {})).toBe(
      'unknown',
    );
    expect(
      evaluateRule({ fact: 'nationality', op: 'in', value: ['IN'] }, {}),
    ).toBe('unknown');
  });

  it('returns unknown when a numeric rule meets a non-numeric answer', () => {
    expect(
      evaluateRule({ fact: 'age', op: 'lt', value: 18 }, { age: 'unsure' }),
    ).toBe('unknown');
  });

  it('treats empty string as absent', () => {
    expect(
      evaluateRule(
        { fact: 'nationality', op: 'eq', value: 'IN' },
        { nationality: '' },
      ),
    ).toBe('unknown');
  });

  it('handles exists / not_exists without needing the value', () => {
    const rule: RuleNode = { fact: 'has_sponsor', op: 'exists' };
    expect(evaluateRule(rule, { has_sponsor: true })).toBe('true');
    expect(evaluateRule(rule, { has_sponsor: false })).toBe('true');
    expect(evaluateRule(rule, {})).toBe('false');
    expect(evaluateRule({ fact: 'has_sponsor', op: 'not_exists' }, {})).toBe(
      'true',
    );
  });

  it('applies Kleene AND: a known false beats an unknown', () => {
    const rule: RuleNode = {
      all: [
        { fact: 'nationality', op: 'in', value: ['IN'] },
        { fact: 'age', op: 'lt', value: 18 },
      ],
    };
    // Nationality rules it out; the missing age cannot bring it back.
    expect(evaluateRule(rule, { nationality: 'FR' })).toBe('false');
    // Nationality matches but age is unanswered — genuinely undetermined.
    expect(evaluateRule(rule, { nationality: 'IN' })).toBe('unknown');
    expect(evaluateRule(rule, { nationality: 'IN', age: 12 })).toBe('true');
  });

  it('applies Kleene OR: a known true beats an unknown', () => {
    const rule: RuleNode = {
      any: [
        { fact: 'has_sponsor', op: 'eq', value: true },
        { fact: 'has_dependants', op: 'eq', value: true },
      ],
    };
    expect(evaluateRule(rule, { has_sponsor: true })).toBe('true');
    expect(evaluateRule(rule, { has_sponsor: false })).toBe('unknown');
    expect(
      evaluateRule(rule, { has_sponsor: false, has_dependants: false }),
    ).toBe('false');
  });

  it('propagates unknown through not', () => {
    expect(
      evaluateRule(
        { not: { fact: 'has_insurance', op: 'eq', value: true } },
        {},
      ),
    ).toBe('unknown');
    expect(
      evaluateRule(
        { not: { fact: 'has_insurance', op: 'eq', value: true } },
        { has_insurance: true },
      ),
    ).toBe('false');
    expect(
      evaluateRule(
        { not: { fact: 'has_insurance', op: 'eq', value: true } },
        { has_insurance: false },
      ),
    ).toBe('true');
  });

  it('evaluates contains against arrays and strings', () => {
    expect(
      evaluateRule(
        { fact: 'occupation', op: 'contains', value: 'nurse' },
        { occupation: 'Registered Nurse' },
      ),
    ).toBe('true');
    expect(
      evaluateRule(
        { fact: 'purpose', op: 'contains', value: 'study' },
        { purpose: ['tourism', 'study'] },
      ),
    ).toBe('true');
  });

  it('never throws on a malformed rule', () => {
    // Evaluation runs inside checklist rendering; a bad row must degrade to
    // "undetermined", never take the page down.
    expect(evaluateRule({ garbage: true } as unknown as RuleNode, {})).toBe(
      'unknown',
    );
    expect(evaluateRule('nonsense' as unknown as RuleNode, {})).toBe('unknown');
    expect(
      evaluateRule({ fact: 'age', op: 'sideways' } as unknown as RuleNode, {
        age: 5,
      }),
    ).toBe('unknown');
  });

  it('evaluates a realistic nested subclass rule', () => {
    // "Required for subclass 600 applicants who are minors, or who have a
    // sponsor, unless they hold a diplomatic passport."
    const rule: RuleNode = {
      all: [
        { fact: 'visa_subclass', op: 'eq', value: '600' },
        {
          any: [
            { fact: 'is_minor', op: 'eq', value: true },
            { fact: 'has_sponsor', op: 'eq', value: true },
          ],
        },
        { not: { fact: 'passport_type', op: 'eq', value: 'diplomatic' } },
      ],
    };
    expect(
      evaluateRule(rule, {
        visa_subclass: '600',
        is_minor: true,
        passport_type: 'ordinary',
      }),
    ).toBe('true');
    expect(
      evaluateRule(rule, {
        visa_subclass: '600',
        is_minor: true,
        passport_type: 'diplomatic',
      }),
    ).toBe('false');
    expect(
      evaluateRule(rule, {
        visa_subclass: '500',
        is_minor: true,
        passport_type: 'ordinary',
      }),
    ).toBe('false');
    expect(
      evaluateRule(rule, { visa_subclass: '600', passport_type: 'ordinary' }),
    ).toBe('unknown');
  });
});

describe('factsUsed', () => {
  it('lists every fact a nested rule depends on, deduplicated', () => {
    const rule: RuleNode = {
      all: [
        { fact: 'nationality', op: 'in', value: ['IN'] },
        {
          any: [
            { fact: 'age', op: 'lt', value: 18 },
            { fact: 'nationality', op: 'eq', value: 'PK' },
          ],
        },
        { not: { fact: 'has_sponsor', op: 'eq', value: true } },
      ],
    };
    expect(factsUsed(rule).sort()).toEqual([
      'age',
      'has_sponsor',
      'nationality',
    ]);
  });

  it('returns nothing for an unconditional requirement', () => {
    expect(factsUsed(null)).toEqual([]);
  });
});

describe('explainRule', () => {
  it('explains an unconditional requirement', () => {
    expect(explainRule(null)).toBe('Always required.');
  });

  it('renders plain English without leaking rule syntax', () => {
    const text = explainRule({
      all: [
        { fact: 'nationality', op: 'in', value: ['IN', 'PK'] },
        { fact: 'age', op: 'lt', value: 18 },
      ],
    });
    expect(text).toBe(
      'Required when nationality is one of IN, PK and age is under 18.',
    );
    expect(text).not.toMatch(/[{}[\]]/);
  });

  it('explains negation and existence', () => {
    expect(
      explainRule({ not: { fact: 'has_insurance', op: 'eq', value: true } }),
    ).toContain('not (has insurance is true)');
    expect(explainRule({ fact: 'has_sponsor', op: 'exists' })).toContain(
      'has sponsor is provided',
    );
  });
});

describe('checklist safety: a conditional requirement must never vanish unasked', () => {
  /**
   * The bug this encodes, found while extracting Canada's visitor visa.
   *
   * `exists` answers `false` for a fact nobody supplied — correctly, because
   * "is it provided?" is answerable without the value. But that makes it the
   * wrong operator for gating a REQUIREMENT: three rules written as
   * `{fact: 'nationality', op: 'exists'}` evaluated `false` for an applicant
   * who had not answered yet, which would have dropped a mandatory biometrics
   * appointment and its fee off the checklist entirely.
   *
   * The safe shape for a requirement gate is one that yields `unknown` on an
   * empty profile, so the checklist can render "may be required" rather than
   * silently omitting it.
   */
  const gateIsSafe = (rule: RuleNode): boolean =>
    evaluateRule(rule, {}) !== 'false';

  it('accepts equality gates, which are unknown until answered', () => {
    expect(gateIsSafe({ fact: 'has_dependants', op: 'eq', value: true })).toBe(
      true,
    );
    expect(gateIsSafe({ fact: 'is_minor', op: 'eq', value: true })).toBe(true);
    expect(
      gateIsSafe({ fact: 'nationality', op: 'in', value: ['IN', 'PK'] }),
    ).toBe(true);
  });

  it('rejects an exists gate, which hides the requirement before the question is asked', () => {
    expect(gateIsSafe({ fact: 'nationality', op: 'exists' })).toBe(false);
    expect(gateIsSafe({ fact: 'has_dependants', op: 'exists' })).toBe(false);
  });

  it('flags not_exists as the mirror hazard', () => {
    // not_exists is `true` on an empty profile, so it OVER-includes rather than
    // hides — recoverable on a checklist, but it flips the moment any answer
    // arrives, which is not what a requirement gate should do either.
    expect(evaluateRule({ fact: 'has_sponsor', op: 'not_exists' }, {})).toBe(
      'true',
    );
    expect(
      evaluateRule(
        { fact: 'has_sponsor', op: 'not_exists' },
        { has_sponsor: false },
      ),
    ).toBe('false');
  });

  it('keeps a nested gate safe as long as no branch is a bare exists', () => {
    expect(
      gateIsSafe({
        any: [
          { fact: 'travelling_with_minor', op: 'eq', value: true },
          { fact: 'is_minor', op: 'eq', value: true },
        ],
      }),
    ).toBe(true);
  });

  it('an all-gate containing an exists branch is unsafe, because false dominates AND', () => {
    // Kleene AND: one `false` branch makes the whole rule false, so a single
    // exists branch is enough to hide the requirement.
    expect(
      gateIsSafe({
        all: [
          { fact: 'is_minor', op: 'eq', value: true },
          { fact: 'nationality', op: 'exists' },
        ],
      }),
    ).toBe(false);
  });
});
