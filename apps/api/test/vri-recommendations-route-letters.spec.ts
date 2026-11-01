import {
  CA_EE_VISAAI_ID,
  CA_ETA_VISAAI_ID,
  CA_SPOUSAL_VISAAI_ID,
  SUPER_VISA_ID,
} from '@visaai/types';
import {
  buildEvidenceRecommendations,
  buildRecSystemPrompt,
  explicitRouteLetters,
  makeGenerateRecommendationsNode,
  NEUTRAL_ISSUE,
  sanitizeRecommendations,
  NEUTRAL_DISCREPANCY_ADVICE,
  NO_LETTER_FALLBACK,
  sanitizeRecommendationText,
} from '../src/modules/vri/graphs/nodes/generate-recommendations';

/**
 * Live prod 2026-10-20 (Canada spousal sponsorship): the Application
 * Consistency recommendation told the applicant to "include a short letter of
 * explanation ... stating that the discrepancies were data-entry errors".
 *   (a) the route offers no generated letters at all;
 *   (b) VisaAI cannot know why values differ — the uploaded passport was
 *       another person's — and must never script the cause.
 */

const PROD_TEXT =
  "Correct the applicant's date of birth and passport number to exactly match the biographical page of passport CK1234567. Upload a clear copy of that passport biographical page and include a short letter of explanation identifying the corrected fields, confirming that the passport is the authoritative identity document, and stating that the discrepancies were data-entry errors.";

describe('buildRecSystemPrompt — route letters + cause rule', () => {
  it('always forbids asserting a cause or scripting an explanation', () => {
    const p = buildRecSystemPrompt('en');
    expect(p).toContain('NEVER assert why a value differs');
    expect(p).toContain('data-entry errors');
    expect(p).toContain('explain it truthfully');
  });

  it('tells a no-letter route that no letters are used', () => {
    const p = buildRecSystemPrompt('en', []);
    expect(p).toContain('The applicant writes NO letters');
    expect(p).toContain('letter of explanation');
    expect(p).toContain('correcting their answers or uploading the right document');
  });

  it('lists the offered letters and bans only the others', () => {
    const p = buildRecSystemPrompt('en', ['loe', 'itinerary', 'cover_letter']);
    expect(p).toContain(
      'The only letters the applicant writes on this application route are: letter of explanation, cover letter.',
    );
    expect(p).toMatch(/Never recommend writing, including or attaching a letter of invitation\./);
  });

  it('adds no letters directive when every letter is offered', () => {
    const p = buildRecSystemPrompt('en', [
      'invitation_letter',
      'cover_letter',
      'loe',
      'itinerary',
    ]);
    expect(p).not.toContain('LETTERS:');
  });
});

describe('sanitizeRecommendationText', () => {
  it('fixes the prod spousal-sponsorship text: no letter, no asserted cause', () => {
    const out = sanitizeRecommendationText(PROD_TEXT, []);
    expect(out).not.toMatch(/letter of explanation/i);
    expect(out).not.toMatch(/data-entry/i);
    expect(out).toContain(
      "Correct the applicant's date of birth and passport number to exactly match the biographical page of passport CK1234567.",
    );
    expect(out).toContain('Upload a clear copy of that passport biographical page.');
    expect(out).toContain(NEUTRAL_DISCREPANCY_ADVICE);
  });

  it('keeps an LOE where the route offers one, but still strips the asserted cause', () => {
    const out = sanitizeRecommendationText(PROD_TEXT, [
      'loe',
      'itinerary',
      'cover_letter',
    ]);
    expect(out).toMatch(/letter of explanation identifying the corrected fields/);
    expect(out).not.toMatch(/data-entry/i);
    expect(out).toContain(NEUTRAL_DISCREPANCY_ADVICE);
  });

  it('leaves clean text untouched', () => {
    const t =
      'Upload your most recent bank statements covering six months. Make sure the account holder name matches your passport.';
    expect(sanitizeRecommendationText(t, [])).toBe(t);
  });

  it('does not treat third-party evidence letters as applicant letters', () => {
    const t = "Upload the sponsor's employment letter and recent pay stubs.";
    expect(sanitizeRecommendationText(t, [])).toBe(t);
  });

  it('removes a cover letter / invitation letter the route does not offer', () => {
    const out = sanitizeRecommendationText(
      'Fix the address field. Write a cover letter summarising the relationship.',
      [],
    );
    expect(out).toBe('Fix the address field.');
    const inv = sanitizeRecommendationText(
      'Ask your host for a letter of invitation.',
      ['loe', 'cover_letter'],
    );
    expect(inv).toBe(NO_LETTER_FALLBACK);
  });

  it('strips other cause assertions (typo, honest mistake)', () => {
    for (const t of [
      'Update the date of birth; the mismatch was a typo.',
      'Explain that the difference was an honest mistake.',
      'Note that the discrepancy is due to a clerical error at the passport office.',
    ]) {
      const out = sanitizeRecommendationText(t, ['loe']);
      expect(out).not.toMatch(/typo|honest mistake|clerical error|due to/i);
      expect(out).toContain(NEUTRAL_DISCREPANCY_ADVICE);
    }
  });

  it('falls back to correction advice when only a letter remained', () => {
    expect(
      sanitizeRecommendationText('Include a letter of explanation.', []),
    ).toBe(NO_LETTER_FALLBACK);
  });
});

