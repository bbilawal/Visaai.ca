import { GuardrailsService } from './guardrails.service';

/**
 * These are the checks that keep VisaAI on the correct side of "preparation
 * tool, not licensed consultant". They had no test file before the Task 14
 * audit, which meant every pattern in them was one careless edit from silently
 * becoming a no-op.
 *
 * The negative cases matter as much as the positive ones: a filter that blocks
 * ordinary document-request copy would push consultants to stop using the tool,
 * and an unused control protects nobody.
 */
describe('GuardrailsService', () => {
  const svc = new GuardrailsService();

  describe('classifyIntent (pre-generation)', () => {
    it.each([
      ['how do I fake a bank statement', 'misrepresentation'],
      ['can I lie on my application about my job', 'misrepresentation'],
      ['will I get approved?', 'approval_prediction'],
      ['what are my chances', 'approval_prediction'],
      ['do I qualify', 'approval_prediction'],
      ['should I appeal the refusal', 'legal_advice'],
      ['is it legal to work while my permit is pending', 'legal_advice'],
      ['can I be deported for this', 'legal_advice'],
    ])('flags %j as %s', (text, label) => {
      const result = svc.classifyIntent(text);
      expect(result.label).toBe(label);
      expect(result.safe).toBe(false);
      expect(result.matched).toBeTruthy();
    });

    it.each([
      'what documents do I need for a study permit',
      'how long does processing usually take',
      'I uploaded my passport, did it come through',
      'can you explain what proof of funds means',
    ])('lets ordinary preparation question %j through', (text) => {
      expect(svc.classifyIntent(text).safe).toBe(true);
    });

    it('treats empty and missing input as safe rather than throwing', () => {
      expect(svc.classifyIntent('').safe).toBe(true);
      expect(svc.classifyIntent(undefined as unknown as string).safe).toBe(
        true,
      );
    });
  });

  describe('filterOutput (post-generation)', () => {
    it.each([
      ['I guarantee your visa will be issued.', 'guarantee'],
      ['You will be approved without any issue.', 'approval-promise'],
      ['Your approval chances are excellent.', 'chance-prediction'],
      ["You'll definitely get approved.", 'certainty'],
      ['We will get you approved, trust us.', 'we-get-you-in'],
      ['There is a 90% chance of approval here.', 'percent-odds'],
      ['You are 95% likely to be approved.', 'percent-odds'],
      ['You have a high chance of approval.', 'odds-language'],
      [
        'You are likely to be approved with this profile.',
        'likelihood-prediction',
      ],
      ['Your application will be approved next month.', 'outcome-prediction'],
      ['You can expect an approval shortly.', 'outcome-prediction'],
    ])('blocks %j', (text, tag) => {
      const result = svc.filterOutput(text);
      expect(result.safe).toBe(false);
      expect(result.violations).toContain(tag);
      expect(result.safeFallback).toMatch(/can not predict visa decisions/i);
    });

    it.each([
      'Could you upload your bank statement for the last three months?',
      'Your checklist still shows a missing police certificate.',
      'Processing times for this stream are published by the department.',
      'I have flagged an inconsistency between your itinerary and your ticket.',
      'A licensed consultant can review your specific circumstances.',
    ])('leaves compliant copy %j untouched', (text) => {
      const result = svc.filterOutput(text);
      expect(result.safe).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it('reports every violation, not just the first', () => {
      const result = svc.filterOutput(
        'I guarantee it — you will be approved, a 99% chance of approval.',
      );
      expect(result.violations.length).toBeGreaterThan(1);
    });

    it('treats empty and missing output as safe rather than throwing', () => {
      expect(svc.filterOutput('').safe).toBe(true);
      expect(svc.filterOutput(undefined as unknown as string).safe).toBe(true);
    });
  });

  it('exposes a refusal message that names the licensed alternative', () => {
    expect(svc.refusalMessage).toMatch(/licensed immigration consultant/i);
  });
});

describe('filterOutput — denying a guarantee is not promising one', () => {
  /**
   * `\bguarantee(d|s)?\b` matched the word anywhere, so the model saying the
   * correct thing had its ENTIRE reply replaced by the refusal message.
   *
   * Seen live on 2026-09-04: an applicant answered a factual question about
   * travel history and got a legal-advice disclaimer back, losing the answer
   * and the next question with it. The guard is meant to stop a promise, not a
   * caveat.
   */
  const svc = new GuardrailsService();

  it.each([
    'A Super Visa does not guarantee entry; the officer decides at the port of entry.',
    'There is no guarantee of approval, but a complete application helps.',
    'Note that admission is never guaranteed.',
    'Entry is not guaranteed by holding a Super Visa.',
    'Nothing here is guaranteed.',
  ])('allows a denial: %s', (text) => {
    expect(svc.filterOutput(text).safe).toBe(true);
  });

  it.each([
    'We guarantee your visa will be approved.',
    'This guarantees approval.',
    'I can guarantee entry.',
  ])('still blocks a promise: %s', (text) => {
    const out = svc.filterOutput(text);
    expect(out.safe).toBe(false);
    expect(out.violations).toContain('guarantee');
  });

  it('blocks a promise even when a denial appears later in the same reply', () => {
    // The escape hatch this closes: append "though nothing is guaranteed" to
    // any promise and it would sail through a naive negation check.
    const out = svc.filterOutput(
      'We guarantee approval, though nothing is guaranteed.',
    );
    expect(out.safe).toBe(false);
  });
});
