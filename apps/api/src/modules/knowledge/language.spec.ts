import { detectLanguage, normalizeLanguageTag } from './language';

describe('detectLanguage', () => {
  it('detects English government prose', () => {
    const r = detectLanguage(
      'You must have a valid passport and you must apply online before you travel. ' +
        'The fee for this visa is not refundable and your application will be assessed ' +
        'against the requirements set out on this page.',
    );
    expect(r.language).toBe('en');
    expect(r.confidence).toBeGreaterThan(0.4);
  });

  it('detects French', () => {
    const r = detectLanguage(
      'Vous devez présenter une demande en ligne avec votre passeport. Les frais de la ' +
        'demande ne sont pas remboursables et votre dossier sera évalué selon les critères ' +
        'publiés sur cette page pour une demande de visa.',
    );
    expect(r.language).toBe('fr');
  });

  it('detects a non-Latin script from codepoints alone', () => {
    const arabic =
      'يجب أن يكون لديك جواز سفر ساري المفعول قبل تقديم الطلب عبر الإنترنت للحصول على التأشيرة';
    expect(detectLanguage(arabic).language).toBe('ar');
    expect(detectLanguage(arabic).confidence).toBeGreaterThan(0.9);
  });

  it('separates Japanese from Chinese by kana, not by Han characters', () => {
    // Both samples are over the 60-letter floor below which detection
    // deliberately refuses to classify.
    const ja =
      '申請には有効なパスポートが必要です。オンラインで申請してください。' +
      '申請手数料は returned されません。審査の結果は郵送でお知らせいたします。' +
      '在留資格認定証明書の交付を受けた方は、大使館で査証の申請を行ってください。';
    const zh =
      '申请人必须持有有效护照。请在线提交申请材料并缴纳费用。' +
      '签证申请费用一经缴纳概不退还。审理结果将通过电子邮件通知申请人。' +
      '获得批准的申请人须在指定期限内前往使馆领取签证。';
    expect(detectLanguage(ja).language).toBe('ja');
    expect(detectLanguage(zh).language).toBe('zh');
  });

  it('returns und rather than guessing on a fee table', () => {
    // Mostly digits: there is no linguistic signal, and a guessed 'en' would
    // hide the table from a French-language filter.
    const r = detectLanguage('100 | 235 | 570 | 1,285 | 2,040');
    expect(r.language).toBe('und');
    expect(r.confidence).toBe(0);
  });

  it('returns und on text too short to classify', () => {
    expect(detectLanguage('Fees').language).toBe('und');
  });

  it('uses the registry hint only to break a near-tie', () => {
    // A clear English signal must not be overridden by a wrong hint.
    const clear =
      'You must have a valid passport and you must apply online before you travel to the country. ' +
      'You must also provide evidence that you have enough money for your stay and that you will ' +
      'leave the country at the end of your visit.';
    expect(detectLanguage(clear, 'de').language).toBe('en');
  });
});

describe('normalizeLanguageTag', () => {
  it('normalises to the shape the schema accepts', () => {
    expect(normalizeLanguageTag('EN')).toBe('en');
    expect(normalizeLanguageTag('pt_br')).toBe('pt-BR');
    expect(normalizeLanguageTag('fr-CA')).toBe('fr-CA');
  });

  it('maps missing or nonsense input to und', () => {
    expect(normalizeLanguageTag(null)).toBe('und');
    expect(normalizeLanguageTag('')).toBe('und');
    expect(normalizeLanguageTag('123')).toBe('und');
  });
});
