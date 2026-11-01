import type {
  AppNotification,
  AppProgress,
  Application,
  ApplicantApplicationView,
  ChecklistItem,
  ConsultantCard,
  ConsultantReview,
  Consultation,
  Conversation,
  Document,
  LoginHistoryEntry,
  MessagePage,
  NotificationFeedPage,
  NotificationPreferences,
  UserProfile,
  VriScore,
} from '@visaai/types';
import { api } from './client';
import { expectArray, expectNullableObject, expectObject, expectObjectWith } from './validate';

/**
 * Typed wrappers over the *existing* VisaAI REST surface. Every path here was
 * read off a controller in apps/api/src/modules — nothing is invented. Response
 * types come from @visaai/types (the same package apps/web consumes) so the
 * three clients cannot drift.
 *
 * Route provenance is noted per group for future readers.
 */

// ── Identity (modules/me, modules/iam) ───────────────────────────────────
export interface MeResponse {
  id: string;
  email: string;
  appRole: 'admin' | 'consultant' | 'user';
  isAnonymous: boolean;
}

export const meApi = {
  /** GET /me — also the cheapest liveness check for "is my token still good". */
  get: () => api.get<MeResponse>('/me', { auth: 'required' }),
  getLanguage: () => api.get<{ language: string | null }>('/me/language', { auth: 'required' }),
  setLanguage: (language: string) =>
    api.patch<{ language: string }>('/me/language', { language }, { auth: 'required' }),
  profile: () => api.get<UserProfile>('/me/profile', { auth: 'required' }),
  updateProfile: (patch: Partial<UserProfile>) =>
    api.patch<UserProfile>('/me/profile', patch, { auth: 'required' }),
  loginHistory: () => api.get<LoginHistoryEntry[]>('/me/login-history', { auth: 'required' }),
  mfaStatus: () =>
    api.get<{ enabled: boolean; aal: string | null }>('/me/mfa', { auth: 'required' }),
  /** Records an MFA lifecycle event for the auth audit log. */
  mfaEvent: (event: string) => api.post<void>('/me/mfa/event', { event }, { auth: 'required' }),
};

// ── Privacy (modules/privacy — GDPR/PIPEDA) ──────────────────────────────
export const privacyApi = {
  /** GET /me/privacy/export — full data portability bundle. */
  export: () => api.get<Record<string, unknown>>('/me/privacy/export', { auth: 'required' }),
  /**
   * POST /me/privacy/delete — irreversible erasure. The API requires the exact
   * confirmation string; the UI must collect it explicitly.
   */
  requestDeletion: () =>
    api.post<{ status: string }>(
      '/me/privacy/delete',
      { confirmation: 'DELETE' },
      { auth: 'required' },
    ),
};

// ── Intake / applications (modules/intake, modules/progress) ─────────────
export interface IntakeMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

export const applicationsApi = {
  /**
   * POST /intake/applications — creates the application + starts the graph.
   *
   * The server accepts { country, state?, frameworkId? } and returns
   * `{ applicationId }`, NOT an Application. There is no `visaType` field: the
   * visa program is resolved from the framework, so sending one silently did
   * nothing (Nest strips unknown keys).
   */
  create: (input: { country: string; state?: string; frameworkId?: string }) =>
    api.post<{ applicationId: string }>('/intake/applications', input, {
      auth: 'required',
      validate: expectObjectWith('applicationId'),
    }),
  get: (applicationId: string) =>
    api.get<Application>(`/intake/applications/${applicationId}`, { auth: 'required' }),
  checklist: (applicationId: string) =>
    api.get<ChecklistItem[]>(`/intake/applications/${applicationId}/checklist`, {
      auth: 'required',
      validate: expectArray,
    }),
  messages: (applicationId: string) =>
    api.get<IntakeMessage[]>(`/intake/applications/${applicationId}/messages`, {
      auth: 'required',
    }),
  /**
   * GET /applicant/applications — the caller's own applications, with derived
   * assignment status. Replaces the direct Supabase table read the dashboard
   * used to do, which bypassed retry/timeout/error classification.
   */
  list: () =>
    api.get<ApplicantApplicationView[]>('/applicant/applications', {
      auth: 'required',
      validate: expectArray,
    }),
  /** GET /progress/:id — stage machine used by the dashboard + stage nav. */
  progress: (applicationId: string) =>
    api.get<AppProgress>(`/progress/${applicationId}`, { auth: 'required' }),
};

