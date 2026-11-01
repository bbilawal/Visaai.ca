import { renderTemplate } from './template-render';

describe('renderTemplate', () => {
  it('substitutes {{name}} (whitespace tolerant, repeated)', () => {
    expect(renderTemplate('Hi {{name}} and {{ name }}', { name: 'Sam' })).toBe(
      'Hi Sam and Sam',
    );
  });

  it('renders unknown vars as empty — never leaves braces or undefined', () => {
    const out = renderTemplate('score {{score}}!', {});
    expect(out).toBe('score !');
    expect(out).not.toMatch(/\{\{|undefined|null/);
  });

  it('passes through text with no placeholders', () => {
    expect(renderTemplate('plain text', { a: '1' })).toBe('plain text');
  });

  it('handles multiple distinct vars', () => {
    expect(renderTemplate('{{a}}-{{b}}', { a: 'x', b: 'y' })).toBe('x-y');
  });

  it('does NOT evaluate expressions — only plain names match', () => {
    // `{{1+1}}` is not a valid [a-zA-Z0-9_] name → left as-is (no eval).
    expect(renderTemplate('{{1+1}}', {})).toBe('{{1+1}}');
  });

  it('coerces non-string values via the caller (string map) safely', () => {
    expect(renderTemplate('n={{n}}', { n: '42' })).toBe('n=42');
  });

  it('does NOT leak inherited/prototype names ({{constructor}}, {{__proto__}})', () => {
    expect(renderTemplate('a{{constructor}}b', {})).toBe('ab');
    expect(renderTemplate('a{{__proto__}}b', {})).toBe('ab');
    expect(renderTemplate('a{{toString}}b', {})).toBe('ab');
  });
});
