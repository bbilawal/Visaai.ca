import { buildDraftPrompt } from '../src/modules/messaging/messaging-ai.service';

describe('buildDraftPrompt', () => {
  const base = {
    appSummary: {
      country: 'Canada',
      missingDocs: ['bank_statement', 'passport'],
    },
    messages: [
      { sender_role: 'user', body: 'What documents do I still need?' },
      { sender_role: 'consultant', body: 'Let me check.' },
    ],
  };

  it('system prompt forbids legal advice + guarantees and asks for JSON {reply}', () => {
    const { system } = buildDraftPrompt(base);
    expect(system).toMatch(/legal advice/i);
    expect(system).toMatch(/guarantee/i);
    expect(system).toMatch(/\{"reply"/);
  });

  it('user prompt includes the country, missing docs, and thread bodies', () => {
    const { user } = buildDraftPrompt(base);
    expect(user).toContain('Canada');
    expect(user).toContain('bank_statement');
    expect(user).toContain('What documents do I still need?');
  });

  it('includes the consultant instruction when provided', () => {
    const { user } = buildDraftPrompt({
      ...base,
      instruction: 'ask for the bank statement',
    });
    expect(user).toMatch(/ask for the bank statement/);
  });

  it('omits the instruction section when not provided', () => {
    const { user } = buildDraftPrompt(base);
    expect(user).not.toMatch(/Consultant instruction:/);
  });
});