// ── Eligibility / AI (modules/visa, modules/vri) ─────────────────────────
export interface VisaAnalysis {
  ok: boolean;
  research: unknown;
  evaluation: unknown;
  /** Human-readable markdown report produced by the copywriter stage. */
  report: string;
}

export const aiApi = {
  /**
   * POST /visa/analyze — research → evaluation → report pipeline.
   *
   * Contract per apps/api/src/modules/visa/visa.dto.ts: { country, visaType,
   * profile, notes? } are ALL required, and the response is
   * { ok, research, evaluation, report } — there is no `suggestions` array.
   */
  analyze: (body: { country: string; visaType: string; profile: string; notes?: string }) =>
    api.post<VisaAnalysis>('/visa/analyze', body, {
      auth: 'required',
      timeoutMs: 120000,
      validate: expectObjectWith('report'),
    }),
  /** POST /vri/:id/calculate — recompute the Visa Readiness Index (slow, AI-backed). */
  calculateVri: (applicationId: string) =>
    api.post<VriScore>(`/vri/${applicationId}/calculate`, undefined, {
      auth: 'required',
      timeoutMs: 90000,
    }),
  vri: (applicationId: string) => api.get<VriScore>(`/vri/${applicationId}`, { auth: 'required' }),
  applyVriSuggestion: (applicationId: string, suggestionId: string) =>
    api.post<VriScore>(`/vri/${applicationId}/apply-suggestion/${suggestionId}`, undefined, {
      auth: 'required',
    }),
};

// ── Documents (modules/documents) ────────────────────────────────────────
export interface PresignResponse {
  uploadUrl: string;
  storagePath: string;
  token: string;
}

export const documentsApi = {
  presign: (applicationId: string, body: { fileName: string; mimeType: string }) =>
    api.post<PresignResponse>(`/documents/presign/${applicationId}`, body, { auth: 'required' }),
  register: (
    applicationId: string,
    body: { storagePath: string; mimeType: string; fileName: string; checklistItemId?: string },
  ) => api.post<Document>(`/documents/register/${applicationId}`, body, { auth: 'required' }),
  list: (applicationId: string) =>
    api.get<Document[]>(`/documents/${applicationId}`, {
      auth: 'required',
      validate: expectArray,
    }),
  remove: (documentId: string) =>
    api.delete<{ ok?: boolean }>(`/documents/item/${documentId}`, undefined, { auth: 'required' }),
};

// ── Messaging (modules/messaging) ────────────────────────────────────────
export const messagingApi = {
  thread: (applicationId: string) =>
    api.get<Conversation>(`/messaging/${applicationId}`, { auth: 'required' }),
  /** Keyset pagination is `before` (an ISO createdAt) + `limit` — not `cursor`. */
  messages: (applicationId: string, before?: string, limit = 50) =>
    api.get<MessagePage>(`/messaging/${applicationId}/messages`, {
      auth: 'required',
      query: { before, limit },
      validate: expectObject,
    }),
  /**
   * `clientId` is an idempotency key (UUID). A replay with the same key by the
   * same sender in the same conversation resolves to the existing message
   * instead of creating a duplicate — see the partial unique index in
   * supabase/migrations/20260805040000_message_idempotency.sql.
   */
  send: (
    applicationId: string,
    body: { body: string; category?: string; clientId?: string },
  ) =>
    api.post<{ id: string }>(`/messaging/${applicationId}/messages`, body, { auth: 'required' }),
  markRead: (applicationId: string) =>
    api.post<void>(`/messaging/${applicationId}/read`, undefined, { auth: 'required' }),
  typing: (applicationId: string) =>
    api.post<void>(`/messaging/${applicationId}/typing`, undefined, { auth: 'required' }),
  notifications: () =>
    api.get<AppNotification[]>('/messaging/notifications', {
      auth: 'required',
      validate: expectArray,
    }),
  attachmentUploadUrl: (applicationId: string, body: { fileName: string; mimeType: string }) =>
    api.post<{ uploadUrl: string; storagePath: string; token?: string }>(
      `/messaging/${applicationId}/attachments/upload-url`,
      body,
      { auth: 'required' },
    ),
  registerAttachment: (
    applicationId: string,
    body: { storagePath: string; fileName: string; mimeType: string; sizeBytes?: number },
  ) =>
    api.post<{ id: string }>(`/messaging/${applicationId}/attachments`, body, {
      auth: 'required',
    }),
  attachmentUrl: (attachmentId: string) =>
    api.get<{ url: string }>(`/messaging/attachments/${attachmentId}/url`, { auth: 'required' }),
};

