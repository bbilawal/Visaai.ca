/**
 * Mobile message catalogue.
 *
 * apps/web ships 15 locales via next-intl (apps/web/messages/*.json). Those
 * catalogues are keyed to web screens, so mobile keeps its own — but the locale
 * list, the RTL set, and the key-naming convention are shared so a string can
 * be moved between the two without renaming.
 *
 * English is the fallback for every missing key: a visible English string beats
 * a raw `dashboard.title` token in front of a user.
 */
export const SUPPORTED_LOCALES = [
  'en',
  'fr',
  'es',
  'pt',
  'de',
  'it',
  'nl',
  'tr',
  'ar',
  'ur',
  'hi',
  'zh',
  'zh-TW',
  'ja',
  'ko',
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Right-to-left scripts — drives I18nManager.forceRTL and text alignment. */
export const RTL_LOCALES: ReadonlySet<string> = new Set(['ar', 'ur', 'fa', 'he']);

export type MessageKey = keyof typeof en;

const en = {
  'common.appName': 'VisaAI',
  'common.continue': 'Continue',
  'common.cancel': 'Cancel',
  'common.retry': 'Try again',
  'common.save': 'Save',
  'common.saved': 'Saved',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.loading': 'Loading',
  'common.offline': "You're offline",
  'common.offlineBody': 'Changes are saved on this device and will sync automatically.',
  'common.error': 'Something went wrong',
  'common.required': 'Required',

  'auth.signIn': 'Sign in',
  'auth.signUp': 'Create account',
  'auth.signOut': 'Sign out',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.forgotPassword': 'Forgot your password?',
  'auth.resetPassword': 'Reset password',
  'auth.resetSent': 'Check your email for a reset link.',
  'auth.verifyEmail': 'Verify your email',
  'auth.verifyEmailBody': 'We sent a confirmation link to {email}.',
  'auth.mfaTitle': 'Two-factor authentication',
  'auth.mfaBody': 'Enter the 6-digit code from your authenticator app.',
  'auth.mfaCode': 'Authentication code',
  'auth.biometricUnlock': 'Unlock',
  'auth.biometricPrompt': 'Unlock VisaAI',
  'auth.lockedTitle': 'VisaAI is locked',
  'auth.lockedBody': 'Unlock to view your immigration information.',
  'auth.sessionExpired': 'Your session expired. Please sign in again.',
  'auth.lockedOut': 'Too many attempts. Try again later.',
  'auth.termsAgree': 'I agree to the Terms and acknowledge the immigration disclaimer.',

  'dashboard.title': 'Your applications',
  'dashboard.empty': 'No applications yet',
  'dashboard.emptyBody': 'Start with an eligibility check to see which visas fit your situation.',
  'dashboard.startApplication': 'Start an application',
  'dashboard.tasks': 'Outstanding tasks',
  'dashboard.documents': 'Documents needed',
  'dashboard.appointments': 'Appointments',
  'dashboard.messages': 'Messages',
  'dashboard.activity': 'Recent activity',
  'dashboard.recommendations': 'AI recommendations',

  'application.progress': 'Progress',
  'application.stage.intake': 'Intake',
  'application.stage.documents': 'Documents',
  'application.stage.narrative': 'Documents drafted',
  'application.stage.readiness': 'Readiness',
  'application.stage.submission': 'Submission',
  'application.stage.tracking': 'Tracking',
  'application.draftRestored': 'Draft restored from this device',
  'application.unsavedChanges': 'You have unsaved changes',
  'application.discardChanges': 'Discard changes?',
  'application.submit': 'Submit application',
  'application.review': 'Review before submitting',

  'eligibility.title': 'Eligibility check',
  'eligibility.describeSituation': 'Describe your situation',
  'eligibility.analyzing': 'Analyzing your situation',
  'eligibility.results': 'Suggested visa routes',
  'eligibility.confidence': 'Confidence',
  'eligibility.uncertain': 'Low confidence — a consultant should review this.',
  'eligibility.disclaimer':
    'AI guidance only. This is not legal advice and does not guarantee any immigration outcome. A qualified consultant reviews your case before submission.',
  'eligibility.escalate': 'Request a human review',

  'documents.title': 'Documents',
  'documents.capture': 'Take a photo',
  'documents.choose': 'Choose from library',
  'documents.file': 'Choose a file',
  'documents.uploading': 'Uploading',
  'documents.processing': 'Reading your document',
  'documents.uploadFailed': 'Upload failed',
  'documents.retryUpload': 'Retry upload',
  'documents.cancelUpload': 'Cancel upload',
  'documents.tooLarge': 'That file is larger than {max} MB.',
  'documents.badType': 'Only PDF, JPEG, PNG and HEIC files are accepted.',
  'documents.blurry': 'This photo looks blurry or dark. Retake it for better results.',
  'documents.ocrReview': 'Check what we read',
  'documents.ocrFailed': "We couldn't read this document. You can still submit it.",

  'messages.title': 'Messages',
  'messages.placeholder': 'Write a message',
  'messages.send': 'Send',
  'messages.failedToSend': 'Not sent',
  'messages.queued': 'Will send when you are back online',
  'messages.attachment': 'Attachment',

  'booking.title': 'Book a consultation',
  'booking.consultants': 'Consultants',
  'booking.availability': 'Available times',
  'booking.noSlots': 'No available times in this range.',
  'booking.confirm': 'Confirm booking',
  'booking.booked': 'Booking requested',
  'booking.cancel': 'Cancel booking',
  'booking.timezoneNote': 'Times are shown in your device timezone ({tz}).',

  'billing.title': 'Plan and billing',
  'billing.currentPlan': 'Current plan',
  'billing.manage': 'Manage subscription',
  'billing.upgrade': 'Upgrade',
  'billing.history': 'Payment history',
  'billing.opensBrowser': 'Payments open in your browser for security.',
  'billing.noSubscription': 'No active subscription',

  'settings.title': 'Settings',
  'settings.profile': 'Profile',
  'settings.notifications': 'Notifications',
  'settings.language': 'Language',
  'settings.security': 'Security',
  'settings.biometrics': 'Biometric unlock',
  'settings.privacy': 'Privacy',
  'settings.exportData': 'Download my data',
  'settings.deleteAccount': 'Delete my account',
  'settings.deleteAccountWarning':
    'This permanently deletes your account, applications and documents. It cannot be undone.',
  'settings.deleteConfirmPrompt': 'Type DELETE to confirm',
} as const;

type Catalogue = Partial<Record<MessageKey, string>>;

/**
 * Non-English catalogues are partial by design — anything absent falls back to
 * English rather than blocking a release on a complete translation pass.
 * French is the second launch language (Canada corridor).
 */
const fr: Catalogue = {
  'common.continue': 'Continuer',
  'common.cancel': 'Annuler',
  'common.retry': 'Réessayer',
  'common.save': 'Enregistrer',
  'common.saved': 'Enregistré',
  'common.delete': 'Supprimer',
  'common.close': 'Fermer',
  'common.loading': 'Chargement',
  'common.offline': 'Vous êtes hors ligne',
  'common.offlineBody':
    'Vos modifications sont enregistrées sur cet appareil et seront synchronisées automatiquement.',
  'common.error': 'Une erreur est survenue',
  'common.required': 'Obligatoire',
  'auth.signIn': 'Se connecter',
  'auth.signUp': 'Créer un compte',
  'auth.signOut': 'Se déconnecter',
  'auth.email': 'Courriel',
  'auth.password': 'Mot de passe',
  'auth.forgotPassword': 'Mot de passe oublié ?',
  'auth.resetPassword': 'Réinitialiser le mot de passe',
  'auth.lockedTitle': 'VisaAI est verrouillé',
  'auth.lockedBody': 'Déverrouillez pour consulter vos informations d’immigration.',
  'auth.sessionExpired': 'Votre session a expiré. Veuillez vous reconnecter.',
  'dashboard.title': 'Vos demandes',
  'dashboard.empty': 'Aucune demande pour le moment',
  'dashboard.startApplication': 'Commencer une demande',
  'dashboard.documents': 'Documents requis',
  'dashboard.messages': 'Messages',
  'eligibility.title': 'Vérification d’admissibilité',
  'eligibility.disclaimer':
    'Conseils générés par IA. Ceci ne constitue pas un avis juridique et ne garantit aucun résultat en matière d’immigration. Un consultant qualifié révise votre dossier avant la soumission.',
  'documents.title': 'Documents',
  'documents.capture': 'Prendre une photo',
  'documents.uploading': 'Téléversement',
  'messages.title': 'Messages',
  'messages.send': 'Envoyer',
  'booking.title': 'Réserver une consultation',
  'settings.title': 'Paramètres',
  'settings.language': 'Langue',
  'settings.security': 'Sécurité',
  'settings.privacy': 'Confidentialité',
};

export const CATALOGUES: Record<string, Catalogue> = { en, fr };

export const fallbackCatalogue = en;
