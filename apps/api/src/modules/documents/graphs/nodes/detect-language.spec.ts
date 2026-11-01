import { detectLanguage, makeDetectLanguageNode } from './detect-language';
import type { DocumentState } from '../document.state';

describe('detectLanguage', () => {
  it('returns null for too-little text', () => {
    expect(detectLanguage('a b')).toBeNull();
  });

  it('detects English (no translation needed)', () => {
    const g = detectLanguage(
      'This is the bank account statement for the name and date of birth shown.',
    );
    expect(g?.lang).toBe('en');
  });

  it('detects French via stopwords', () => {
    const g = detectLanguage(
      'Le relevé de compte bancaire pour le nom et la date de naissance indiqués.',
    );
    expect(g?.lang).toBe('fr');
  });

  it('detects a non-Latin script (Arabic)', () => {
    const g = detectLanguage(
      'هذا كشف حساب مصرفي باسم وتاريخ الميلاد المذكورين أعلاه.',
    );
    expect(g?.lang).toBe('ar');
    expect(g?.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe('detect_language node', () => {
  function state(text: string): DocumentState {
    return {
      documentId: 'd',
      applicationId: 'a',
      storagePath: 'p',
      mimeType: 'image/png',
      documentType: 'bank_statement',
      signedUrl: '',
      rawOcrText: text,
      extractedFields: {},
      verificationResult: 'pass',
      verificationDetails: [],
      allDocsProcessed: false,
      error: null,
    } as unknown as DocumentState;
  }

  it('sets needsTranslation for non-English text', async () => {
    const out = await makeDetectLanguageNode()(
      state(
        'Le relevé de compte bancaire pour le nom et la date de naissance.',
      ),
    );
    expect(out.detectedLanguage).toBe('fr');
    expect(out.needsTranslation).toBe(true);
  });

  it('does not flag English text', async () => {
    const out = await makeDetectLanguageNode()(
      state(
        'This is the bank account statement for the name and date of birth.',
      ),
    );
    expect(out.needsTranslation).toBe(false);
  });

  it('short-circuits on a pre-existing error', async () => {
    const out = await makeDetectLanguageNode()(
      state('Le relevé de compte bancaire.'),
    );
    // sanity: with error set, returns {}
    const out2 = await makeDetectLanguageNode()({
      ...state('Le relevé'),
      error: 'x',
    });
    expect(out2).toEqual({});
    expect(out.detectedLanguage).toBeDefined();
  });
});
