import { makeSelfReviewNode, reviewRouter } from './self-review';
import type { ChatOpenAI } from '@langchain/openai';
import type { NarrativeState } from '../narrative.state';

function baseState(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    applicationId: 'app-1',
    docType: 'loe',
    context: {
      profile: { name: 'A' },
      vriScore: null,
      countryCode: 'CA',
      visaType: 'visitor',
      purpose: 'tourism',
    },
    draft: 'Some draft text',
    critique: '',
    approved: false,
    needsHumanReview: false,
    revisionCount: 0,
    generatedDocumentId: null,
    ...overrides,
  };
}

function llmReturning(content: string): ChatOpenAI {
  return { invoke: async () => ({ content }) } as unknown as ChatOpenAI;
}

describe('narrative self-review — fail-closed gate', () => {
  it('does NOT approve when the reviewer output is unparseable', async () => {
    const node = makeSelfReviewNode(
      llmReturning('the model rambled with no json'),
    );
    const out = await node(baseState());
    expect(out.approved).toBe(false); // previously defaulted to true (fail-open)
    expect(out.needsHumanReview).toBe(false);
    expect(reviewRouter({ ...baseState(), ...out })).toBe('draft');
  });

  it('does NOT approve when JSON is present but `approved` is not a boolean', async () => {
    const node = makeSelfReviewNode(
      llmReturning('{"approved":"yes","critique":""}'),
    );
    const out = await node(baseState());
    expect(out.approved).toBe(false);
  });

  it('escalates to human review at the revision cap instead of auto-approving', async () => {
    const node = makeSelfReviewNode(
      llmReturning('{"approved":false,"critique":"still wrong"}'),
    );
    const out = await node(baseState({ revisionCount: 5 }));
    expect(out.approved).toBe(false); // previously returned approved:true at cap
    expect(out.needsHumanReview).toBe(true);
    // escalation must TERMINATE the loop, not spin back to draft
    expect(reviewRouter({ ...baseState(), ...out })).toBe('finalize');
  });

  it('approves a well-formed approval', async () => {
    const node = makeSelfReviewNode(
      llmReturning('{"approved":true,"critique":""}'),
    );
    const out = await node(baseState());
    expect(out.approved).toBe(true);
    expect(reviewRouter({ ...baseState(), ...out })).toBe('finalize');
  });

  it('routes a well-formed rejection back to draft with its critique', async () => {
    const node = makeSelfReviewNode(
      llmReturning('{"approved":false,"critique":"fix the tone"}'),
    );
    const out = await node(baseState({ revisionCount: 2 }));
    expect(out.approved).toBe(false);
    expect(out.critique).toBe('fix the tone');
    expect(reviewRouter({ ...baseState(), ...out })).toBe('draft');
  });
});