describe('makeGenerateRecommendationsNode — route letters', () => {
  function fakeLlm(capture: { messages?: any[] }, reply: unknown[] = []) {
    return {
      invoke: async (messages: any[]) => {
        capture.messages = messages;
        return { content: JSON.stringify(reply) };
      },
    };
  }
  const stateFor = (visaaiId: string | null, profile: object = {}) => ({
    scores: { consistency_pct: 20 },
    factorEvidence: {},
    data: {
      profile,
      destinationCountry: 'CA',
      visaaiId,
      checklistItems: [],
      documents: [],
      verifications: [],
      crossVerifications: [],
    },
  });

  it.each([CA_SPOUSAL_VISAAI_ID, CA_EE_VISAAI_ID, CA_ETA_VISAAI_ID])(
    'passes "no letters" into the prompt for %s',
    async (id) => {
      const cap: { messages?: any[] } = {};
      await makeGenerateRecommendationsNode(fakeLlm(cap) as any, 'en')(
        stateFor(id) as any,
      );
      expect(String(cap.messages![0].content)).toContain(
        'The applicant writes NO letters',
      );
    },
  );

  it('still allows the LOE for super visa and for an unmapped route', async () => {
    for (const id of [SUPER_VISA_ID, null]) {
      const cap: { messages?: any[] } = {};
      await makeGenerateRecommendationsNode(fakeLlm(cap) as any, 'en')(
        stateFor(id) as any,
      );
      const sys = String(cap.messages![0].content);
      expect(sys).not.toContain('The applicant writes NO letters');
      // Super visa offers every letter; an unmapped route has no explicit
      // entry, so nothing is banned either.
      expect(sys).not.toContain('LETTERS:');
    }
  });

  it('post-filters the LLM output on a spousal route', async () => {
    const node = makeGenerateRecommendationsNode(
      fakeLlm({}, [
        {
          factor: 'consistency_pct',
          issue: 'Passport details differ.',
          recommendation_text: PROD_TEXT,
        },
      ]) as any,
      'en',
    );
    const out = await node(stateFor(CA_SPOUSAL_VISAAI_ID) as any);
    const rec = out.recommendations!.find((r) => r.factor === 'consistency_pct')!;
    expect(rec.recommendation_text).not.toMatch(/letter of explanation|data-entry/i);
    expect(rec.recommendation_text).toContain('Upload a clear copy');
  });

  it('keeps the LLM LOE suggestion on super visa', async () => {
    const node = makeGenerateRecommendationsNode(
      fakeLlm({}, [
        {
          factor: 'consistency_pct',
          issue: 'x',
          recommendation_text:
            'Fix the date of birth and include a letter of explanation identifying the corrected fields.',
        },
      ]) as any,
      'en',
    );
    const out = await node(stateFor(SUPER_VISA_ID) as any);
    expect(out.recommendations![0].recommendation_text).toContain(
      'letter of explanation',
    );
  });

  it('post-filters deterministic refusal advice when the route offers no LOE', async () => {
    const profile = {
      previous_refusal: true,
      refusal_reason: 'ties to home country',
    };
    // The node keeps the LOE on a route with no letters entry (TRV) ...
    const node = makeGenerateRecommendationsNode(fakeLlm({}) as any, 'en');
    const trv = await node(stateFor(null, profile) as any);
    const trvHome = trv.recommendations!.filter(
      (r) => r.factor === 'home_ties_pct',
    );
    expect(trvHome).toHaveLength(1);
    expect(trvHome[0].recommendation_text).toContain('letter of explanation');
    // ... and the same deterministic advice loses it with no letters offered.
    const filtered = sanitizeRecommendations(
      buildEvidenceRecommendations(stateFor(null, profile) as any),
      [],
    ).filter((r) => r.factor === 'home_ties_pct');
    expect(filtered[0].recommendation_text).not.toContain(
      'letter of explanation',
    );
    expect(filtered[0].recommendation_text).toContain('Prove each tie');
  });
});

