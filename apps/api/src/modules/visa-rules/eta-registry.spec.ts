import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CA_ETA_CONDITIONAL, CA_ETA_VISA_EXEMPT } from '@visaai/types';
import {
  convertRegistryToFramework,
  type RegistryRequirement,
} from './registry-to-framework';
import { validateRule, evaluateRule } from './rule-evaluator';
import { profileToRuleFacts } from './profile-to-rule-facts';
import type { RuleNode } from './rule.types';

/**
 * The eTA's sourced requirements (dry run 2026-10-16, app a37a534b).
 *
 * "A valid email address" and "An accepted credit or debit card" were
 * extracted as `evidence`, which made them required UPLOAD slots. A photo of a
 * VOID card was accepted and marked Verified. VisaAI must never hold an image
 * of a payment card: it is cardholder data with no purpose here, since IRCC
 * takes the card on its own payment page.
 */

const ROOT = join(__dirname, '../../../../..');
const doc = JSON.parse(
  readFileSync(
    join(ROOT, 'data/requirements/ca-electronic-travel-authorization-eta.json'),
    'utf8',
  ),
) as { requirements: Array<Record<string, unknown>> };
const byCode = (code: string) =>
  doc.requirements.find((r) => r.requirement_code === code)!;

describe('eTA extraction file', () => {
  it.each(['valid_email_address', 'accepted_payment_method'])(
    '%s is a condition, never an upload',
    (code) => {
      expect(byCode(code).kind).toBe('condition');
    },
  );

  it('gates the visa-exempt passport on nationality', () => {
    const rule = byCode('passport_from_visa_exempt_country').rule as RuleNode;
    expect(rule).toBeTruthy();
    expect(validateRule(rule)).toEqual([]);
    expect(evaluateRule(rule, { nationality: 'PK' })).toBe('false');
    expect(evaluateRule(rule, { nationality: 'GB' })).toBe('true');
    expect(evaluateRule(rule, { nationality: 'MX' })).toBe('true');
    expect(evaluateRule(rule, {})).toBe('unknown');
  });

  it('the passport rule lists exactly IRCC’s eTA-eligible nationalities', () => {
    const rule = byCode('passport_from_visa_exempt_country').rule as {
      value: string[];
    };
    expect([...rule.value].sort()).toEqual(
      [...CA_ETA_VISA_EXEMPT, ...CA_ETA_CONDITIONAL].sort(),
    );
  });

  it('encodes the eTA-required-country-and-air condition', () => {
    const rule = byCode('eta_required_country_air_travel').rule as RuleNode;
    expect(rule).toBeTruthy();
    expect(validateRule(rule)).toEqual([]);
    expect(
      evaluateRule(rule, { nationality: 'FR', travel_by_air: true }),
    ).toBe('true');
    expect(
      evaluateRule(rule, { nationality: 'PK', travel_by_air: true }),
    ).toBe('false');
  });
});

describe('convertRegistryToFramework — payment and contact details', () => {
  const row = (code: string, kind = 'evidence'): RegistryRequirement => ({
    requirement_code: code,
    kind,
    officially_required: true,
    label: code,
    description: null,
    official_form_code: null,
    official_form_url: null,
    rule: null,
    display_order: 1,
  });

  it('never turns a payment card or an email address into an upload slot, even if mis-kinded', () => {
    // The database rows are fixed by migration; this holds until it is applied
    // and against any future extraction that repeats the mistake.
    const { framework } = convertRegistryToFramework('x', [
      row('accepted_payment_method'),
      row('valid_email_address'),
      row('passport_from_visa_exempt_country'),
    ]);
    expect(framework.base_documents.map((d) => d.type)).toEqual([
      'passport_from_visa_exempt_country',
    ]);
  });

  it('drops the visa-exempt passport slot for a Pakistani applicant', () => {
    const passport = {
      ...row('passport_from_visa_exempt_country'),
      rule: byCode('passport_from_visa_exempt_country').rule,
    };
    const { framework, excluded } = convertRegistryToFramework(
      'ca-electronic-travel-authorization-eta',
      [passport],
      profileToRuleFacts({ nationality: 'Pakistani' }) as never,
    );
    expect(framework.base_documents).toEqual([]);
    expect(excluded).toContain('passport_from_visa_exempt_country');
  });
});

describe('profileToRuleFacts — eTA facts', () => {
  it('maps the eTA answers onto rule facts', () => {
    const f = profileToRuleFacts({
      us_permanent_resident: 'no',
      travel_by_air: 'yes',
      has_valid_us_visa: true,
      canadian_visa_last_10y: false,
      nationality: 'PAK',
    });
    expect(f.us_lpr).toBe(false);
    expect(f.travel_by_air).toBe(true);
    expect(f.valid_us_nonimmigrant_visa).toBe(true);
    expect(f.canadian_visa_last_10y).toBe(false);
    expect(f.nationality).toBe('PK');
  });
});
