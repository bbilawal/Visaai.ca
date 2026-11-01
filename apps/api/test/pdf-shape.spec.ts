import { shapeText } from '../src/modules/prefill/pdf-shape';

const isPresentationForm = (s: string) =>
  [...s].some((ch) => {
    const c = ch.codePointAt(0)!;
    // Arabic Presentation Forms-A (FB50–FDFF) and -B (FE70–FEFF)
    return (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff);
  });

describe('shapeText', () => {
  it('reshapes Arabic into contextual presentation forms', () => {
    const out = shapeText('مرحبا', 'arabic');
    expect(out).not.toBe('مرحبا');
    expect(isPresentationForm(out)).toBe(true);
  });

  it('reorders so the result differs from the logical string', () => {
    const out = shapeText('مرحبا بالعالم', 'arabic');
    expect(out.length).toBeGreaterThan(0);
  });

  it('leaves latin and cjk unchanged', () => {
    expect(shapeText('hello', 'latin')).toBe('hello');
    expect(shapeText('你好', 'cjk')).toBe('你好');
    expect(shapeText('नमस्ते', 'devanagari')).toBe('नमस्ते');
  });

  it('returns input unchanged on empty string', () => {
    expect(shapeText('', 'arabic')).toBe('');
  });
});