// ── Notifications (modules/notifications) ────────────────────────────────
export const notificationsApi = {
  feed: (limit = 20, cursor?: string) =>
    api.get<NotificationFeedPage>('/notifications', {
      auth: 'required',
      query: { limit, cursor },
      validate: expectObjectWith('rows'),
    }),
  /** Server returns `{ unread }`, not `{ count }`. */
  unreadCount: () =>
    api.get<{ unread: number }>('/notifications/unread-count', {
      auth: 'required',
      validate: expectObjectWith('unread'),
    }),
  markRead: (id: string) =>
    api.post<void>(`/notifications/${id}/read`, undefined, { auth: 'required' }),
  markAllRead: () => api.post<void>('/notifications/read-all', undefined, { auth: 'required' }),
  preferences: () =>
    api.get<NotificationPreferences>('/notifications/preferences', { auth: 'required' }),
  updatePreferences: (patch: Partial<NotificationPreferences>) =>
    api.patch<NotificationPreferences>('/notifications/preferences', patch, { auth: 'required' }),
  /** Device (APNs/FCM) token registration — added for mobile, see modules/notifications. */
  registerDevice: (body: {
    token: string;
    platform: 'ios' | 'android';
    deviceName?: string | null;
    appVersion?: string | null;
  }) => api.post<{ id: string }>('/notifications/devices', body, { auth: 'required' }),
  unregisterDevice: (token: string) =>
    api.delete<{ ok: true }>('/notifications/devices', { token }, { auth: 'required' }),
};

// ── Marketplace + booking (modules/marketplace, modules/consultations) ───
export const consultantsApi = {
  /**
   * GET /marketplace/consultants — returns a BARE ARRAY, not `{ items }`.
   *
   * Query keys are snake_case here (`visa_type`) while the rest of the platform
   * is camelCase; DiscoveryQueryDto strips unknown keys, so camelCase filters
   * were accepted and silently ignored. There is no `limit` parameter.
   */
  browse: (query: { country?: string; visa_type?: string; language?: string }) =>
    api.get<ConsultantCard[]>('/marketplace/consultants', {
      auth: 'required',
      query,
      validate: expectArray,
    }),
  get: (id: string) =>
    api.get<ConsultantCard>(`/marketplace/consultants/${id}`, {
      auth: 'required',
      validate: expectObject,
    }),
  reviews: (id: string) =>
    api.get<ConsultantReview[]>(`/marketplace/consultants/${id}/reviews`, {
      auth: 'required',
      validate: expectArray,
    }),
  /** `application_id` is snake_case per CreateReviewDto. */
  review: (id: string, body: { rating: number; feedback?: string; application_id?: string }) =>
    api.post<ConsultantReview>(`/marketplace/consultants/${id}/reviews`, body, {
      auth: 'required',
    }),
  /** GET /consultations/consultants/:id/slots — availability windows in the consultant's tz. */
  slots: (consultantId: string, from: string, to: string) =>
    api.get<{ timezone: string; slots: { start: string; end: string }[] }>(
      `/consultations/consultants/${consultantId}/slots`,
      { auth: 'required', query: { from, to } },
    ),
  book: (body: {
    consultantId: string;
    scheduledStart: string;
    scheduledEnd: string;
    timezone: string;
    applicationId?: string;
    provider?: 'zoom' | 'google_meet' | 'ms_teams';
  }) => api.post<Consultation>('/consultations', body, { auth: 'required' }),
  bookings: () =>
    api.get<Consultation[]>('/consultations', { auth: 'required', validate: expectArray }),
  cancelBooking: (id: string) =>
    api.post<Consultation>(`/consultations/${id}/cancel`, undefined, { auth: 'required' }),
  rescheduleBooking: (
    id: string,
    body: { scheduledStart: string; scheduledEnd: string; timezone: string },
  ) => api.post<Consultation>(`/consultations/${id}/reschedule`, body, { auth: 'required' }),
};

