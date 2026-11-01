/**
 * Generated Supabase schema types (DEBT-001).
 *
 * Source of the `any` that produced ~1,884 no-unsafe-* lint errors:
 * SupabaseService declared `SupabaseClient` with no generic, so it resolved
 * to SupabaseClient<any> and every .from().select() chain was untyped.
 *
 * Regenerate after a migration:
 *   npx supabase@latest gen types typescript --local \
 *     > packages/types/src/database.types.ts
 */
export type { Database, Json } from './database.types';
export * from './stay-dates';
export * from './intake-requirements';
export * from './super-visa';
export * from './canada-eta';
export * from './canada-express-entry';
export * from './canada-spousal-sponsorship';
export * from './canada-study-permit';
export * from './canada-work-permit';
import { CA_ETA_VISAAI_ID } from './canada-eta';
export * from './business-visitor';
export * from './route-letters';

export type PlanTier = 'none' | 'self_service' | 'copilot' | 'expert'

export type PaidPlanTier = Exclude<PlanTier, 'none'>

/**
 * Plan prices, in CENTS. Shared because two codebases quote them to users and
 * they must never disagree.
 *
 * THE BUG THIS FIXES: apps/api/src/modules/billing/plan-prices.ts charged
 * `expert: 25000` ($250) while apps/web/lib/plan-error.ts told the user
 * "Expert Review ($100)" in the toast shown on every gated 403. The two
 * numbers were independent literals in two packages, so nothing could detect
 * the drift — and the number the user READ was the one that was wrong.
 *
 * Cents, not dollars, because that is the unit Stripe charges in; deriving the
 * display string from the charged amount is the only ordering that cannot
 * drift. Anything that shows a price to a user must format it from here.
 */
export const PLAN_PRICE_CENTS: Record<PaidPlanTier, number> = {
  self_service: 1000,
  copilot: 3000,
  expert: 25000,
}

export const PLAN_LABELS: Record<PaidPlanTier, string> = {
  self_service: 'Self-Service',
  copilot: 'AI Copilot',
  expert: 'Expert Review',
}

/** "$250" for a whole-dollar price, "$12.50" when there are cents. */
export function formatPlanPrice(tier: PaidPlanTier): string {
  const cents = PLAN_PRICE_CENTS[tier]
  return cents % 100 === 0
    ? `$${cents / 100}`
    : `$${(cents / 100).toFixed(2)}`
}

/** "Expert Review ($250)" — the single source for any user-facing plan label. */
export function planLabelWithPrice(tier: PaidPlanTier): string {
  return `${PLAN_LABELS[tier]} (${formatPlanPrice(tier)})`
}

/**
 * One-time "AI Prefilled Application Form" fee, in CENTS (USD), per visa type.
 * Same rule as PLAN_PRICE_CENTS: the API charges from here and the web app
 * formats its display from here, so the two cannot drift.
 *
 * Keyed by `visa_types.visaai_id`. Anything not listed pays the default. The
 * Canada eTA is a single short form, so it is priced lower (owner decision
 * 2026-10-18); IRCC's own CAD $7 eTA fee is separate and paid on IRCC's site.
 */
export const PREFILL_PRICE_CENTS_DEFAULT = 2900

export const PREFILL_PRICE_CENTS_BY_VISA: Readonly<Record<string, number>> = {
  [CA_ETA_VISAAI_ID]: 1000,
}

/** The form fee in cents for an application's visa type (default when unknown). */
export function prefillPriceCents(visaaiId?: string | null): number {
  if (visaaiId && Object.prototype.hasOwnProperty.call(PREFILL_PRICE_CENTS_BY_VISA, visaaiId)) {
    return PREFILL_PRICE_CENTS_BY_VISA[visaaiId]
  }
  return PREFILL_PRICE_CENTS_DEFAULT
}

/** "$10" / "$29" — the form fee as shown to the applicant. */
export function formatPrefillPrice(visaaiId?: string | null): string {
  const cents = prefillPriceCents(visaaiId)
  return cents % 100 === 0
    ? `$${cents / 100}`
    : `$${(cents / 100).toFixed(2)}`
}

export type ApplicationStatus = 'draft' | 'ready' | 'submitted' | 'decided'

export type ChecklistItemStatus = 'missing' | 'uploaded' | 'verified' | 'waived'

export type OcrStatus = 'pending' | 'complete' | 'failed'

export type DocumentUploadStatus = 'pending' | 'complete' | 'failed'

export type VerificationResult = 'pass' | 'warn' | 'fail'

export type PostSubmissionEventType =
  | 'biometrics'
  | 'passport_request'
  | 'adr'
  | 'medical'
  | 'approval'
  | 'refusal'

export interface User {
  id: string
  email: string
  full_name: string | null
  nationality: string | null
  stripe_customer_id: string | null
  created_at: string
}

export interface Application {
  id: string
  user_id: string
  framework_id: string | null
  destination_country: string | null
  destination_state: string | null
  status: ApplicationStatus
  plan_tier: PlanTier
  vri_score: number | null
  submitted_at: string | null
  decision_at: string | null
  created_at: string
}

export type ChecklistItemKind = 'form' | 'document'

export type ChecklistOwner = 'applicant' | 'sponsor'

/** Per-document preparation requirements surfaced to the user (AI-generated). */
export interface DocumentSpecs {
  format?: string
  dimensions?: string
  file_requirements?: string
  validity?: string
  /** Where/how to obtain this evidence (e.g. "Land registry office", "Your bank"). */
  source?: string
  notes?: string
}

export interface ChecklistItemMeta {
  kind?: ChecklistItemKind
  owner?: ChecklistOwner
  /** True for optional case-strengthening documents (not officially required). */
  strength?: boolean
  form_code?: string | null
  form_name?: string | null
  source_url?: string | null
  specs?: DocumentSpecs
  /**
   * Set on items that request a family member's civil document the profile
   * still lacks (a child's birth certificate, the spouse's ID, the marriage
   * certificate). `resolved` once the data arrived while a document is
   * attached.
   */
  family_gap?: { key: string; person?: string; resolved?: boolean } | null
  /** The item needs the client's attention, e.g. a flagged marriage date. */
  needs_attention?: boolean
  /** Why the item needs attention — shown with it. */
  attention_message?: string | null
}

export interface ChecklistItem {
  id: string
  application_id: string
  document_type: string
  label: string
  required: boolean
  status: ChecklistItemStatus
  added_reason: string | null
  meta?: ChecklistItemMeta | null
}

export interface Document {
  id: string
  application_id: string
  checklist_item_id: string | null
  storage_path: string
  mime_type: string
  file_name: string
  encrypted: boolean
  upload_status: DocumentUploadStatus
  ocr_status: OcrStatus
  created_at: string
}

export interface VriScore {
  id: string
  application_id: string
  overall_score: number
  documentation_pct: number
  financial_pct: number
  travel_history_pct: number
  home_ties_pct: number
  employment_pct: number
  consistency_pct: number
  calculated_at: string
}

export interface VriRecommendation {
  id: string
  vri_score_id: string
  factor: string
  issue: string
  recommendation_text: string
  priority: number
}

export type GeneratedDocType =
  | 'loe'
  | 'itinerary'
  | 'cover_letter'
  | 'invitation_letter'
  | 'prefilled_form_json'

export interface GeneratedDocument {
  id: string
  application_id: string
  doc_type: GeneratedDocType
  content_md: string
  approved_by_user: boolean
  generated_at: string
}

export type BillingFeature = 'plan' | 'prefill'

export interface PrefilledFormField {
  key: string
  label: string
  value: string
  group?: string
  /**
   * 'consultant' = corrected by the assigned consultant; 'applicant' = changed
   * by the applicant on the Forms page. Set by the server only — a client-sent
   * source is ignored.
   */
  source?: 'profile' | 'document' | 'inferred' | 'consultant' | 'applicant'
  /** Why this value needs a human look (e.g. it belongs to the host, or was derived). */
  note?: string
  /** True when the applicant must confirm or replace the value before submitting. */
  needsReview?: boolean
}

export interface PrefilledFormPayload {
  visaType: string
  countryCode: string
  purpose: string
  generatedAt: string
  fields: PrefilledFormField[]
}

export interface CountryFramework {
  id: string
  country_code: string
  visa_type: string
  purpose: string
  requirements_json: Record<string, unknown>
  updated_at: string
}

export type StageSlug =
  | 'intake' | 'documents' | 'narrative' | 'prefill'
  | 'readiness' | 'submission'

export type StageState = 'locked' | 'available' | 'in_progress' | 'complete'

/**
 * Display AND progression order. `prefill` (the "Forms" stage) sits before
 * `readiness`: the forms are drafted from the documents the previous stage
 * verified, and the readiness score is the last checkpoint before submitting.
 * `computeProgress` derives `currentStage` by taking the first non-complete
 * stage in this array, so reordering here reorders the funnel — keep it in
 * sync with STAGES in apps/web/components/layout/stage-nav.tsx.
 */
export const STAGE_ORDER: StageSlug[] = [
  'intake', 'documents', 'narrative', 'prefill', 'readiness', 'submission',
]

export interface StageProgress {
  slug: StageSlug
  state: StageState
  pct: number
}

/**
 * "Has the applicant finished uploading?" — the ONE definition.
 *
 * This rule gates real behaviour in three places: the server auto-generates a
 * prefill when it goes true (`PrefillService.autoGenerateIfReady`), the
 * documents page unlocks its Generate button on it, and `computeProgress`
 * reports the documents stage complete by it. Three hand-rolled copies would
 * drift, and a drift here means the button says "ready" while the server
 * disagrees — so they all call this.
 *
 * FORMS ARE EXCLUDED. A checklist item of kind 'form' is a blank government
 * form we hand the applicant, not evidence they upload; counting it would make
 * completion unreachable. Optional items are excluded too — "strengthen your
 * case" suggestions must never block the flow.
 */
export interface ChecklistCompletionItem {
  status: ChecklistItemStatus
  required?: boolean | null
  meta?: { kind?: string | null } | null
}

