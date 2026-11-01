import type { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';
import { makeDraftDocumentNode } from './draft-document';
import type { NarrativeState } from '../narrative.state';

function state(over: Partial<NarrativeState> = {}): NarrativeState {
  return {
    applicationId: 'app-1',
    docType: 'cover_letter',
    context: {
      profile: { duration_of_stay_days: 62 },
      vriScore: null,
      countryCode: 'CA',
      visaType: 'visitor',
      purpose: 'family',
      stay: {
        entryDate: '2026-12-01',
        departureDate: '2027-01-31',
        days: 62,
        nights: 61,
      },
    },
    draft: '',
    critique: '',
    approved: false,
    needsHumanReview: false,
    revisionCount: 0,
    generatedDocumentId: null,
    ...over,
  };
}

function llm(content: string, seen: BaseMessage[][] = []): ChatOpenAI {
  return {
    invoke: (msgs: BaseMessage[]) => {
      seen.push(msgs);
      return Promise.resolve({ content });
    },
  } as unknown as ChatOpenAI;
}

describe('draftDocument', () => {
  it('strips the model talking to the user before the letter is stored', async () => {
    const node = makeDraftDocumentNode(
      llm(
        'Here is the cover letter:\n\nDear Officer,\n\nBody.\n\nNote: edit as needed.',
      ),
    );
    const out = await node(state());
    expect(out.draft).toBe('Dear Officer,\n\nBody.');
  });

  it('quotes the UCI exactly as the applicant gave it, not regrouped', async () => {
    const node = makeDraftDocumentNode(llm('**UCI:** 1147-9084-58\n\nBody.'));
    const base = state();
    const out = await node(
      state({ context: { ...base.context, profile: { uci: '1147908458' } } }),
    );
    expect(out.draft).toBe('**UCI:** 1147908458\n\nBody.');
  });

  it('gives the model the date-derived stay as the only length of stay', async () => {
    const seen: BaseMessage[][] = [];
    await makeDraftDocumentNode(llm('Dear Officer,', seen))(state());
    const text = seen[0].map((m) => m.text).join('\n');
    expect(text).toContain('2026-12-01');
    expect(text).toContain('2027-01-31');
    expect(text).toMatch(/62 days/);
  });

  it('tells the model never to address the applicant or add notes', async () => {
    const seen: BaseMessage[][] = [];
    await makeDraftDocumentNode(llm('Dear Officer,', seen))(state());
    expect(seen[0][0].text).toMatch(/never .*"Here is"/i);
  });
});