// ── Billing + subscriptions (modules/billing, modules/subscriptions) ─────
export interface CheckoutSession {
  url: string;
  sessionId?: string;
}

export const billingApi = {
  /**
   * POST /billing/checkout — Stripe Checkout, opened in the system browser.
   *
   * CheckoutBodyDto requires ALL of applicationId (uuid), planTier, successUrl
   * and cancelUrl. The previous `{ plan }` shape was rejected with a 400 every
   * time, so upgrade never worked.
   */
  checkout: (body: {
    applicationId: string;
    planTier: 'self_service' | 'copilot' | 'expert';
    successUrl: string;
    cancelUrl: string;
  }) => api.post<CheckoutSession>('/billing/checkout', body, { auth: 'required' }),
  portal: (returnUrl?: string) =>
    api.post<CheckoutSession>('/billing/portal', { returnUrl }, { auth: 'required' }),
  history: () =>
    api.get<
      {
        id: string;
        amount_cents?: number;
        currency?: string;
        status?: string;
        created_at?: string;
        invoice_url?: string | null;
      }[]
    >('/billing/history', { auth: 'required', validate: expectArray }),
};

export const subscriptionsApi = {
  mine: () =>
    api.get<{
      status?: string;
      plan?: string;
      tier?: string;
      current_period_end?: string;
      cancel_at_period_end?: boolean;
    } | null>('/subscriptions/me', { auth: 'required', validate: expectNullableObject }),
  pause: () => api.post<unknown>('/subscriptions/pause', {}, { auth: 'required' }),
  resume: () => api.post<unknown>('/subscriptions/resume', {}, { auth: 'required' }),
  cancel: (immediate = false) =>
    api.post<unknown>('/subscriptions/cancel', { immediate }, { auth: 'required' }),
};

// ── Reference data (modules/countries) ───────────────────────────────────
export const referenceApi = {
  /** Server wraps the list: `{ countries: [...] }`. */
  countries: () =>
    api.get<{ countries: { code: string; name: string }[] }>('/countries', {
      auth: 'optional',
      validate: expectObjectWith('countries'),
    }),
};

// ── Feature flags (modules/feature-flags) ────────────────────────────────
/**
 * Evaluated booleans only — the server never sends targeting rules to a client.
 * `auth: 'optional'` because the flags endpoint is `@AllowAnonymous`: the beta
 * banner and the kill switches have to resolve before the user signs in.
 */
export const featureFlagsApi = {
  get: () =>
    api.get<{ flags: Record<string, boolean> }>('/feature-flags', {
      auth: 'optional',
      validate: expectObjectWith('flags'),
    }),
};

// ── Beta feedback (modules/feedback) ─────────────────────────────────────
export interface SubmitFeedbackBody {
  kind: 'bug' | 'feature_request' | 'satisfaction' | 'ai_response' | 'consultant' | 'other';
  rating?: number | null;
  message?: string;
  surface: 'ios' | 'android';
  appVersion?: string;
  applicationId?: string | null;
  diagnosticsConsent?: boolean;
  /** Allowlisted server-side; unrecognised keys are dropped, not rejected. */
  device?: Record<string, string | number | boolean>;
}

export const feedbackApi = {
  submit: (body: SubmitFeedbackBody) =>
    api.post<{ id: string; kind: string; status: string; created_at: string }>(
      '/feedback',
      body,
      { auth: 'required', validate: expectObject },
    ),
  mine: () =>
    api.get<
      {
        id: string;
        kind: string;
        rating: number | null;
        message: string;
        status: string;
        resolution: string | null;
        created_at: string;
      }[]
    >('/feedback/mine', { auth: 'required', validate: expectArray }),
};
