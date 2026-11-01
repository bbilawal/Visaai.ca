import type { ChatOpenAI } from '@langchain/openai';
import { makeGenerateFieldsNode } from './generate-fields';
import type { PrefillState } from '../prefill.state';

/**
 * The generator must see documents grouped by WHOSE they are, be told sponsor
 * documents never fill applicant fields, and its output must pass through the
 * deterministic post-pass (prod 2026-10-14).
 */
function fakeLlm(reply: unknown[]) {
  const prompts: string[] = [];
  const llm = {
    invoke: async (messages: Array<{ content: unknown }>) => {
      prompts.push(messages.map((m) => String(m.content)).join('\n\n'));
      return { content: JSON.stringify(reply) };
    },
  } as unknown as ChatOpenAI;
  return { llm, prompts };
}

const state = {
  applicationId: 'app-1',
  context: {
    countryCode: 'CA',
    visaType: 'Visitor visa',
    purpose: 'visitor',
    applicantName: 'KARIM HADDAD',
    profile: { retired: true, employed: false },
    documentFields: { full_name: 'KARIM HADDAD' },
    documentFieldsByType: { passport_copy: { full_name: 'KARIM HADDAD' } },
    otherPartyDocuments: [
      {
        documentType: 'employment_letter',
        subject: 'unattributed',
        holderName: null,
        fields: {
          job_title: 'HR Data Quality Coordinator',
          monthly_income: 88123,
        },
      },
    ],
    accountProfile: {},
  },
} as unknown as PrefillState;

describe('generateFields', () => {
  it('separates applicant documents from sponsor/host documents in the prompt', async () => {
    const { llm, prompts } = fakeLlm([
      {
        key: 'family_name',
        label: 'Family name',
        value: 'HADDAD',
        source: 'document',
      },
    ]);
    await makeGenerateFieldsNode(llm)(state);
    const p = prompts[0];
    expect(p).toMatch(/NOT the applicant/);
    expect(p).toMatch(/never (use|fill)[^.]*applicant/i);
    // The sponsor letter appears only in the other-party block.
    const ownStart = p.indexOf("The APPLICANT's own documents");
    const otherStart = p.indexOf("Documents that are NOT the applicant's");
    expect(ownStart).toBeGreaterThan(-1);
    expect(otherStart).toBeGreaterThan(ownStart);
    expect(p.slice(ownStart, otherStart)).not.toContain(
      'HR Data Quality Coordinator',
    );
    expect(p.slice(otherStart)).toContain('HR Data Quality Coordinator');
    expect(p).toContain('HR Data Quality Coordinator');
    expect(p).toContain('KARIM HADDAD');
  });

  it('runs the deterministic post-pass over the LLM output', async () => {
    const { llm } = fakeLlm([
      {
        key: 'previous_job_title',
        label: 'Previous job title',
        value: 'HR Data Quality Coordinator',
        group: 'Employment',
        source: 'document',
      },
      {
        key: 'monthly_income',
        label: 'Monthly income',
        value: '88123',
        group: 'Financial',
        source: 'document',
      },
    ]);
    const { fields } = await makeGenerateFieldsNode(llm)(state);
    expect(fields!.find((f) => f.key === 'previous_job_title')?.value).toBe('');
    expect(fields!.find((f) => f.key === 'monthly_income')?.value).toBe('');
  });
});