/** An item is satisfied when it is verified, or explicitly waived. */
export function isChecklistItemSatisfied(item: ChecklistCompletionItem): boolean {
  return item.status === 'verified' || item.status === 'waived'
}

/** The items that actually gate completion: required, and not a form. */
export function requiredDocumentItems<T extends ChecklistCompletionItem>(
  items: T[],
): T[] {
  return items.filter(item => item.required === true && item.meta?.kind !== 'form')
}

export interface DocumentsCompletion {
  /** Required, non-form items — the denominator shown to the user. */
  total: number
  /** How many of those are verified or waived. */
  done: number
  /**
   * True only when there is at least one required document AND every one is
   * satisfied. An empty checklist is NOT complete: it means intake has not
   * produced requirements yet, and reporting "done" there would unlock a
   * Generate button with nothing to generate from.
   */
  complete: boolean
}

export function documentsCompletion(
  items: ChecklistCompletionItem[],
): DocumentsCompletion {
  const required = requiredDocumentItems(items)
  const done = required.filter(isChecklistItemSatisfied).length
  return {
    total: required.length,
    done,
    complete: required.length > 0 && done === required.length,
  }
}

export interface ProgressInput {
  applicationId: string
  status: 'draft' | 'ready' | 'submitted' | 'decided'
  hasProfile: boolean
  intakeDone: boolean
  /**
   * Required checklist items — `meta` included ON PURPOSE. Without it
   * `requiredDocumentItems` cannot tell a blank government form from a document
   * the applicant must upload, so a form item counts as an outstanding upload
   * and the Documents stage can never complete (which also leaves Submit locked
   * forever, since `locked.submission` is derived from it).
   */
  requiredChecklist: {
    status: 'missing' | 'uploaded' | 'verified' | 'waived'
    meta?: { kind?: string | null } | null
  }[]
  requiredGenTypes: string[]
  approvedGenTypes: string[]
  hasVriScore: boolean
  hasPrefill: boolean
  submissionStatus: 'pending' | 'active' | 'paused' | 'complete' | 'error' | null
  lastActiveAt: string
  now: string
}

export interface AppProgress {
  applicationId: string
  stages: StageProgress[]
  currentStage: StageSlug
  overallPct: number
  nextAction: { stage: StageSlug; label: string; href: string }
  lastActiveAt: string
  stalledDays: number
}

const NEXT_LABEL: Record<StageSlug, string> = {
  intake: 'Answer a few intake questions',
  documents: 'Upload your required documents',
  narrative: 'Generate your supporting letters',
  readiness: 'Check your readiness score',
  prefill: 'Prefill your application form',
  submission: 'Submit to the government portal',
}

function ratio(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((done / total) * 100)
}

export function computeProgress(input: ProgressInput): AppProgress {
  // ONE definition of "the items that gate the documents stage", shared by the
  // percentage and the complete/locked decision below. Computing the percentage
  // over the raw list counted blank government forms as outstanding uploads, so
  // an applicant who had uploaded everything saw 67% and a locked Submit.
  const gatingItems = requiredDocumentItems(
    input.requiredChecklist.map(c => ({
      status: c.status,
      required: true,
      meta: c.meta ?? null,
    })),
  )

  const pct: Record<StageSlug, number> = {
    intake: input.intakeDone ? 100 : input.hasProfile ? 50 : 0,
    documents: ratio(
      gatingItems.filter(isChecklistItemSatisfied).length,
      gatingItems.length,
    ),
    // A route that needs no letters (Canada's eTA) has nothing to do here:
    // 100, not 0 — see route-letters.ts.
    narrative: input.requiredGenTypes.length === 0
      ? 100
      : ratio(
          input.requiredGenTypes.filter(t => input.approvedGenTypes.includes(t)).length,
          input.requiredGenTypes.length,
        ),
    readiness: input.hasVriScore ? 100 : 0,
    prefill: input.hasPrefill ? 100 : 0,
    submission: input.submissionStatus === 'complete' ? 100
      : input.submissionStatus === 'active' || input.submissionStatus === 'paused' ? 50 : 0,
  }

  // Same definition the documents page and the prefill auto-generate use.
  // `requiredChecklist` is already filtered to required documents by callers,
  // so `required: true` is asserted rather than re-derived (see gatingItems).
  const docsComplete =
    gatingItems.length > 0 &&
    gatingItems.every(isChecklistItemSatisfied)

  const isComplete: Record<StageSlug, boolean> = {
    intake: input.hasProfile && input.intakeDone,
    documents: docsComplete,
    narrative: input.requiredGenTypes.every(t => input.approvedGenTypes.includes(t)),
    readiness: input.hasVriScore,
    prefill: input.hasPrefill,
    submission: input.submissionStatus === 'complete',
  }

  const locked: Partial<Record<StageSlug, boolean>> = {
    submission: !isComplete.documents,
  }

  const stages: StageProgress[] = STAGE_ORDER.map(slug => {
    let state: StageState
    if (isComplete[slug]) state = 'complete'
    else if (locked[slug]) state = 'locked'
    else if (pct[slug] > 0) state = 'in_progress'
    else state = 'available'
    return { slug, state, pct: pct[slug] }
  })

  const current = stages.find(s => s.state !== 'complete' && s.state !== 'locked')?.slug
    ?? 'submission'

  const overallPct = Math.round(
    STAGE_ORDER.reduce((sum, slug) => sum + pct[slug], 0) / STAGE_ORDER.length,
  )

  const dayMs = 24 * 60 * 60 * 1000
  const diffMs = new Date(input.now).getTime() - new Date(input.lastActiveAt).getTime()
  const stalledDays = Number.isFinite(diffMs) ? Math.max(0, Math.floor(diffMs / dayMs)) : 0

  return {
    applicationId: input.applicationId,
    stages,
    currentStage: current,
    overallPct,
    nextAction: {
      stage: current,
      label: NEXT_LABEL[current],
      href: `/${current}/${input.applicationId}`,
    },
    lastActiveAt: input.lastActiveAt,
    stalledDays,
  }
}

// =====================================================================
// Gate 2 / Phase 2B — Provenance, Verification, Audit, Consultant,
// Preflight, Eligibility. Types + DTOs + domain models only (no logic).
// Kept inline (repo convention: all shared types live in this file).
// =====================================================================

// ---- shared ----------------------------------------------------------
export type ActorRole = 'system' | 'applicant' | 'consultant' | 'admin'

export interface ActorRef {
  id: string | null
  role: ActorRole
}

/** Hex sha256 of a canonicalized field value. The cross-table integrity spine. */
export type ValueHash = string

// ---- Provenance (ocr_runs + field_provenance) ------------------------
export type OcrProviderName = 'mock' | 'openai' | 'azure-di' | 'aws-textract' | 'google-docai'

export type OcrRunStatus = 'complete' | 'failed'

export type ProvenanceOrigin = 'ocr' | 'intake' | 'inferred' | 'user_entered'

export type ConfidenceBand = 'high' | 'medium' | 'low'

export interface BBox {
  page: number
  /** 'ratio' = normalized 0..1 to page dimensions (resolution-independent). */
  unit: 'ratio' | 'pixel'
  x: number
  y: number
  w: number
  h: number
}

/** Per-field OCR metadata (best-effort; absent for providers without geometry). */
export interface FieldMeta {
  key: string
  page?: number
  bbox?: BBox
  confidence?: number
}