describe('PR #255 review regressions', () => {
  const S = sanitizeRecommendationText;
  const rec = (issue: string) => ({
    factor: 'consistency_pct',
    issue,
    recommendation_text: 'Fix the date of birth.',
    priority: 50,
  });

  it('only routes with an explicit ROUTE_LETTERS entry restrict letters', () => {
    expect(explicitRouteLetters('CA', null)).toBeNull();
    expect(explicitRouteLetters('CA', 'ca-some-unmapped-route')).toBeNull();
    expect(explicitRouteLetters('US', 'us-b1-b2')).toBeNull();
    expect(explicitRouteLetters('CA', CA_SPOUSAL_VISAAI_ID)).toEqual([]);
    expect(explicitRouteLetters('CA', SUPER_VISA_ID)).toContain(
      'invitation_letter',
    );
  });

  it('keeps a TRV host invitation letter (no explicit route entry)', () => {
    const t =
      'Ask your host in Canada for an invitation letter. Upload your bank statements.';
    expect(S(t, explicitRouteLetters('CA', null))).toBe(t);
  });

  it('keeps the TRV invitation letter through the node', async () => {
    const t =
      'Ask your host in Canada for an invitation letter. Upload your bank statements.';
    const node = makeGenerateRecommendationsNode(
      {
        invoke: async () => ({
          content: JSON.stringify([
            { factor: 'consistency_pct', issue: 'x', recommendation_text: t },
          ]),
        }),
      } as any,
      'en',
    );
    const out = await node({
      scores: { consistency_pct: 20 },
      factorEvidence: {},
      data: {
        profile: {},
        destinationCountry: 'CA',
        visaaiId: null,
        checklistItems: [],
        documents: [],
        verifications: [],
        crossVerifications: [],
      },
    } as any);
    expect(out.recommendations![0].recommendation_text).toBe(t);
  });

  it('keeps the super visa invitation letter', () => {
    const t = 'Ask your child or grandchild for a letter of invitation.';
    expect(S(t, explicitRouteLetters('CA', SUPER_VISA_ID))).toBe(t);
  });

  it('keeps "explain truthfully in your letter of explanation" on TRV', () => {
    const t =
      'If the difference is real, explain it truthfully in your letter of explanation.';
    expect(S(t, null)).toBe(t);
  });

  it('keeps third-party employment letters even on a no-letter route', () => {
    const t = 'Upload your employment letter showing salary and start date.';
    expect(S(t, [])).toBe(t);
  });

  it('does not split on abbreviations', () => {
    const t = 'Dr. Smith noted the typo. Upload the U.S. visa page.';
    expect(S(t, [])).toBe(t);
    const out = S(
      'Mr. Khan should fix the date of birth. Claims, e.g. a lease, help. It was a typo.',
      [],
    );
    expect(out).toContain('Mr. Khan should fix the date of birth.');
    expect(out).toContain('Claims, e.g. a lease, help.');
    expect(out).not.toContain('It was a typo');
  });

  it('keeps decimal amounts intact', () => {
    const t =
      'Show at least CAD 1,000.50 in savings. Upload six months of statements.';
    expect(S(t, [])).toBe(t);
  });

  it('allows "typo" without a cause claim', () => {
    const t = 'Fix the typo in your name so it matches your passport.';
    expect(S(t, [])).toBe(t);
    expect(S('The mismatch was just a typo.', [])).toBe(
      NEUTRAL_DISCREPANCY_ADVICE,
    );
    expect(S('Say it happened due to a typo.', [])).toBe(
      NEUTRAL_DISCREPANCY_ADVICE,
    );
  });

  it('keeps non-discrepancy "due to" phrasing', () => {
    const a = 'Show the funds due to be released from your fixed deposit.';
    const b =
      'Your employment gap was due to study, so upload your enrolment confirmation.';
    expect(S(a, [])).toBe(a);
    expect(S(b, [])).toBe(b);
  });

  it('does not duplicate neutral advice the model already gave', () => {
    const t =
      'Check which value is correct for your date of birth and fix it. The discrepancies were data-entry errors.';
    expect(S(t, [])).toBe(
      'Check which value is correct for your date of birth and fix it.',
    );
  });

  it('strips asserted causes from the issue field too', () => {
    const [a, b, c] = sanitizeRecommendations(
      [
        rec('The discrepancies were data-entry errors.'),
        rec(
          'Your date of birth differs between the form and the passport; this was a clerical error.',
        ),
        rec('Your date of birth differs between the form and the passport.'),
      ],
      [],
    );
    expect(a.issue).toBe(NEUTRAL_ISSUE);
    expect(b.issue).toBe(
      'Your date of birth differs between the form and the passport.',
    );
    expect(b.issue).not.toContain(NEUTRAL_DISCREPANCY_ADVICE);
    expect(c.issue).toBe(
      'Your date of birth differs between the form and the passport.',
    );
  });

  it('skips the English-only filter for a non-English language', async () => {
    const node = makeGenerateRecommendationsNode(
      {
        invoke: async () => ({
          content: JSON.stringify([
            {
              factor: 'consistency_pct',
              issue: 'x',
              recommendation_text: PROD_TEXT,
            },
          ]),
        }),
      } as any,
      'de',
    );
    const out = await node({
      scores: { consistency_pct: 20 },
      factorEvidence: {},
      data: {
        profile: {},
        destinationCountry: 'CA',
        visaaiId: CA_SPOUSAL_VISAAI_ID,
        checklistItems: [],
        documents: [],
        verifications: [],
        crossVerifications: [],
      },
    } as any);
    expect(out.recommendations![0].recommendation_text).toBe(PROD_TEXT);
  });
});
