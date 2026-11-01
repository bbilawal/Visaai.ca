import { stripMetaCommentary } from './strip-meta';

/**
 * 2026-10-14 dry run: the LOE opened with the model talking to the user
 * ("Here is the letter…") and closed with "Note: …" advice. Neither belongs in
 * a letter a visa officer reads.
 */
const LETTER = [
  'To the Visa Officer,',
  '',
  'I am writing to explain the purpose of my visit to Canada.',
  '',
  'Please note that I have attached my bank statements as evidence of funds.',
  '',
  'Sincerely,  ',
  'Karim Haddad',
].join('\n');

describe('stripMetaCommentary', () => {
  it('removes a leading "Here is the letter…" line', () => {
    expect(
      stripMetaCommentary(
        `Here is the Letter of Explanation for your visa application:\n\n${LETTER}`,
      ),
    ).toBe(LETTER);
  });

  it('removes Sure/Certainly preambles and a "---" separator after them', () => {
    expect(
      stripMetaCommentary(
        `Certainly! Below is a draft cover letter based on your profile.\n\n---\n\n${LETTER}`,
      ),
    ).toBe(LETTER);
  });

  it('removes trailing Note:/disclaimer/offer-to-help paragraphs', () => {
    const out = stripMetaCommentary(
      `${LETTER}\n\n---\n\n**Note:** Replace the placeholders with your details before submitting.\n\nLet me know if you would like any changes!`,
    );
    expect(out).toBe(LETTER);
  });

  it('removes "This letter is a template…" and "Feel free…" closers', () => {
    expect(
      stripMetaCommentary(
        `${LETTER}\n\nThis letter has been written based on the information provided. Feel free to adjust it.`,
      ),
    ).toBe(LETTER);
  });

  it('unwraps a ```markdown fence', () => {
    expect(stripMetaCommentary('```markdown\n' + LETTER + '\n```')).toBe(
      LETTER,
    );
  });

  it('keeps "Please note…" sentences that are part of the letter body', () => {
    expect(stripMetaCommentary(LETTER)).toBe(LETTER);
  });

  it('never strips a long first paragraph that merely starts with "Here"', () => {
    const body =
      'Here in Lahore I own a home, run a business with twelve employees, and care for my elderly mother, all of which require my return. '.repeat(
        3,
      );
    const text = `${body.trim()}\n\n${LETTER}`;
    expect(stripMetaCommentary(text)).toBe(text);
  });

  it('returns the input unchanged when stripping would leave nothing', () => {
    expect(stripMetaCommentary('Here is the letter:')).toBe(
      'Here is the letter:',
    );
  });
});