/** Domain model — ocr_runs row. */
export interface OcrRun {
  id: string
  document_id: string
  application_id: string
  provider: OcrProviderName
  provider_model: string | null
  region: string
  status: OcrRunStatus
  page_count: number | null
  raw_text_hash: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

/** Domain model — field_provenance row. */
export interface FieldProvenance {
  id: string
  application_id: string
  field_key: string
  origin: ProvenanceOrigin
  value_snapshot: string | null
  value_hash: ValueHash | null
  source_document_id: string | null
  source_page: number | null
  source_bbox: BBox | null
  ocr_run_id: string | null
  extraction_timestamp: string
  confidence: number | null
  confidence_band: ConfidenceBand | null
  superseded_by: string | null
  created_at: string
}

// DTOs
export interface NewOcrRunInput {
  documentId: string
  applicationId: string
  provider: OcrProviderName
  providerModel?: string | null
  region: string
  status: OcrRunStatus
  pageCount?: number | null
  rawText?: string | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface NewFieldProvenanceInput {
  applicationId: string
  fieldKey: string
  origin: ProvenanceOrigin
  value: string | number | null
  sourceDocumentId?: string | null
  sourcePage?: number | null
  sourceBBox?: BBox | null
  ocrRunId?: string | null
  confidence?: number | null
}

// ---- Verification (field_verifications) ------------------------------
export type VerificationState =
  | 'EXTRACTED'
  | 'USER_CONFIRMED'
  | 'CONSULTANT_REVIEWED'
  | 'CONSULTANT_APPROVED'
  | 'EXECUTION_READY'
  | 'EXECUTED'

export type VerificationSource = 'profile' | 'document' | 'inferred'

/** Domain model — field_verifications row. */
export interface FieldVerification {
  id: string
  application_id: string
  field_key: string
  section: string | null
  state: VerificationState
  value_snapshot: string | null
  value_hash: ValueHash | null
  source: VerificationSource | null
  source_document_id: string | null
  user_confirmed_by: string | null
  user_confirmed_at: string | null
  consultant_reviewed_by: string | null
  consultant_reviewed_at: string | null
  consultant_approved_by: string | null
  consultant_approved_at: string | null
  executed_at: string | null
  created_at: string
  updated_at: string
}

/** Derived section rollup (section_verification view). */
export interface SectionVerification {
  application_id: string
  section: string | null
  section_state: VerificationState
  field_count: number
  ready_count: number
}

/** Required human gates per plan tier before EXECUTION_READY. */
export interface VerificationPolicy {
  requiredGates: VerificationState[]
}

export type TierVerificationPolicy = Record<PlanTier, VerificationPolicy>

// DTOs
export interface SeedFieldInput {
  fieldKey: string
  section?: string | null
  value: string | number | null
  /** Provenance value_hash baseline bound at seed time (drift reference). */
  valueHash?: ValueHash | null
  source?: VerificationSource | null
  sourceDocumentId?: string | null
}

export interface BlockedField {
  fieldKey: string
  state: VerificationState
  reason: 'below_ready' | 'drifted' | 'empty' | 'doc_failed'
}

export interface ExecutionReadyPartition {
  ready: string[]
  blocked: BlockedField[]
}

/** Result of the execution-readiness gate (VerificationService). */
export interface VerificationReadiness {
  applicationId: string
  ready: boolean
  requiredSectionsApproved: boolean
  consultantApprovalPresent: boolean
  noDrift: boolean
  blockedSections: string[]
  driftedFields: string[]
}

// ---- Audit (audit_events) --------------------------------------------
export type AuditEventType =
  | 'DOCUMENT_UPLOADED'
  | 'OCR_COMPLETED'
  | 'FIELD_EXTRACTED'
  | 'FIELD_EDITED'
  | 'USER_CONFIRMED'
  | 'CONSULTANT_REVIEWED'
  | 'CONSULTANT_APPROVED'
  | 'PREFLIGHT_STARTED'
  | 'PREFLIGHT_COMPLETED'
  | 'EXECUTION_READY'
  | 'READBACK_CONFIRMED'
  | 'EXECUTION_REQUESTED'
  | 'EXECUTION_STARTED'
  | 'PORTAL_FILL_STARTED'
  | 'FIELD_WRITE_ATTEMPT'
  | 'READBACK_COMPARE'
  | 'FIELD_VERIFIED'
  | 'PORTAL_FILL_COMPLETED'
  | 'EXECUTION_COMPLETED'
  | 'EXECUTION_FAILED'
  | 'LEGACY_AUTOMATION_BLOCKED'
  | 'CONSULTANT_SELF_ASSIGNED'
  | 'CONSULTANT_ASSIGNED'
  | 'CONSULTANT_REASSIGNED'
  | 'CONSULTANT_UNASSIGNED'
  | 'CONSULTANT_BACKUP_ADDED'
  | 'CONSULTANT_PROMOTED'
  | 'CONSULTANT_BACKUP_REMOVED'
  | 'CONSULTANT_COMPLETED'
  | 'CONSULTANT_DEADLINE_CHANGED'
  | 'CONSULTANT_ASSIGNMENT_EXPIRED'
  | 'CONSULTANT_ESCALATION_FLAGGED'

export interface AuditEntityRefs {
  documentId?: string | null
  ocrRunId?: string | null
  fieldKey?: string | null
  submissionSessionId?: string | null
}

/** Domain model — audit_events row. */
export interface AuditEvent {
  id: string
  application_id: string
  seq: number
  event_type: AuditEventType
  actor_id: string | null
  actor_role: ActorRole
  document_id: string | null
  ocr_run_id: string | null
  field_key: string | null
  submission_session_id: string | null
  from_state: string | null
  to_state: string | null
  payload: Record<string, unknown>
  value_hash: ValueHash | null
  payload_hash: string
  prev_hash: string
  row_hash: string
  hash_algo: string
  canon_version: number
  extension_version: string | null
  schema_version: string | null
  occurred_at: string
}

// DTO
export interface AuditAppendInput {
  applicationId: string
  eventType: AuditEventType
  actor: ActorRef
  payload?: Record<string, unknown>
  valueHash?: ValueHash | null
  refs?: AuditEntityRefs
  fromState?: string | null
  toState?: string | null
  extensionVersion?: string | null
  schemaVersion?: string | null
  /** Idempotency key for at-least-once emitters (BullMQ); dedupes logical events. */
  idempotencyKey?: string
}

export interface ChainVerifyResult {
  intact: boolean
  brokenAtSeq?: number
  reason?: string
}

export interface EvidenceReconstruction {
  applicationId: string
  whatDataExisted: Array<{ fieldKey: string; valueHash: ValueHash | null; origin: ProvenanceOrigin | null }>
  whoApproved: Array<{ fieldKey: string | null; actorId: string | null; role: ActorRole; at: string }>
  whatExecuted: Array<{ fieldKey: string; outcome: string; at: string }>
  timeline: Array<{ seq: number; eventType: AuditEventType; at: string }>
}

// ---- Consultant (consultant_assignments + consultant_approvals) ------
export type ConsultantAssignmentStatus = 'active' | 'released'

export type ConsultantApprovalScope = 'field' | 'section' | 'application'

/**
 * 'not_applicable': the field does not apply to this application (OCR junk such
 * as a sponsor job title read off an unrelated document). Unlike 'rejected' it
 * does NOT block auto-fill — the value is simply left out of what auto-fill
 * writes, and the applicant fills that control themselves if needed.
 */
export type ConsultantDecision =
  | 'reviewed'
  | 'approved'
  | 'rejected'
  | 'revoked'
  | 'not_applicable'

export type AssignmentRole = 'primary' | 'backup'

/** Domain model — consultant_assignments row. */
export interface ConsultantAssignment {
  id: string
  application_id: string
  consultant_id: string
  role: AssignmentRole
  status: ConsultantAssignmentStatus
  assigned_at: string
  released_at: string | null
  /** Review deadline (SLA). Past this + not completed => swept back to queue. */
  due_at: string | null
  /** Set when the consultant marks review complete — stops the SLA clock. */
  completed_at: string | null
  /** Who created this assignment (consultant for self-assign, else the admin). */
  assigned_by: string | null
  assigned_by_role: 'consultant' | 'admin' | null
}

// ---- Country-scoped assignment + visibility (derived status) ----------

/** Domain model — consultant_countries row (ISO-2 country map). */
export interface ConsultantCountry {
  id: string
  consultant_id: string
  country_code: string
  active: boolean
  created_at: string
}

/**
 * DERIVED assignment status. Never stored on applications — computed from the
 * presence of an active consultant_assignments row. Single source of truth.
 */
export type AssignmentStatus = 'UNASSIGNED' | 'ASSIGNED'

/** Minimal assigned-consultant summary surfaced to admin/applicant portals. */
export interface AssignedConsultant {
  id: string
  email: string | null
  assigned_at: string
  /** Review deadline (SLA) for the active assignment. */
  due_at: string | null
  /** Set when the consultant marked review complete (SLA clock stopped). */
  completed_at: string | null
  /** WHO created the assignment: 'consultant' = self-claimed, 'admin' = assigned. */
  assigned_by_role: 'consultant' | 'admin' | null
  /** Display email of whoever created the assignment (null if self/unknown). */
  assigned_by_email: string | null
}

/** Admin portal row: every application + derived status + assignee + date. */
export interface AdminApplicationView {
  id: string
  user_id: string
  destination_country: string | null
  status: string | null // application lifecycle status (draft/ready/...)
  assignment_status: AssignmentStatus // DERIVED
  assigned_consultant: AssignedConsultant | null
  created_at: string | null
}

/** Consultant queue item (unassigned-eligible OR mine). */
export interface ConsultantQueueItem {
  id: string
  destination_country: string | null
  status: string | null
  assignment_status: AssignmentStatus // DERIVED
  visa_type: string | null
  created_at: string | null
  /** SLA review deadline (only set on `mine` rows; null in the queue). */
  due_at: string | null
  /** Set when I marked this review complete (only on `mine` rows). */
  completed_at: string | null
}

/** Consultant portal payload: eligible unassigned queue + my active apps. */
export interface ConsultantQueueResult {
  queue: ConsultantQueueItem[] // UNASSIGNED ∩ my countries
  mine: ConsultantQueueItem[] // active-assigned to me
}

/**
 * Consultant dashboard aggregate (Phase 1). Case-domain counts + workload
 * buckets, derived purely from the consultant queue result.
 * Earnings/messages are fetched separately by the web layer from their own
 * endpoints.
 *
 * Side-effect note: the API handler that produces this type calls
 * `getConsultantQueue()`, which first runs `releaseExpired()` — a lazy SLA
 * sweep that may release past-due active assignments (a write) and emit
 * audit/bus events. The writes are inherited from the existing queue contract,
 * are idempotent, and are not new to this endpoint. The handler is logically
 * a read-model but is not strictly side-effect-free.
 */
export interface ConsultantDashboard {
  counts: {
    /**
     * Total active-status assignments (includes rows where `completed_at` is
     * set but `status` remains `active`). Represents current caseload, not
     * just pending reviews. Note: may grow unboundedly if completed
     * assignments are never released — upstream assignment-lifecycle cleanup
     * is tracked as tech debt.
     */
    assigned: number
    newRequests: number
    awaitingReview: number
    /**
     * Active cases that are overdue OR due within 24 h. Because
     * `releaseExpired()` sweeps past-due active items before aggregation, in
     * practice this is predominantly "due within 24 h"; the overdue branch is
     * a defensive fallback exercised by unit tests but rarely live.
     */
    highPriority: number
  }
  workload: { today: number; week: number }
  /**
   * Active cases with a `due_at` set, ordered soonest-first, capped at 5.
   * This is BROADER than `counts.highPriority` (which is overdue/≤24 h
   * only) — it includes any case with a deadline, regardless of urgency.
   * Wave-2 recommendation: rename to `upcomingByDeadline` before any UI
   * binds to this field, to avoid confusion with the priority count.
   */
  highPriorityCases: ConsultantQueueItem[]
  /** Active assigned cases awaiting my review, newest first, max 5. */
  awaitingReview: ConsultantQueueItem[]
}

/** Applicant-facing view of their own application's assignment state. */
export interface ApplicantApplicationView {
  id: string
  destination_country: string | null
  status: string | null
  assignment_status: AssignmentStatus // DERIVED
  assigned_consultant: AssignedConsultant | null
  created_at: string | null
}

// ---- Consultant review data (what a consultant sees to decide) -------

/** One reviewable field: its current value + the consultant's decision state. */
export interface ConsultantReviewField {
  fieldKey: string
  value: string | null
  /** Current provenance value hash — what a field approval binds to. */
  valueHash: string | null
  origin: string | null
  confidence: number | null
  decision: ConsultantDecision | 'pending'
  approved: boolean
  stale: boolean
}

/** One uploaded document attached to the application. */
export interface ConsultantReviewDocument {
  id: string
  type: string | null
  name: string | null
  uploadStatus: string | null
  ocrStatus: string | null
  createdAt: string | null
}

// ---- Consultant review of documents + generated items -----------------

export type ReviewItemKind = 'document' | 'generated'
export type ReviewItemDecision =
  | 'approved'
  | 'needs_reupload'
  | 'changes_requested'
  | 'rejected'

/** The current (latest) consultant decision on one item. */
export interface ReviewItemDecisionRecord {
  decision: ReviewItemDecision
  note: string | null
  reviewerId: string | null
  reviewerRole: 'consultant' | 'admin'
  createdAt: string
}

export interface ReviewDocumentVerification {
  verificationType: string | null
  result: string | null
  details: unknown
  verifiedAt: string | null
}

export interface ReviewDocumentApplicantConfirmation {
  confirmedBy: string | null
  confirmedAt: string
  /** The name printed on the passport when they confirmed. */
  holderName: string | null
  /** The name they had given. */
  statedName: string | null
}

export interface ReviewDocumentField {
  fieldKey: string
  value: string | null
  origin: string | null
  confidence: number | null
}

export interface ReviewDocumentItem {
  id: string
  type: string | null
  name: string | null
  uploadStatus: string | null
  ocrStatus: string | null
  createdAt: string | null
  verifications: ReviewDocumentVerification[]
  extractedFields: ReviewDocumentField[]
  decision: ReviewItemDecisionRecord | null
  /**
   * The applicant's own "this passport is mine" on a passport held because its
   * name didn't match the name they gave — the latest
   * document_holder_confirmations row (service-role written; not the
   * owner-writable verification details). Null when they never confirmed it.
   */
  applicantConfirmation?: ReviewDocumentApplicantConfirmation | null
  /**
   * The applicant deleted this file while the consultant's re-upload /
   * rejection request on it was open. Listed so the consultant can close the
   * request (approve) — there is no file to open.
   */
  deleted?: boolean
}

export interface ReviewGeneratedItem {
  id: string
  docType: 'loe' | 'itinerary' | 'cover_letter' | 'invitation_letter'
  contentMd: string
  approvedByUser: boolean
  generatedAt: string | null
  decision: ReviewItemDecisionRecord | null
}

export interface ReviewFormItem {
  id: string
  fields: PrefilledFormField[]
  approvedByUser: boolean
  decision: ReviewItemDecisionRecord | null
}

/** GET /applications/:id/review-items — everything the applicant uploaded or the app generated. */
export interface ConsultantReviewItems {
  applicationId: string
  documents: ReviewDocumentItem[]
  generated: ReviewGeneratedItem[]
  form: ReviewFormItem | null
}

/** Everything a consultant needs to review before approve/reject. */
export interface ConsultantReviewData {
  applicationId: string
  summary: {
    destination_country: string | null
    status: string | null
    applicant_email: string | null
  }
  fields: ConsultantReviewField[]
  documents: ConsultantReviewDocument[]
}

// ---- Real-time consultant queue (SSE) --------------------------------

/** Real-time event types pushed to consultant queue subscribers. */
export type ConsultantQueueEventType =
  | 'APPLICATION_CREATED'
  | 'APPLICATION_ASSIGNED'
  | 'APPLICATION_UNASSIGNED'
  | 'APPLICATION_REASSIGNED'
  | 'APPLICATION_SELF_ASSIGNED'
  | 'APPLICATION_BACKUP_ADDED'
  | 'APPLICATION_PROMOTED'
  | 'APPLICATION_BACKUP_REMOVED'

/**
 * Per-consultant SSE payload. `consultant_visibility` indicates whether the
 * application is (now) in THIS consultant's queue — informational; the client
 * refetches the authoritative queue on receipt (no client-side derivation).
 */
export interface ConsultantQueueEvent {
  event_type: ConsultantQueueEventType
  application_id: string
  destination_country: string | null
  consultant_visibility: boolean
  timestamp: string
}

/** The assignment-lifecycle audit event types (subset of AuditEventType). */
export type AssignmentEventType =
  | 'CONSULTANT_SELF_ASSIGNED'
  | 'CONSULTANT_ASSIGNED'
  | 'CONSULTANT_REASSIGNED'
  | 'CONSULTANT_UNASSIGNED'
  | 'CONSULTANT_BACKUP_ADDED'
  | 'CONSULTANT_PROMOTED'
  | 'CONSULTANT_BACKUP_REMOVED'

/**
 * One normalized assignment-lifecycle event for the read-only timeline viewer.
 * Sourced ONLY from audit_events (no derived state). Ordered ASC by timestamp.
 */
export interface AssignmentTimelineEvent {
  event_type: AssignmentEventType
  application_id: string
  actor_role: ActorRole
  actor_id: string | null
  actor_name: string | null // display name (email), safe-joined
  previous_consultant_id: string | null
  previous_consultant_name: string | null
  new_consultant_id: string | null
  new_consultant_name: string | null
  timestamp: string
  metadata: Record<string, unknown> | null
}

/** Domain model — consultant_approvals row. */
export interface ConsultantApproval {
  id: string
  application_id: string
  consultant_id: string
  scope: ConsultantApprovalScope
  field_key: string | null
  section: string | null
  decision: ConsultantDecision
  value_hash: ValueHash | null
  reason: string | null
  decided_at: string
}

// DTO
export interface ConsultantDecisionInput {
  applicationId: string
  consultantId: string
  scope: ConsultantApprovalScope
  fieldKey?: string | null
  section?: string | null
  decision: ConsultantDecision
  valueHash?: ValueHash | null
  reason?: string | null
}

/** Per-field consultant approval status with staleness (value_hash binding). */
export interface FieldApprovalStatus {
  fieldKey: string
  decision: ConsultantDecision
  approved: boolean
  stale: boolean
  approvedValueHash: ValueHash | null
}

export interface SectionApprovalStatus {
  section: string
  decision: ConsultantDecision
  approved: boolean
}

/** Application-level consultant approval rollup. */
export interface ConsultantApprovalRollup {
  applicationId: string
  fields: FieldApprovalStatus[]
  sections: SectionApprovalStatus[]
  applicationApproved: boolean
  /**
   * The latest application decision is an approval, but it predates the
   * pre-submission lock now in force (or a new review is open), so it does
   * not count: the consultant must lock and approve again. False when the
   * lock could not be read (not approved, but not the consultant's to fix).
   */
  applicationApprovalStale?: boolean
  /**
   * Standing reasons the application cannot be approved (e.g. a document the
   * consultant asked to have re-uploaded, with no replacement yet). Any entry
   * makes applicationApproved false.
   */
  approvalBlockers?: string[]
  /**
   * The approval blockers could not be read (a transient error). Not approved
   * (fail closed), but not the consultant's to fix: callers must not report
   * it as a missing approval.
   */
  approvalCheckUnavailable?: boolean
}

// ======================================================================
// Consultant Marketplace (public marketplace layer)
// Schema: supabase/migrations/20260626000000_consultant_marketplace.sql
// Design: docs/consultant-marketplace/
// ======================================================================

export type ConsultantActiveStatus = 'draft' | 'pending_review' | 'active' | 'suspended'
export type ConsultantKycStatus = 'none' | 'pending' | 'verified' | 'rejected'

/** Domain model — consultant_profiles row (1:1 with users). */
export interface ConsultantProfile {
  id: string
  user_id: string
  headline: string | null
  bio: string | null
  specialization: string[]
  years_experience: number | null
  license_number: string | null
  license_authority: string | null
  license_country: string | null
  license_verified: boolean
  hourly_rate_usd: number | null
  rating_avg: number
  rating_count: number
  max_active_cases: number
  active_status: ConsultantActiveStatus
  kyc_status: ConsultantKycStatus
  stripe_connect_account_id: string | null
  payouts_enabled: boolean
  created_at: string
  updated_at: string
}

/** Domain model — consultant_availability row. */
export interface ConsultantAvailability {
  id: string
  consultant_id: string
  timezone: string
  /** {mon:[["09:00","17:00"]], tue:[...], ...} — IANA-tz-local windows. */
  working_hours: Record<string, [string, string][]>
  max_cases: number
  accepting_new: boolean
  updated_at: string
}

/** Domain model — consultant_skills row (countries via consultant_countries). */
export interface ConsultantSkills {
  id: string
  consultant_id: string
  visa_types: string[]
  languages: string[]
  countries_supported: string[]
  updated_at: string
}

/** Domain model — consultant_reviews row. */
export interface ConsultantReview {
  id: string
  consultant_id: string
  user_id: string
  application_id: string | null
  rating: number
  feedback: string | null
  created_at: string
}

// ---- Commission system (consultant_commission_rules) -----------------
export type CommissionScope = 'global' | 'country' | 'visa' | 'country_visa' | 'consultant'
export type CommissionModel = 'percentage' | 'fixed'

/** Domain model — consultant_commission_rules row. Most-specific scope wins. */
export interface CommissionRule {
  id: string
  scope: CommissionScope
  country_code: string | null
  visa_type: string | null
  consultant_id: string | null
  model: CommissionModel
  /** Set when model='percentage' (0..1, e.g. 0.2 = 20% platform cut). */
  platform_pct: number | null
  /** Set when model='fixed' (USD platform fee). */
  platform_fixed_usd: number | null
  effective_from: string
  active: boolean
  note: string | null
  created_at: string
}

/** Result of splitting a gross amount via the resolved commission rule. */
export interface CommissionSplit {
  gross_usd: number
  platform_fee_usd: number
  consultant_payout_usd: number
  rule_id: string
}

// ---- Service orders + payouts ----------------------------------------
export type ConsultantServiceType =
  | 'premium_review'
  | 'consultation'
  | 'priority_processing'
  | 'document_review'

export type ServiceOrderStatus = 'pending' | 'paid' | 'refunded' | 'failed'

/** Domain model — consultant_service_orders row (user pays for a service). */
export interface ConsultantServiceOrder {
  id: string
  user_id: string
  consultant_id: string
  application_id: string | null
  service_type: ConsultantServiceType
  currency: string
  amount_usd: number
  platform_fee_usd: number
  consultant_payout_usd: number
  commission_rule_id: string | null
  status: ServiceOrderStatus
  stripe_payment_intent_id: string | null
  created_at: string
  paid_at: string | null
}

export type PayoutStatus = 'pending' | 'in_transit' | 'paid' | 'failed' | 'reversed'

/** Domain model — consultant_payouts row (Stripe Connect transfer out). */
export interface ConsultantPayout {
  id: string
  consultant_id: string
  amount_usd: number
  currency: string
  status: PayoutStatus
  stripe_transfer_id: string | null
  period_start: string | null
  period_end: string | null
  payout_date: string | null
  note: string | null
  created_at: string
}

/** Domain model — consultant_payout_items row (links a swept order to its payout). */
export interface ConsultantPayoutItem {
  id: string
  payout_id: string
  service_order_id: string
  amount_usd: number
}

/**
 * Consultant earnings summary (GET /payouts/earnings). All amounts USD.
 *  - lifetime_usd  = Σ consultant payout on every PAID service order
 *  - paid_out_usd  = Σ amounts already swept into Stripe transfers (payout_items)
 *  - pending_usd   = lifetime − paid_out (paid orders awaiting the next sweep)
 */
export interface ConsultantEarnings {
  consultant_id: string
  currency: string
  lifetime_usd: number
  paid_out_usd: number
  pending_usd: number
  orders_count: number
}

// ---- Scheduling (consultations) --------------------------------------
export type MeetingProvider = 'zoom' | 'google_meet' | 'ms_teams'
export type ConsultationStatus =
  | 'requested'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'

/** Domain model — consultations row. */
export interface Consultation {
  id: string
  consultant_id: string
  user_id: string
  application_id: string | null
  service_order_id: string | null
  provider: MeetingProvider
  meeting_url: string | null
  external_event_id: string | null
  scheduled_start: string
  scheduled_end: string
  timezone: string
  status: ConsultationStatus
  created_at: string
}

// ---- Matching engine (docs/case-assignment-engine) -------------------
/** Input to the matching engine for one application. */
export interface MatchRequest {
  visa_type: string | null
  destination_country: string | null
  user_language: string | null
  complexity_score: number | null
}

/** Per-candidate match score with explainable component breakdown. */
export interface ConsultantMatch {
  consultant_id: string
  score: number // 0..1 composite
  breakdown: {
    visa_fit: number
    country_fit: number
    language_fit: number
    rating: number
    availability: number
    complexity_fit: number
  }
  rank: number
}

/** Public marketplace card (discovery list item). */
export interface ConsultantCard {
  id: string
  full_name: string | null
  headline: string | null
  specialization: string[]
  countries_supported: string[]
  visa_types: string[]
  languages: string[]
  years_experience: number | null
  hourly_rate_usd: number | null
  rating_avg: number
  rating_count: number
  active_status: ConsultantActiveStatus
}

// ---- Preflight (preflight_reviews) -----------------------------------
export type PreflightStatus = 'in_review' | 'completed' | 'invalidated'

export type PreflightCheckKey =
  | 'passport_reviewed'
  | 'dates_reviewed'
  | 'travel_history_reviewed'
  | 'addresses_reviewed'
  | 'employment_reviewed'
  | 'final_approval'

export type PreflightChecklist = Record<PreflightCheckKey, boolean>

/** Domain model — preflight_reviews row. */
export interface PreflightReview {
  id: string
  application_id: string
  submission_session_id: string | null
  status: PreflightStatus
  reviewer_id: string | null
  reviewer_role: ActorRole | null
  passport_reviewed: boolean
  dates_reviewed: boolean
  travel_history_reviewed: boolean
  addresses_reviewed: boolean
  employment_reviewed: boolean
  final_approval: boolean
  locked_diff_hash: string | null
  extension_version: string | null
  schema_version: string | null
  started_at: string
  completed_at: string | null
  invalidated_at: string | null
  /** GET /preflight/active, in-review only: whether the caller can lock it. */
  can_lock?: boolean
}

/** One row in the 3-column preflight diff. */
export interface PreflightDiffRow {
  fieldKey: string
  category: PreflightCheckKey
  sourceValueHash: ValueHash | null
  sourceProvenanceRef: string | null
  targetSelector: string
  targetLabel: string
  mappedValueHash: ValueHash | null
  mappedValueDisplay: string
  verificationState: VerificationState
  transformed: boolean
  selectorPresent: boolean
}

export interface PreflightDiff {
  applicationId: string
  rows: PreflightDiffRow[]
}

/** Field categories that map onto the five field-level preflight checks. */
export type PreflightCategory =
  | 'passport'
  | 'dates'
  | 'travel_history'
  | 'addresses'
  | 'employment'

/** Caller-supplied mapping (from prefill; wired later). No PII leaves as raw. */
export interface PreflightMappingInput {
  fieldKey: string
  targetField: string
  mappedValue: string | number | null
  category: PreflightCategory
  /**
   * Portal page (URL path) the target lives on. Multi-page portals reuse ids
   * across pages (IRCC: the representative and applicant pages both have
   * `#lastName_input`), so a run writes only page groups that are present in
   * full. Part of the lock hash when set.
   */
  page?: string
  /** Human label for one write when a value spans several (DOB → year). */
  label?: string
  /**
   * How the target is operated when it is not a plain value write (text box or
   * select by value). Part of the lock hash when set. See PortalFillOp.
   */
  op?: PortalFillOp
  /**
   * The target is not on the page when it loads: an earlier step on the same
   * page reveals it (IRCC shows follow-up questions only after the parent radio
   * is answered). It is waited for instead of probed. Part of the lock hash.
   */
  reveal?: boolean
  /** The target is inside the open dialog (an "add row" dialog). Part of the lock hash. */
  dialog?: boolean
  /** A <select> whose options load after an earlier answer: wait for the option (eTA job title). */
  awaitOptions?: boolean
  /**
   * A legal declaration (criminality, security, medical, immigration history).
   * Only ever mapped from the applicant's own explicit answer; shown apart in
   * the readback gate so the applicant confirms each one.
   */
  declaration?: boolean
}

/**
 * Non-value operations a portal fill can perform. Each is verified by reading
 * the control back, like a value write:
 *  - radio: click the radio input named by the selector (no-op when already
 *    selected); verified by it being checked.
 *  - check: ensure the checkbox is checked (never un-checks); verified checked.
 *  - select_text: choose the <select> option whose visible text is the value;
 *    verified by the selected option's text.
 *  - dialog_open: click an "add row" button and wait for its dialog.
 *  - dialog_save: click the open dialog's Save button, wait for it to close and
 *    verify the table gained a row.
 *  - row_add: make the inline row the selector names exist (IRCC PR portal,
 *    `#from2`): nothing when it is there; otherwise, with the row before it
 *    there, click the page's one "Add another" button and wait for it. Never
 *    removes a row.
 *  - dependant_open: IRCC PR portal profile, "Add dependant". The value is
 *    "Name: …; Family name: …; Date of birth: …; Relationship: …;
 *    Accompanying: …". Nothing when a saved card matches it field by field;
 *    refused when a card has the same name and date of birth but other
 *    answers, or the same family name and date of birth under another name,
 *    or when an inline dependant form is open with values; otherwise
 *    click the profile's one "Add dependant" button and wait for its inline
 *    form. Fields of that form carry the `>> dependant` selector scope.
 *  - dependant_save: click that inline form's "Save details" (enabled only),
 *    wait for the form to close and a card matching the value exactly.
 *    Nothing when the card was already there.
 */
export const PORTAL_FILL_OPS = [
  'radio',
  'check',
  'select_text',
  'dialog_open',
  'dialog_save',
  /** Attach a reviewed document to a file input (IRCC /doc-upload). */
  'attach_file',
  'row_add',
  'dependant_open',
  'dependant_save',
] as const
/**
 * One list, so the request validators (preflight, execution request) can never
 * fall behind the type again: 'attach_file' was added to the type only, and
 * every review and execution request for an application with uploads failed
 * validation (prod 2026-10-17).
 */
export type PortalFillOp = (typeof PORTAL_FILL_OPS)[number]

/** Why an IRCC field is left for the applicant to fill. */
export type PortalFillLeftReason =
  /** A legal declaration with no explicit answer from the applicant. */
  | 'needs_your_answer'
  /** VisaAI does not hold this information for the applicant. */
  | 'not_in_profile'
  /** The assistant does not fill this part of the form. */
  | 'fill_yourself'

/** One portal page: what the assistant fills there and what it leaves. */
export interface PortalFillPageCoverage {
  page: string
  title: string
  /** Number of writes the assistant makes on this page. */
  filled: number
  left: Array<{ label: string; reason: PortalFillLeftReason; note?: string }>
}

export interface PortalFillCoverage {
  pages: PortalFillPageCoverage[]
}

/** One immutable diff entry — hashes only, never raw values. */
export interface PreflightDiffEntry {
  fieldKey: string
  targetField: string
  category: PreflightCategory
  page?: string
  op?: PortalFillOp
  reveal?: boolean
  dialog?: boolean
  /** A <select> whose options load after an earlier answer: wait for the option (eTA job title). */
  awaitOptions?: boolean
  sourceValueHash: ValueHash | null
  mappedValueHash: ValueHash | null
}

export interface PreflightDiffSet {
  applicationId: string
  entries: PreflightDiffEntry[]
  diffHash: string
}

export type PreflightInvalidationReason =
  | 'not_completed'
  | 'already_invalidated'
  | 'no_active_consultant'
  | 'consultant_reassigned'
  | 'stale_approval'
  | 'verification_drift'
  | 'provenance_or_mapping_changed'

export interface PreflightLockValidation {
  valid: boolean
  reasons: PreflightInvalidationReason[]
}

// ---- Execution eligibility (final compliance gate) -------------------
export type EligibilityReason =
  | 'payment_missing'
  | 'consultant_missing'
  | 'consultant_stale'
  /** A document the consultant sent back has no replacement yet. */
  | 'document_review_open'
  /** The consultant review state could not be read right now (transient). */
  | 'approval_check_unavailable'
  | 'preflight_incomplete'
  | 'preflight_invalid'
  | 'verification_drift'
  | 'token_invalid'

/** The four independent predicates. */
export interface EligibilityConditions {
  paymentCompleted: boolean
  consultantApprovalValid: boolean
  preflightLockValid: boolean
  executionTokenValid: boolean
}

export interface EligibilityResult {
  applicationId: string
  eligible: boolean
  conditions: EligibilityConditions
  reasons: EligibilityReason[]
}

/** Everything a caller must present for an eligibility decision. */
export interface EligibilityCheckInput {
  applicationId: string
  preflightReviewId: string
  mappings: PreflightMappingInput[]
  token: string
  sessionId: string
  userId: string
}

/**
 * Read-only gate decision surfaced by the automation layer. Derived purely from
 * an eligibility evaluation — no side effects, no token mint, no execution.
 */
export interface ExecutionGateDecision {
  eligible: boolean
  blockedReasons: EligibilityReason[]
  evaluationDetails: EligibilityConditions
  executionAllowed: boolean
}

// ---- Execution request gate (Phase 3F backend safety boundary) -------
/** Mandatory readback confirmation flag is the ONLY thing the UI contributes. */
export interface ExecutionRequestInput extends EligibilityCheckInput {
  userConfirmationFlag: boolean
}

/**
 * Server-authoritative decision. `allowed=true` means the gate passed full
 * revalidation (readback confirmed + 4-predicate eligibility incl. locked-lock
 * validation). It does NOT start execution; it records EXECUTION_REQUESTED only.
 */
export interface ExecutionRequestDecision {
  allowed: boolean
  blockedReasons: string[]
  evaluationDetails: EligibilityConditions | null
  /** Issued only when allowed: the readback token bound to the current lock. */
  readbackToken?: string
}

// ---- Execution hard gate (Phase 3G — final choke point) --------------
export type ExecutionFailReason =
  | 'readback_stale'
  | 'lock_changed'
  | 'consultant_state_changed'
  | 'verification_drift'
  | 'eligibility_recomputed_false'
  /** The consultant review state could not be read right now (transient). */
  | 'approval_check_unavailable'
  | 'replay_detected'

export interface ExecutionResult {
  started: boolean
  reasons: ExecutionFailReason[]
}

// ---- Portal-fill write plan (Phase 7D — server-derived; no executor) -------
/** One field the executor will (later) write: plaintext value + its expected hash. */
export interface WritePlanEntry {
  fieldKey: string
  /** Portal page group (see PreflightMappingInput.page). */
  page?: string
  /** Portal selector the value targets (from the locked mapping). */
  selector: string
  /** The only plaintext that will cross into the page when executed. */
  mappedValue: string
  /** valueHash(mappedValue) — readback must reproduce this. The spine endpoint. */
  expectedValueHash: ValueHash
  category: PreflightCategory
  op?: PortalFillOp
  reveal?: boolean
  dialog?: boolean
  /** A <select> whose options load after an earlier answer: wait for the option (eTA job title). */
  awaitOptions?: boolean
}

/**
 * Server-derived write plan, bound to a completed preflight lock. Produced by
 * WritePlanBuilder ONLY when the supplied mappings reproduce `lockedDiffHash`
 * (validated live). Carries no execution authority on its own — signing +
 * execution are later phases.
 */
export interface WritePlan {
  applicationId: string
  preflightReviewId: string
  lockedDiffHash: string
  entries: WritePlanEntry[]
  planHash: string
}

/**
 * A write-plan entry signed by the server for ONE execution run. `sig` binds
 * executionId + lockedDiffHash + fieldKey + expectedValueHash, so an intent
 * cannot be replayed across executions or mutated without invalidating it.
 * Only the server (holding the secret) can mint or verify these.
 */
export interface SignedWriteIntent {
  executionId: string
  fieldKey: string
  page?: string
  selector: string
  mappedValue: string
  expectedValueHash: ValueHash
  category: PreflightCategory
  op?: PortalFillOp
  reveal?: boolean
  dialog?: boolean
  /** A <select> whose options load after an earlier answer: wait for the option (eTA job title). */
  awaitOptions?: boolean
  /** The mapping's human label. Display only — not signed, never acted on. */
  label?: string
  lockedDiffHash: string
  sig: string
}

// ---- Portal-fill protocol (Phase 7D — versioned contract layer only) -------
// Shared message contract between server, extension background, and content
// script. Contract types + version + a pure compatibility guard ONLY — no
// executor, no DOM, no transport. Consumers (server/extension) import these.

/**
 * Bump on any breaking change to the message shapes below.
 * 2: write commands carry `op` / `reveal` / `dialog`. A version-1 extension
 * would set a radio's `value` attribute instead of selecting it and read the
 * same string back as "verified", so it must be refused, not tolerated.
 */
export const PORTAL_FILL_PROTOCOL_VERSION = 2

export type PortalFillFieldOutcome = 'verified' | 'failed'

export type PortalFillFailReason =
  | 'selector_missing'
  | 'value_mismatch'
  | 'portal_mutation'
  | 'controlled_rejected'
  | 'dom_change'
  | 'unsafe_target'
  | 'timeout'
  | 'transport_error'
  | 'replay'

/** server → extension background: deliver the signed plan for one execution run. */
export interface PortalFillPlanMessage {
  protocol: number
  kind: 'plan'
  executionId: string
  applicationId: string
  intents: SignedWriteIntent[]
}

/** background → content script: one field to write (no sig — content has no authority). */
export interface PortalFillWriteCommand {
  protocol: number
  kind: 'write'
  executionId: string
  fieldKey: string
  selector: string
  mappedValue: string
  expectedValueHash: ValueHash
  op?: PortalFillOp
  reveal?: boolean
  dialog?: boolean
  /** A <select> whose options load after an earlier answer: wait for the option (eTA job title). */
  awaitOptions?: boolean
  /** What the side panel shows for this step ("Passport number"). Display only. */
  label?: string
  /**
   * op 'attach_file' only: the document's bytes, read by the server from the
   * applicant's VisaAI storage at dispatch time. Never a URL — the extension
   * fetches nothing the page or the command could point it at.
   */
  file?: PortalFillFile
}

/** A file the server hands the extension to attach (op 'attach_file'). */
export interface PortalFillFile {
  name: string
  mimeType: string
  size: number
  /** sha256 of the bytes, hex — the extension re-hashes before attaching. */
  sha256: string
  base64: string
}

/** content script → background: result of one field (write → readback → compare). */
export interface PortalFillFieldResult {
  protocol: number
  kind: 'field_result'
  executionId: string
  fieldKey: string
  outcome: PortalFillFieldOutcome
  reason?: PortalFillFailReason
  actualValueHash?: ValueHash
  selectorFound: boolean
}

/** background ↔ server: lifecycle stage signal. */
export interface PortalFillStageMessage {
  protocol: number
  kind: 'stage'
  executionId: string
  stage: 'started' | 'completed' | 'failed'
  reason?: PortalFillFailReason
  failedFieldKey?: string
  /** On completed: the portal page(s) this run filled. */
  filledPages?: string[]
  /** On completed/failed: the next page (in portal order) the assistant has values for. */
  nextPage?: { page: string; title: string } | null
  /** Label of the write that failed, for the side panel. */
  failedLabel?: string
  /**
   * On completed, progressive page only (IRCC eTA): labels of reviewed
   * answers whose questions are not on the page yet — revealed by a later
   * answer or behind the portal's own Next button. A later launch fills them.
   */
  remaining?: string[]
  /**
   * On completed: labels of what the assistant leaves for the applicant on
   * the page it filled (the coverage's `left`). The side panel's opt-in
   * auto-advance never presses "Save and continue" when any is listed — or
   * when this is absent (unknown).
   */
  left?: string[]
}

export type PortalFillMessage =
  | PortalFillPlanMessage
  | PortalFillWriteCommand
  | PortalFillFieldResult
  | PortalFillStageMessage

/** Pure handshake guard — reject any message whose protocol does not match. */
export function isPortalFillProtocolCompatible(protocol: number): boolean {
  return protocol === PORTAL_FILL_PROTOCOL_VERSION
}

// ---- Portal-fill orchestration (Phase 7G impl) -----------------------------
export type OrchestrationState =
  | 'PLANNED'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'HALTED'
  | 'COMPLETED'
  | 'FAILED'

/** Result the injected field executor returns for ONE field. */
export interface FieldExecResult {
  fieldKey: string
  outcome: PortalFillFieldOutcome
  reason?: PortalFillFailReason
  actualValueHash?: ValueHash
  selectorFound: boolean
}

/** Terminal outcome of an orchestration run. */
export interface OrchestrationResult {
  executionId: string
  state: 'COMPLETED' | 'FAILED'
  verified: string[]
  failedField?: string
  haltReason?: PortalFillFailReason
}

/** Signed, time-boxed readback token payload bound to the current lock. */
export interface ReadbackTokenPayload {
  applicationId: string
  preflightReviewId: string
  sessionId: string
  userId: string
  executionToken: string
  lockedDiffHash: string
  mappings: PreflightMappingInput[]
  issuedAt: number
}

// ── Messaging (P1 spine) ──────────────────────────────────────────────
export type ConversationStatus = 'open' | 'resolved' | 'closed' | 'archived'

export type MessageSenderRole = 'user' | 'consultant' | 'admin' | 'ai'

export type MessageCategory =
  | 'general'
  | 'documents'
  | 'eligibility'
  | 'application_status'
  | 'payment'
  | 'travel_history'
  | 'biometrics'
  | 'medical'
  | 'other'

export interface Conversation {
  id: string
  application_id: string
  status: ConversationStatus
  consultant_state: ConsultantState | null
  last_message_at: string | null
  created_at: string
}

export interface ConversationParticipant {
  conversation_id: string
  user_id: string
  role: 'user' | 'consultant' | 'admin'
  last_read_at: string | null
  delivered_at: string | null
  joined_at: string
}

export interface Message {
  id: string
  conversation_id: string
  /**
   * Caller-supplied idempotency key (mobile offline queue). Null for messages
   * sent by clients that do not supply one.
   * Schema: supabase/migrations/20260805040000_message_idempotency.sql
   */
  client_id?: string | null
  sender_id: string
  sender_role: MessageSenderRole
  category: MessageCategory
  body: string
  parent_message_id: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

/** One hit from global (cross-conversation) message search. Flattened: carries
 *  the parent application id (for routing) + a human label from the application's
 *  country_framework (null when unavailable). */
export interface GlobalMessageSearchResult {
  id: string
  conversation_id: string
  application_id: string
  category: MessageCategory
  sender_role: MessageSenderRole
  body: string
  created_at: string
  country_code: string | null
  visa_type: string | null
}

export interface AppNotification {
  id: string
  user_id: string
  type: string
  conversation_id: string | null
  message_id: string | null
  read_at: string | null
  created_at: string
}

/** Thread payload returned by GET /messaging/:applicationId. */
export interface ConversationThread {
  conversation: Conversation
  messages: Message[]
  unread_count: number
  participants: ConversationParticipant[]
  has_more: boolean
}

/** A page of older messages (ascending) returned by GET /messaging/:id/messages?before=. */
export interface MessagePage {
  messages: Message[]
  has_more: boolean
}

export type MessagingEventType =
  | 'message.created'
  | 'conversation.status'
  | 'typing'
  | 'attachment.created'
  | 'voice.created'
  | 'document_request.created'
  | 'document_request.updated'
  | 'message.read'
  | 'message.delivered'
  // System notification-feed change for a user (no conversation). Consumers
  // treat any stream event as a signal to refetch their feed/unread count.
  | 'notification'

/** Lightweight event pushed over SSE; never carries message bodies. */
export interface MessagingStreamEvent {
  type: MessagingEventType
  conversation_id: string
  application_id: string
}

// ── Messaging P2 (attachments, voice, document requests) ──────────────
export type AttachmentKind = 'file' | 'image'

export interface MessageAttachment {
  id: string
  message_id: string
  conversation_id: string
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  kind: AttachmentKind
  created_at: string
}

export interface VoiceMessage {
  id: string
  message_id: string
  conversation_id: string
  storage_path: string
  mime_type: string
  duration_ms: number
  size_bytes: number
  created_at: string
}

export type DocumentRequestPriority = 'low' | 'normal' | 'high' | 'urgent'

export type DocumentRequestStatus =
  | 'pending'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'

export interface DocumentRequest {
  id: string
  conversation_id: string
  application_id: string
  requested_by: string
  document_type: string
  label: string
  notes: string | null
  due_date: string | null
  priority: DocumentRequestPriority
  status: DocumentRequestStatus
  checklist_item_id: string | null
  fulfilled_attachment_id: string | null
  created_at: string
  updated_at: string
}

/** Response from POST /messaging/:appId/attachments/upload-url */
export interface SignedUploadResult {
  uploadUrl: string
  storagePath: string
  token: string
}

// ── Messaging P3a (consultant case-ops) ───────────────────────────────
export type ConsultantState =
  | 'pending_user_response'
  | 'waiting_documents'
  | 'under_review'
  | 'resolved'

export interface ConsultantNote {
  id: string
  conversation_id: string
  application_id: string
  author_id: string
  body: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

export type EscalationType =
  | 'complex_case'
  | 'legal_review'
  | 'supervisor_review'
  | 'specialist_review'

export type EscalationStatus = 'open' | 'resolved'

export interface EscalationRecord {
  id: string
  conversation_id: string
  application_id: string
  escalated_by: string
  escalation_type: EscalationType
  reason: string
  status: EscalationStatus
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

// ── Messaging P3b (off-platform notifications) ────────────────────────
export interface PushSubscriptionRecord {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  last_used_at: string | null
}

/**
 * Native (APNs/FCM) push registration — the mobile counterpart of
 * PushSubscriptionRecord. Web Push carries ECDH key material (p256dh/auth);
 * a device token is a single opaque routing address, hence the separate table
 * (supabase/migrations/20260805020000_device_push_tokens.sql).
 */
export type DevicePlatform = 'ios' | 'android'

export interface DevicePushTokenRecord {
  id: string
  user_id: string
  token: string
  platform: DevicePlatform
  device_name: string | null
  app_version: string | null
  last_seen_at: string
  created_at: string
}

export interface NotificationPreferences {
  user_id: string
  email_enabled: boolean
  push_enabled: boolean
  sms_enabled: boolean
  categories: Record<string, boolean>
  quiet_hours_start: number | null
  quiet_hours_end: number | null
  timezone: string | null
  language: string | null
  updated_at: string
}

// ======================================================================
// Auth & User Management — IAM foundation (Phase A)
// Schema: supabase/migrations/20260628000000_iam_foundation.sql
// Docs: VISAAIDocs/features/auth/AUTH-MODULE.md
// ======================================================================

/** The six platform/organization roles. Maps onto the legacy {admin|consultant|user} claim. */
export type RoleKey =
  | 'applicant'
  | 'consultant'
  | 'support_agent'
  | 'org_admin'
  | 'platform_admin'
  | 'super_admin'

export type RoleScope = 'platform' | 'organization'

export interface Role {
  id: string
  key: RoleKey
  name: string
  description: string | null
  scope: RoleScope
  is_system: boolean
  created_at: string
}

export interface Permission {
  id: string
  key: string
  description: string | null
  created_at: string
}

/** Resolved access for a caller: their role keys + the union of permission keys. */
export interface UserAccess {
  user_id: string
  roles: RoleKey[]
  permissions: string[]
}

export interface UserRole {
  id: string
  user_id: string
  role_id: string
  organization_id: string | null
  granted_by: string | null
  granted_at: string
}

// ---- Organizations ---------------------------------------------------
export type OrgMemberRole = 'org_admin' | 'member' | 'consultant'
export type OrgMemberStatus = 'active' | 'suspended'

export interface Organization {
  id: string
  name: string
  slug: string
  owner_user_id: string
  plan: string
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface OrganizationMember {
  id: string
  organization_id: string
  user_id: string
  role: OrgMemberRole
  status: OrgMemberStatus
  joined_at: string
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface OrganizationInvitation {
  id: string
  organization_id: string
  email: string
  role: OrgMemberRole
  token: string
  invited_by: string | null
  status: InvitationStatus
  expires_at: string
  created_at: string
  accepted_at: string | null
}

// ---- Profile ---------------------------------------------------------
export interface UserProfile {
  user_id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country: string | null
  timezone: string
  avatar_url: string | null
  privacy: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ---- Security / audit ------------------------------------------------
export interface LoginHistoryEntry {
  id: string
  user_id: string | null
  email: string | null
  success: boolean
  failure_reason: string | null
  ip: string | null
  user_agent: string | null
  created_at: string
}

export type AuthAuditEventType =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'password_reset_requested'
  | 'password_changed'
  | 'email_verified'
  | 'account_locked'
  | 'account_unlocked'
  | 'role_granted'
  | 'role_revoked'
  | 'org_created'
  | 'org_member_added'
  | 'org_member_removed'
  | 'org_invitation_sent'
  | 'org_invitation_accepted'
  | 'mfa_enabled'
  | 'mfa_disabled'

export interface AuthAuditEntry {
  id: string
  user_id: string | null
  actor_id: string | null
  event_type: AuthAuditEventType
  ip: string | null
  user_agent: string | null
  metadata: Record<string, unknown>
  created_at: string
}

/** account_lockouts row (brute-force tracking, keyed by email). */
export interface AccountLockout {
  email: string
  /**
   * Source address of the failed attempts. Part of the key (SEC-001): keyed on
   * email alone, this table was a remote account-denial primitive — five posts
   * to the unauthenticated record-login endpoint locked a named person out.
   */
  ip: string
  failed_count: number
  locked_until: string | null
  last_failed_at: string | null
  updated_at: string
}

// ======================================================================
// Admin Executive Dashboard (Phase 1)
// Pure types + shapeDashboard aggregator (apps/api/src/modules/admin/dashboard.ts)
// ======================================================================

/** Admin executive dashboard (Phase 1). */
export type DashboardRange = '7d' | '30d' | '90d'

/** Pre-aggregated inputs the service fetches; the pure shaper assembles them. */
export interface AdminDashboardRaw {
  usersTotal: number
  usersNew: number
  consultants: number
  appsByStatus: Record<string, number>
  ai: { inputTokens: number; outputTokens: number; requestCostUsd: number; billableCostUsd: number }
  paymentsByTier: Record<string, number>
  security: { logins: number; lockouts: number }
  recentActivity: unknown[]
  dbReachable: boolean
}

export interface AdminDashboard {
  range: DashboardRange
  users: { total: number; newInRange: number }
  consultants: { total: number }
  applications: { inProgress: number; byStatus: Record<string, number> }
  ai: { tokens: number; requestCostUsd: number; billableCostUsd: number }
  /** Order volume (count) by plan_tier over range — NOT a money amount. `payments.amount_cents` exists but is sparsely populated (processing-fee rows only), so a $ sum would mislead; full revenue reconciliation is deferred (PRICE-12). */
  revenue: { completedByTier: Record<string, number>; note: string }
  /** Counts over range. Only login_success + account_locked are recorded; there is no login_failed event. */
  security: { logins: number; lockouts: number }
  recentActivity: unknown[]
  subscriptions: { available: false; reason: string }
  supportTickets: { available: false; reason: string }
  systemHealth: { available: boolean; dbReachable: boolean; reason?: string }
}

export type UserStatus = 'active' | 'suspended' | 'deleted';

export interface AuthAuditRow {
  id: string;
  eventType: string;
  actorId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface AdminUserView {
  id: string;
  email: string;
  fullName: string | null;
  status: UserStatus;
  appRole: 'admin' | 'consultant' | 'user';
  roles: string[]; // IAM role keys
  lastSignInAt: string | null;
  bannedUntil: string | null;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserView {
  nationality: string | null;
  emailConfirmedAt: string | null;
  statusReason: string | null;
  statusChangedAt: string | null;
  applicationsCount: number;
  recentAuth: AuthAuditRow[];
}

export interface AdminUserListResult {
  rows: AdminUserView[];
  total: number;
}

export type BulkAction = 'suspend' | 'reactivate' | 'soft-delete' | 'restore';
export interface BulkActionResult {
  succeeded: string[];
  skipped: { id: string; reason: string }[];
}

// ======================================================================
// Notification Backbone (system-event feed + delivery tracking)
// Schema: supabase/migrations/20260701000000_notification_backbone.sql
// ======================================================================

export type NotificationCategory =
  | 'application' | 'billing' | 'assignment' | 'ai' | 'support' | 'system';
export type DeliveryChannel = 'in_app' | 'email' | 'web_push' | 'sms';
export type DeliveryStatus = 'queued' | 'sent' | 'failed' | 'skipped' | 'dead';

export interface NotificationFeedItem {
  id: string;
  type: string;
  category: NotificationCategory;
  title: string | null;
  body: string | null;
  link: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  /** Set for message-ping rows (a new-message notification), else null. */
  conversationId?: string | null;
  messageId?: string | null;
}
export interface NotificationFeedPage {
  rows: NotificationFeedItem[];
  unread: number;
  nextCursor: string | null;
}

export interface NotificationTemplate {
  id: string
  event_type: string
  locale: string
  subject: string | null
  title: string
  body: string
  variables: string[]
  version: number
  is_active: boolean
  created_at: string
}
export interface NotificationTemplateInput {
  event_type: string
  locale?: string
  subject?: string | null
  title: string
  body: string
  variables?: string[]
}

export type NotificationOpsRange = '24h' | '7d' | '30d'
export interface NotificationQueueCounts {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}
export interface NotificationOpsMetrics {
  range: NotificationOpsRange
  total: number
  byStatus: Record<DeliveryStatus, number>
  byChannel: Record<string, number>
  byEvent: Record<string, number>
  queue: NotificationQueueCounts
}
export interface FailedDeliveryRow {
  id: string
  eventType: string
  channel: string
  status: string
  attempts: number
  error: string | null
  userId: string
  createdAt: string
}
export interface FailedDeliveryPage {
  rows: FailedDeliveryRow[]
  total: number
  nextCursor: string | null
}

export type BroadcastAudience =
  | { kind: 'all' }
  | { kind: 'role'; role: 'admin' | 'consultant' | 'user' }
  | { kind: 'users'; userIds: string[] }
export interface NotificationBroadcast {
  id: string
  title: string
  body: string
  link: string | null
  category: NotificationCategory
  audience: BroadcastAudience
  status: 'sending' | 'sent' | 'failed'
  recipient_count: number
  created_at: string
  completed_at: string | null
}
export interface BroadcastInput {
  title: string
  body: string
  link?: string | null
  category?: NotificationCategory
  audience: BroadcastAudience
}
export interface NotificationBroadcastPage {
  rows: NotificationBroadcast[]
  nextCursor: string | null
}

// --- Analytics (SP-B/SP-C/SP-D shared metric contract) ---
export type Grain = 'day' | 'week' | 'month'
export type MetricUnit = 'cents' | 'count' | 'ratio' | 'usd'
export interface MetricFilters {
  country?: string
  plan?: string
  visa_type?: string
  framework_id?: string
  consultant_id?: string
}
export interface MetricQuery {
  from: string
  to: string
  grain: Grain
  filters?: MetricFilters
  compareTo?: 'prev_period' | 'prev_year' | null
}
export interface MetricResult<TExtra = unknown> {
  metric: string
  unit: MetricUnit
  total: number
  series: { bucket: string; value: number }[]
  byDimension?: { key: string; value: number }[]
  delta?: { baseline: number; pct: number } | null
  meta: { computedAt: string; tier: 'live' | 'rollup' | 'derived'; stale?: boolean }
  extra?: TExtra
}

// --- Partner API platform (Task 11) ---
// Contract shared by the API, the Partner Portal and the TypeScript SDK. The
// partner-facing wire format is snake_case (it is a public REST API and that
// is what integrators expect); internal shapes stay camelCase.

export type PartnerEnvironment = 'sandbox' | 'live'
export type PartnerStatus = 'pending' | 'approved' | 'suspended' | 'rejected'
export type PartnerApplicationStatus =
  | 'pending_review'
  | 'active'
  | 'suspended'
  | 'revoked'
export type PartnerCredentialKind = 'api_key' | 'oauth_token'
export type PartnerGrantType = 'client_credentials' | 'authorization_code'

/**
 * Every scope the platform recognises. A scope that is not in this union
 * cannot be granted — the catalog is closed by construction, so a typo in a
 * grant becomes a compile error rather than a silent permission.
 */
export type PartnerScope =
  | 'partner:read'
  | 'usage:read'
  | 'webhooks:read'
  | 'webhooks:write'
  | 'applications:read'
  | 'applications:write'
  | 'documents:read'
  | 'consents:read'

export interface Partner {
  id: string
  organization_id: string
  legal_name: string
  contact_email: string
  website: string | null
  status: PartnerStatus
  tier: 'standard' | 'scale' | 'enterprise'
  created_at: string
}

export interface PartnerApplication {
  id: string
  partner_id: string
  name: string
  description: string | null
  environment: PartnerEnvironment
  client_id: string
  client_type: 'confidential' | 'public'
  status: PartnerApplicationStatus
  scopes: PartnerScope[]
  requested_scopes: PartnerScope[]
  grant_types: PartnerGrantType[]
  redirect_uris: string[]
  ip_allowlist: string[]
  created_at: string
}

/** Returned once, at creation. The plaintext key is never retrievable again. */
export interface PartnerApiKeyIssued {
  id: string
  name: string
  /** Full key: `vak_<env>_<prefix>_<secret>`. Shown exactly once. */
  key: string
  prefix: string
  last_four: string
  scopes: PartnerScope[]
  expires_at: string | null
}

export interface PartnerApiKeySummary {
  id: string
  name: string
  prefix: string
  last_four: string
  scopes: PartnerScope[]
  status: 'active' | 'rotating' | 'revoked'
  expires_at: string | null
  last_used_at: string | null
  created_at: string
}

export interface PartnerTokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  scope: string
}

/** Resolved caller identity for one partner request. */
export interface PartnerPrincipal {
  partnerId: string
  organizationId: string
  applicationId: string
  clientId: string
  environment: PartnerEnvironment
  scopes: PartnerScope[]
  credentialKind: PartnerCredentialKind
  credentialId: string
  /** Set only for user-consented (authorization_code) tokens. */
  subjectUserId: string | null
}

export type PartnerEventType =
  | 'application.created'
  | 'application.updated'
  | 'application.status_changed'
  | 'document.uploaded'
  | 'document.processing_completed'
  | 'eligibility.assessment_completed'
  | 'appointment.booked'
  | 'appointment.changed'
  | 'payment.status_changed'
  | 'consultant.assignment_changed'

export interface PartnerWebhookEndpoint {
  id: string
  url: string
  description: string | null
  events: PartnerEventType[]
  status: 'pending_verification' | 'active' | 'disabled'
  consecutive_failures: number
  disabled_reason: string | null
  created_at: string
}

export interface PartnerWebhookDelivery {
  id: string
  event_id: string
  event_type: PartnerEventType
  status: 'pending' | 'delivering' | 'delivered' | 'failed' | 'dead'
  attempt_count: number
  next_attempt_at: string
  last_status_code: number | null
  last_error: string | null
  delivered_at: string | null
  created_at: string
}

/** The signed envelope a partner receives. */
export interface PartnerWebhookPayload {
  id: string
  type: PartnerEventType
  created_at: string
  environment: PartnerEnvironment
  /** Monotonic per organization; use it to detect gaps, not to order writes. */
  sequence: number
  data: Record<string, unknown>
}

export interface PartnerUsageSnapshot {
  environment: PartnerEnvironment
  rate_limit: { limit: number; remaining: number; reset_at: string }
  quota_day: { limit: number; used: number; remaining: number; reset_at: string }
  quota_month: { limit: number; used: number; remaining: number; reset_at: string }
}

/** Uniform partner error body. Every non-2xx response has this shape. */
export interface PartnerErrorBody {
  error: {
    type:
      | 'invalid_request'
      | 'authentication_error'
      | 'permission_error'
      | 'not_found'
      | 'conflict'
      | 'rate_limit_error'
      | 'quota_exceeded'
      | 'api_error'
    code: string
    message: string
    /** Echoed from `X-Request-Id`; quote it in support requests. */
    request_id: string
    /** Present on 429/503. Seconds. */
    retry_after?: number
    param?: string
    doc_url?: string
  }
}

export interface PartnerPage<T> {
  data: T[]
  has_more: boolean
  next_cursor: string | null
}

export interface PartnerApiProduct {
  key: string
  name: string
  description: string
  required_scopes: PartnerScope[]
  data_classification: 'public' | 'internal' | 'personal' | 'sensitive_personal'
  environments: PartnerEnvironment[]
  status: 'ga' | 'beta' | 'planned' | 'deprecated'
  requires_user_consent: boolean
  requires_approval: boolean
  slo: { availability: string; p95_latency_ms: number } | null
  docs_url: string
}
