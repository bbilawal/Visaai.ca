import type { StageSlug } from '@visaai/types';

export type EmailLocale =
  | 'en'
  | 'fr'
  | 'es'
  | 'de'
  | 'it'
  | 'pt'
  | 'nl'
  | 'ar'
  | 'tr'
  | 'hi'
  | 'ur'
  | 'zh'
  | 'zh-TW'
  | 'ja'
  | 'ko';

export interface EmailMessages {
  reminder: {
    subject: string;
    body: string; // no country
    bodyWithCountry: string; // contains {country}
    nextStepPrefix: string;
    resume: string;
    unsubscribe: string;
  };
  nextStep: Record<StageSlug, string>;
}

// en is the master. Translations are MT-quality, flagged for Phase 7 human
// review (no legal/pricing/gov copy here, so §4.1 does not apply).
export const MESSAGES: Record<EmailLocale, EmailMessages> = {
  en: {
    reminder: {
      subject: 'Your visa application is waiting',
      body: 'Your visa application is waiting.',
      bodyWithCountry: 'Your {country} visa application is waiting.',
      nextStepPrefix: 'Next step:',
      resume: 'Resume your application →',
      unsubscribe: 'Unsubscribe from these reminders',
    },
    nextStep: {
      intake: 'Answer a few intake questions',
      documents: 'Upload your required documents',
      narrative: 'Generate your supporting letters',
      readiness: 'Check your readiness score',
      prefill: 'Prefill your application form',
      submission: 'Submit to the government portal',
    },
  },
  fr: {
    reminder: {
      subject: 'Votre demande de visa est en attente',
      body: 'Votre demande de visa est en attente.',
      bodyWithCountry: 'Votre demande de visa pour {country} est en attente.',
      nextStepPrefix: 'Prochaine étape :',
      resume: 'Reprendre votre demande →',
      unsubscribe: 'Se désabonner de ces rappels',
    },
    nextStep: {
      intake: 'Répondez à quelques questions préliminaires',
      documents: 'Téléversez vos documents requis',
      narrative: 'Générez vos lettres justificatives',
      readiness: 'Vérifiez votre score de préparation',
      prefill: 'Préremplissez votre formulaire de demande',
      submission: 'Soumettez au portail gouvernemental',
    },
  },
  es: {
    reminder: {
      subject: 'Tu solicitud de visa está esperando',
      body: 'Tu solicitud de visa está esperando.',
      bodyWithCountry: 'Tu solicitud de visa para {country} está esperando.',
      nextStepPrefix: 'Siguiente paso:',
      resume: 'Reanudar tu solicitud →',
      unsubscribe: 'Cancelar la suscripción a estos recordatorios',
    },
    nextStep: {
      intake: 'Responde algunas preguntas iniciales',
      documents: 'Sube tus documentos requeridos',
      narrative: 'Genera tus cartas de apoyo',
      readiness: 'Revisa tu puntuación de preparación',
      prefill: 'Rellena tu formulario de solicitud',
      submission: 'Envía al portal gubernamental',
    },
  },
  de: {
    reminder: {
      subject: 'Ihr Visumantrag wartet',
      body: 'Ihr Visumantrag wartet.',
      bodyWithCountry: 'Ihr Visumantrag für {country} wartet.',
      nextStepPrefix: 'Nächster Schritt:',
      resume: 'Antrag fortsetzen →',
      unsubscribe: 'Diese Erinnerungen abbestellen',
    },
    nextStep: {
      intake: 'Beantworten Sie einige Aufnahmefragen',
      documents: 'Laden Sie Ihre erforderlichen Dokumente hoch',
      narrative: 'Erstellen Sie Ihre Begleitschreiben',
      readiness: 'Prüfen Sie Ihren Bereitschaftswert',
      prefill: 'Füllen Sie Ihr Antragsformular vor',
      submission: 'An das Behördenportal übermitteln',
    },
  },
  it: {
    reminder: {
      subject: 'La tua domanda di visto è in attesa',
      body: 'La tua domanda di visto è in attesa.',
      bodyWithCountry: 'La tua domanda di visto per {country} è in attesa.',
      nextStepPrefix: 'Passo successivo:',
      resume: 'Riprendi la tua domanda →',
      unsubscribe: 'Annulla l’iscrizione a questi promemoria',
    },
    nextStep: {
      intake: 'Rispondi ad alcune domande preliminari',
      documents: 'Carica i documenti richiesti',
      narrative: 'Genera le tue lettere di supporto',
      readiness: 'Controlla il tuo punteggio di idoneità',
      prefill: 'Precompila il modulo di domanda',
      submission: 'Invia al portale governativo',
    },
  },
  pt: {
    reminder: {
      subject: 'Sua solicitação de visto está aguardando',
      body: 'Sua solicitação de visto está aguardando.',
      bodyWithCountry:
        'Sua solicitação de visto para {country} está aguardando.',
      nextStepPrefix: 'Próximo passo:',
      resume: 'Retomar sua solicitação →',
      unsubscribe: 'Cancelar inscrição nesses lembretes',
    },
    nextStep: {
      intake: 'Responda a algumas perguntas iniciais',
      documents: 'Envie seus documentos obrigatórios',
      narrative: 'Gere suas cartas de apoio',
      readiness: 'Verifique sua pontuação de prontidão',
      prefill: 'Preencha previamente seu formulário',
      submission: 'Envie ao portal do governo',
    },
  },
  nl: {
    reminder: {
      subject: 'Uw visumaanvraag wacht',
      body: 'Uw visumaanvraag wacht.',
      bodyWithCountry: 'Uw visumaanvraag voor {country} wacht.',
      nextStepPrefix: 'Volgende stap:',
      resume: 'Hervat uw aanvraag →',
      unsubscribe: 'Afmelden voor deze herinneringen',
    },
    nextStep: {
      intake: 'Beantwoord enkele intakevragen',
      documents: 'Upload uw vereiste documenten',
      narrative: 'Genereer uw ondersteunende brieven',
      readiness: 'Controleer uw gereedheidsscore',
      prefill: 'Vul uw aanvraagformulier vooraf in',
      submission: 'Dien in bij het overheidsportaal',
    },
  },
  ar: {
    reminder: {
      subject: 'طلب التأشيرة الخاص بك في الانتظار',
      body: 'طلب التأشيرة الخاص بك في الانتظار.',
      bodyWithCountry: 'طلب تأشيرة {country} الخاص بك في الانتظار.',
      nextStepPrefix: 'الخطوة التالية:',
      resume: '← متابعة طلبك',
      unsubscribe: 'إلغاء الاشتراك في هذه التذكيرات',
    },
    nextStep: {
      intake: 'أجب عن بعض الأسئلة الأولية',
      documents: 'حمّل المستندات المطلوبة',
      narrative: 'أنشئ خطابات الدعم الخاصة بك',
      readiness: 'تحقق من درجة الجاهزية',
      prefill: 'املأ نموذج طلبك مسبقًا',
      submission: 'قدّم إلى البوابة الحكومية',
    },
  },
  tr: {
    reminder: {
      subject: 'Vize başvurunuz bekliyor',
      body: 'Vize başvurunuz bekliyor.',
      bodyWithCountry: '{country} vize başvurunuz bekliyor.',
      nextStepPrefix: 'Sonraki adım:',
      resume: 'Başvurunuza devam edin →',
      unsubscribe: 'Bu hatırlatmalardan çık',
    },
    nextStep: {
      intake: 'Birkaç ön görüşme sorusunu yanıtlayın',
      documents: 'Gerekli belgelerinizi yükleyin',
      narrative: 'Destek mektuplarınızı oluşturun',
      readiness: 'Hazırlık puanınızı kontrol edin',
      prefill: 'Başvuru formunuzu önceden doldurun',
      submission: 'Resmi portala gönderin',
    },
  },
  hi: {
    reminder: {
      subject: 'आपका वीज़ा आवेदन प्रतीक्षारत है',
      body: 'आपका वीज़ा आवेदन प्रतीक्षारत है।',
      bodyWithCountry: '{country} के लिए आपका वीज़ा आवेदन प्रतीक्षारत है।',
      nextStepPrefix: 'अगला चरण:',
      resume: 'अपना आवेदन फिर से शुरू करें →',
      unsubscribe: 'इन अनुस्मारकों की सदस्यता समाप्त करें',
    },
    nextStep: {
      intake: 'कुछ प्रारंभिक प्रश्नों के उत्तर दें',
      documents: 'अपने आवश्यक दस्तावेज़ अपलोड करें',
      narrative: 'अपने समर्थन पत्र तैयार करें',
      readiness: 'अपना तैयारी स्कोर जांचें',
      prefill: 'अपना आवेदन फ़ॉर्म पहले से भरें',
      submission: 'सरकारी पोर्टल पर जमा करें',
    },
  },
  ur: {
    reminder: {
      subject: 'آپ کی ویزا درخواست منتظر ہے',
      body: 'آپ کی ویزا درخواست منتظر ہے۔',
      bodyWithCountry: '{country} کے لیے آپ کی ویزا درخواست منتظر ہے۔',
      nextStepPrefix: 'اگلا مرحلہ:',
      resume: '← اپنی درخواست دوبارہ شروع کریں',
      unsubscribe: 'ان یاد دہانیوں سے رکنیت ختم کریں',
    },
    nextStep: {
      intake: 'چند ابتدائی سوالات کے جواب دیں',
      documents: 'اپنی مطلوبہ دستاویزات اپ لوڈ کریں',
      narrative: 'اپنے معاون خطوط تیار کریں',
      readiness: 'اپنا تیاری اسکور دیکھیں',
      prefill: 'اپنا درخواست فارم پہلے سے بھریں',
      submission: 'سرکاری پورٹل پر جمع کرائیں',
    },
  },
  zh: {
    reminder: {
      subject: '您的签证申请正在等待',
      body: '您的签证申请正在等待。',
      bodyWithCountry: '您的{country}签证申请正在等待。',
      nextStepPrefix: '下一步：',
      resume: '继续您的申请 →',
      unsubscribe: '取消订阅这些提醒',
    },
    nextStep: {
      intake: '回答几个初步问题',
      documents: '上传所需文件',
      narrative: '生成您的支持信函',
      readiness: '查看您的准备评分',
      prefill: '预填您的申请表',
      submission: '提交至政府门户',
    },
  },
  'zh-TW': {
    reminder: {
      subject: '您的簽證申請正在等待',
      body: '您的簽證申請正在等待。',
      bodyWithCountry: '您的{country}簽證申請正在等待。',
      nextStepPrefix: '下一步：',
      resume: '繼續您的申請 →',
      unsubscribe: '取消訂閱這些提醒',
    },
    nextStep: {
      intake: '回答幾個初步問題',
      documents: '上傳所需文件',
      narrative: '產生您的支持信函',
      readiness: '查看您的準備分數',
      prefill: '預先填寫您的申請表',
      submission: '提交至政府入口網站',
    },
  },
  ja: {
    reminder: {
      subject: 'ビザ申請が保留中です',
      body: 'ビザ申請が保留中です。',
      bodyWithCountry: '{country}のビザ申請が保留中です。',
      nextStepPrefix: '次のステップ：',
      resume: '申請を再開する →',
      unsubscribe: 'これらのリマインダーの配信を停止する',
    },
    nextStep: {
      intake: 'いくつかの初回質問に回答する',
      documents: '必要書類をアップロードする',
      narrative: '推薦状を生成する',
      readiness: '準備スコアを確認する',
      prefill: '申請フォームに事前入力する',
      submission: '政府ポータルに提出する',
    },
  },
  ko: {
    reminder: {
      subject: '비자 신청이 대기 중입니다',
      body: '비자 신청이 대기 중입니다.',
      bodyWithCountry: '{country} 비자 신청이 대기 중입니다.',
      nextStepPrefix: '다음 단계:',
      resume: '신청 계속하기 →',
      unsubscribe: '이 알림 수신 거부',
    },
    nextStep: {
      intake: '몇 가지 초기 질문에 답하기',
      documents: '필수 서류 업로드하기',
      narrative: '지원 서한 생성하기',
      readiness: '준비 점수 확인하기',
      prefill: '신청서 미리 채우기',
      submission: '정부 포털에 제출하기',
    },
  },
};

// Keep this set in sync with the keys of MESSAGES (and apps/web/i18n/config.ts).
const SUPPORTED = new Set<string>(Object.keys(MESSAGES));

/** exact match → base subtag → 'en'. Mirrors src/i18n/language.ts behaviour. */
export function resolveEmailLocale(
  code: string | null | undefined,
): EmailLocale {
  if (!code) return 'en';
  if (SUPPORTED.has(code)) return code as EmailLocale;
  const base = code.split('-')[0];
  if (SUPPORTED.has(base)) return base as EmailLocale;
  return 'en';
}

export function messagesFor(code: string | null | undefined): EmailMessages {
  return MESSAGES[resolveEmailLocale(code)];
}
