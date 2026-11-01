import type { ChatOpenAI } from '@langchain/openai';
import { makeGenerateFieldsNode, parseFields } from './generate-fields';
import { makeStorePrefillNode } from './store-prefill';
import type { PrefillState } from '../prefill.state';

/**
 * Prod 2026-10-14: a Regenerate on a 102-field IMM 5257 hit the 4096-token
 * output cap (output_tokens = 4096 exactly). The JSON array was cut mid-object,
 * parseFields returned [], and store_prefill overwrote the existing draft —
 * including the applicant's saved edits — with an empty form. No error surfaced.
 */
const FIELD = (i: number) =>
  `{"key":"f${i}","label":"Field ${i}","value":"v${i}","group":"G","source":"profile"}`;

describe('parseFields — truncated model output', () => {
  it('keeps every complete field from an array that was cut off mid-object', () => {
    const raw = `[${[1, 2, 3].map(FIELD).join(',')},{"key":"f4","label":"Fiel`;
    const fields = parseFields(raw);
    expect(fields.map((f) => f.key)).toEqual(['f1', 'f2', 'f3']);
  });

  it('keeps fields when the array was cut between objects', () => {
    const raw = `[${[1, 2].map(FIELD).join(',')},`;
    expect(parseFields(raw).map((f) => f.key)).toEqual(['f1', 'f2']);
  });

  it('is not fooled by braces or brackets inside string values', () => {
    const raw = `[{"key":"a","label":"A","value":"x } ] { y","source":"profile"},{"key":"b","lab`;
    expect(parseFields(raw).map((f) => [f.key, f.value])).toEqual([
      ['a', 'x } ] { y'],
    ]);
  });

  it('still parses a complete array (and ignores prose around it)', () => {
    const raw = `Here you go:\n[${[1, 2].map(FIELD).join(',')}]\nDone.`;
    expect(parseFields(raw)).toHaveLength(2);
  });
});

describe('generateFields — empty result', () => {
  it('throws instead of returning an empty field list', async () => {
    const llm = {
      invoke: async () => ({ content: 'Sorry, I cannot help with that.' }),
    } as unknown as ChatOpenAI;
    const state = {
      applicationId: 'app-1',
      context: {
        countryCode: 'CA',
        visaType: 'Visitor visa',
        purpose: 'visitor',
        applicantName: null,
        profile: {},
        documentFields: {},
        documentFieldsByType: {},
        otherPartyDocuments: [],
        accountProfile: {},
      },
    } as unknown as PrefillState;

    await expect(makeGenerateFieldsNode(llm)(state)).rejects.toThrow(
      /no form fields/i,
    );
  });
});

describe('storePrefill — never overwrite a draft with nothing', () => {
  it('refuses to store an empty field list', async () => {
    const upsert = jest.fn();
    const supabase = { from: jest.fn().mockReturnValue({ upsert }) } as any;
    const state: any = {
      applicationId: 'app-1',
      context: { visaType: 'visitor', countryCode: 'CA', purpose: 'tourism' },
      fields: [],
    };

    await expect(makeStorePrefillNode(supabase)(state)).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });
});
