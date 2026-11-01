import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AiService } from '../shared/ai/ai.service';
import { ConsultantWriteClient } from './consultant-write-client';
import { ASSIGNMENT_REPOSITORY } from './assignment.repository';
import type { IAssignmentRepository } from './assignment.repository';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../shared/ai/untrusted';
import { reviewStoredCrossCheck } from '../documents/graphs/nodes/identity-compare';

/**
 * AiReviewAssistantService — Phase 9 (AIR-1..AIR-3).
 *
 * An ADVISORY copilot for the assigned consultant. It reads the case's already
 * computed signals (checklist gaps, VRI dimensions, document verifications and
 * cross-verifications) and turns them into: missing-document detection + risk
 * flags (deterministic), plus LLM-generated improvement suggestions and a
 * consultant-facing summary.
 *
 * HARD GUARANTEE — this service is decision-NEUTRAL. It performs ZERO writes:
 * it never touches `consultant_approvals`, never (re)assigns, never approves or
 * rejects. Every output is marked `advisory: true`; the consultant remains the
 * sole decision-maker. All reads reuse the existing pipeline outputs — nothing
 * is re-OCR'd or re-scored here.
 */

// ---- Output types (plain, advisory). Candidates for @visaai/types. ----------

export type AiReviewSeverity = 'low' | 'medium' | 'high';

export type AiReviewRiskCategory =
  | 'vri_dimension'
  | 'document_verification'
  | 'cross_verification';

export interface AiReviewRiskFlag {
  category: AiReviewRiskCategory;
  severity: AiReviewSeverity;
  /** Stable machine code, e.g. `vri.financial_low`, `docver.fail`. */
  code: string;
  /** Human-readable, consultant-facing description of the signal. */
  message: string;
  /** Optional structured context (never raw PII; ids + small scalars only). */
  detail?: Record<string, unknown>;
}

export interface AiReviewMissingDocument {
  documentType: string;
  label: string;
  required: boolean;
  status: string;
  /** Why this item is on the checklist (added_reason), when available. */
  addedReason: string | null;
}

export interface AiReviewVriSnapshot {
  overallScore: number;
  dimensions: { key: string; label: string; pct: number }[];
  calculatedAt: string | null;
}

export interface AiReviewAnalysis {
  applicationId: string;
  /** Always true — this output is advisory and never a decision. */
  advisory: true;
  generatedAt: string;
  vri: AiReviewVriSnapshot | null;
  missingDocuments: AiReviewMissingDocument[];
  riskFlags: AiReviewRiskFlag[];
  counts: {
    missingDocuments: number;
    riskFlags: number;
    highSeverity: number;
  };
  disclaimer: string;
}

export interface AiReviewSuggestion {
  title: string;
  detail: string;
  priority: AiReviewSeverity;
}

export interface AiReviewSuggestions {
  applicationId: string;
  advisory: true;
  generatedAt: string;
  suggestions: AiReviewSuggestion[];
  /** 'ai' when the LLM produced them, 'fallback' when derived deterministically. */
  source: 'ai' | 'fallback';
  disclaimer: string;
}

export interface AiReviewSummary {
  applicationId: string;
  advisory: true;
  generatedAt: string;
  summary: string;
  source: 'ai' | 'fallback';
  disclaimer: string;
}

export interface AiReview {
  applicationId: string;
  advisory: true;
  generatedAt: string;
  analysis: AiReviewAnalysis;
  suggestions: AiReviewSuggestions;
  summary: AiReviewSummary;
  disclaimer: string;
}

/** Caller identity (mirrors ConsultantReviewService.ReviewCaller). */
export interface AiReviewCaller {
  id: string;
  appRole?: 'admin' | 'consultant' | 'user';
}

const DISCLAIMER =
  'AI-generated advisory analysis. It does not approve, reject, or submit ' +
  'anything. The assigned consultant remains the sole decision-maker and must ' +
  'independently verify every point before acting.';

/** The six VRI readiness dimensions, with consultant-facing labels. */
const VRI_DIMENSIONS: { key: string; label: string }[] = [
  { key: 'documentation_pct', label: 'Documentation completeness' },
  { key: 'financial_pct', label: 'Financial sufficiency' },
  { key: 'travel_history_pct', label: 'Travel history' },
  { key: 'home_ties_pct', label: 'Home-country ties' },
  { key: 'employment_pct', label: 'Employment' },
  { key: 'consistency_pct', label: 'Cross-document consistency' },
];

/** Map a 0–100 score to a severity, or null when it is healthy (>= 75). */
function severityForPct(pct: number): AiReviewSeverity | null {
  if (pct < 40) return 'high';
  if (pct < 60) return 'medium';
  if (pct < 75) return 'low';
  return null;
}

// ---- Row shapes (service-role reads) ----------------------------------------

interface ChecklistRow {
  document_type: string;
  label: string;
  required: boolean;
  status: string;
  added_reason: string | null;
}

interface VriRow {
  overall_score: number;
  documentation_pct: number;
  financial_pct: number;
  travel_history_pct: number;
  home_ties_pct: number;
  employment_pct: number;
  consistency_pct: number;
  calculated_at: string | null;
}

interface DocumentRow {
  id: string;
  document_type: string | null;
  file_name: string | null;
}

interface DocVerificationRow {
  document_id: string;
  verification_type: string;
  result: 'pass' | 'warn' | 'fail';
  verified_at: string | null;
}

interface CrossVerificationRow {
  field_compared: string;
  result: 'match' | 'mismatch' | 'warning';
  checked_at: string | null;
}

@Injectable()
export class AiReviewAssistantService {
  private readonly log = new Logger(AiReviewAssistantService.name);

  constructor(
    private readonly ai: AiService,
    private readonly writes: ConsultantWriteClient,
    @Inject(ASSIGNMENT_REPOSITORY) private readonly repo: IAssignmentRepository,
  ) {}

  // ---- AIR-1: deterministic analysis ------------------------------------

  /**
   * Missing-document detection (checklist gaps) + risk flags (low VRI
   * dimensions, failed/warned document verifications, cross-verification
   * mismatches). Pure read + pure compute; no LLM, no writes.
   */
  async analyze(
    applicationId: string,
    caller: AiReviewCaller,
  ): Promise<AiReviewAnalysis> {
    await this.assertAccess(applicationId, caller);
    return this.computeAnalysis(applicationId);
  }

  // ---- AIR-2: LLM suggestions + summary ---------------------------------

  /** Actionable, consultant-facing improvement suggestions (LLM via AiService). */
  async suggestImprovements(
    applicationId: string,
    caller: AiReviewCaller,
  ): Promise<AiReviewSuggestions> {
    await this.assertAccess(applicationId, caller);
    const analysis = await this.computeAnalysis(applicationId);
    return this.buildSuggestions(analysis, caller);
  }

  /** Concise summary of the case's readiness for the consultant (LLM via AiService). */
  async generateReviewSummary(
    applicationId: string,
    caller: AiReviewCaller,
  ): Promise<AiReviewSummary> {
    await this.assertAccess(applicationId, caller);
    const analysis = await this.computeAnalysis(applicationId);
    return this.buildSummary(analysis, caller);
  }

  // ---- AIR-3: combined payload for the endpoint -------------------------

  /**
   * One-shot advisory review: authorize + load once, then assemble analysis,
   * suggestions and summary. Used by `GET /consultant/ai-review/:applicationId`.
   */
  async getReview(
    applicationId: string,
    caller: AiReviewCaller,
  ): Promise<AiReview> {
    await this.assertAccess(applicationId, caller);
    const analysis = await this.computeAnalysis(applicationId);
    const [suggestions, summary] = await Promise.all([
      this.buildSuggestions(analysis, caller),
      this.buildSummary(analysis, caller),
    ]);
    return {
      applicationId,
      advisory: true,
      generatedAt: new Date().toISOString(),
      analysis,
      suggestions,
      summary,
      disclaimer: DISCLAIMER,
    };
  }

  // ---- authorization (mirrors ConsultantReviewService) -----------------

  /**
   * Assigned-consultant-only access. Admin → any application; consultant → only
   * an application they ACTIVELY assign (primary or backup). Reuses the existing
   * assignment repository ownership check; performs no writes.
   */
  private async assertAccess(
    applicationId: string,
    caller: AiReviewCaller,
  ): Promise<void> {
    const app = await this.repo.getApplicationMeta(applicationId);
    if (!app) throw new NotFoundException('application not found');

    if (caller.appRole === 'admin') return;

    const active = await this.repo.getActiveAssignmentFor(
      applicationId,
      caller.id,
    );
    if (!active) throw new ForbiddenException('not the active assignee');
  }

  // ---- compute (deterministic) -----------------------------------------

  private async computeAnalysis(
    applicationId: string,
  ): Promise<AiReviewAnalysis> {
    const db = this.writes.client;

    // Documents first — document_verifications key off document_id, not the app.
    const [checklist, vri, documents, crossVer] = await Promise.all([
      this.loadChecklist(db, applicationId),
      this.loadLatestVri(db, applicationId),
      this.loadDocuments(db, applicationId),
      this.loadCrossVerifications(db, applicationId),
    ]);
    const docVer = await this.loadDocVerifications(
      db,
      documents.map((d) => d.id),
    );

    const missingDocuments = this.detectMissingDocuments(checklist);
    const riskFlags = [
      ...this.flagVri(vri),
      ...this.flagDocVerifications(docVer, documents),
      ...this.flagCrossVerifications(crossVer),
    ];

    const highSeverity = riskFlags.filter((f) => f.severity === 'high').length;

    return {
      applicationId,
      advisory: true,
      generatedAt: new Date().toISOString(),
      vri: vri && this.vriSnapshot(vri),
      missingDocuments,
      riskFlags,
      counts: {
        missingDocuments: missingDocuments.length,
        riskFlags: riskFlags.length,
        highSeverity,
      },
      disclaimer: DISCLAIMER,
    };
  }

  // ---- data loaders (read-only; advisory inputs) -----------------------

  private async loadChecklist(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<ChecklistRow[]> {
    const { data, error } = await db
      .from('checklist_items')
      .select('document_type, label, required, status, added_reason')
      .eq('application_id', applicationId);
    if (error) throw error;
    return data ?? [];
  }

  private async loadLatestVri(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<VriRow | null> {
    const { data, error } = await db
      .from('vri_scores')
      .select(
        'overall_score, documentation_pct, financial_pct, travel_history_pct, home_ties_pct, employment_pct, consistency_pct, calculated_at',
      )
      .eq('application_id', applicationId)
      .order('calculated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  private async loadDocuments(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<DocumentRow[]> {
    // documents carry no type column — it lives on the linked checklist_item.
    const { data, error } = await db
      .from('documents')
      .select('id, file_name, checklist_items(document_type)')
      .eq('application_id', applicationId);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, any>>).map((r) => ({
      id: r.id as string,
      file_name: (r.file_name as string | null) ?? null,
      document_type:
        (r.checklist_items?.document_type as string | undefined) ?? null,
    }));
  }

  private async loadCrossVerifications(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<CrossVerificationRow[]> {
    const { data, error } = await db
      .from('cross_verifications')
      .select('field_compared, result, checked_at, details_json')
      .eq('application_id', applicationId);
    if (error) throw error;
    // Current untyped-upload rules, not the ones in force when stored.
    return (data ?? [])
      .map((row) => reviewStoredCrossCheck(row))
      .filter((row) => row !== null);
  }

  private async loadDocVerifications(
    db: SupabaseClient,
    documentIds: string[],
  ): Promise<DocVerificationRow[]> {
    if (documentIds.length === 0) return [];
    const { data, error } = await db
      .from('document_verifications')
      .select('document_id, verification_type, result, verified_at')
      .in('document_id', documentIds);
    if (error) throw error;
    return data ?? [];
  }

  private detectMissingDocuments(
    rows: ChecklistRow[],
  ): AiReviewMissingDocument[] {
    return rows
      .filter((r) => r.required && r.status === 'missing')
      .map((r) => ({
        documentType: r.document_type,
        label: r.label,
        required: r.required,
        status: r.status,
        addedReason: r.added_reason ?? null,
      }));
  }

  private vriSnapshot(vri: VriRow): AiReviewVriSnapshot {
    return {
      overallScore: vri.overall_score,
      dimensions: VRI_DIMENSIONS.map((d) => ({
        key: d.key,
        label: d.label,
        pct: (vri as unknown as Record<string, number>)[d.key] ?? 0,
      })),
      calculatedAt: vri.calculated_at ?? null,
    };
  }

  private flagVri(vri: VriRow | null): AiReviewRiskFlag[] {
    if (!vri) return [];
    const flags: AiReviewRiskFlag[] = [];

    const overallSeverity = severityForPct(vri.overall_score);
    if (overallSeverity) {
      flags.push({
        category: 'vri_dimension',
        severity: overallSeverity,
        code: 'vri.overall_low',
        message: `Overall readiness score is ${vri.overall_score}/100.`,
        detail: { pct: vri.overall_score },
      });
    }

    for (const dim of VRI_DIMENSIONS) {
      const pct = (vri as unknown as Record<string, number>)[dim.key] ?? 0;
      const severity = severityForPct(pct);
      if (!severity) continue;
      flags.push({
        category: 'vri_dimension',
        severity,
        code: `vri.${dim.key}_low`,
        message: `${dim.label} scores ${pct}/100.`,
        detail: { dimension: dim.key, pct },
      });
    }
    return flags;
  }

  private flagDocVerifications(
    rows: DocVerificationRow[],
    documents: DocumentRow[],
  ): AiReviewRiskFlag[] {
    const nameById = new Map(
      documents.map((d) => [d.id, d.file_name ?? d.document_type ?? d.id]),
    );
    return rows
      .filter((r) => r.result === 'fail' || r.result === 'warn')
      .map((r) => ({
        category: 'document_verification' as const,
        severity: r.result === 'fail' ? ('high' as const) : ('medium' as const),
        code: `docver.${r.result}`,
        message: `${r.verification_type} verification ${r.result === 'fail' ? 'failed' : 'raised a warning'} on "${nameById.get(r.document_id) ?? r.document_id}".`,
        detail: {
          documentId: r.document_id,
          verificationType: r.verification_type,
          result: r.result,
        },
      }));
  }

  private flagCrossVerifications(
    rows: CrossVerificationRow[],
  ): AiReviewRiskFlag[] {
    return rows
      .filter((r) => r.result === 'mismatch' || r.result === 'warning')
      .map((r) => ({
        category: 'cross_verification' as const,
        severity:
          r.result === 'mismatch' ? ('high' as const) : ('medium' as const),
        code: `crossver.${r.result}`,
        message: `Cross-document check on "${r.field_compared}" is a ${r.result}.`,
        detail: { fieldCompared: r.field_compared, result: r.result },
      }));
  }

  // ---- LLM-backed outputs (advisory) -----------------------------------

  private async buildSuggestions(
    analysis: AiReviewAnalysis,
    caller: AiReviewCaller,
  ): Promise<AiReviewSuggestions> {
    const base = {
      applicationId: analysis.applicationId,
      advisory: true as const,
      generatedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    };

    if (!this.ai.available) {
      return {
        ...base,
        suggestions: this.fallbackSuggestions(analysis),
        source: 'fallback',
      };
    }

    const { system, user } = buildSuggestionsPrompt(analysis);
    let aiSuggestions: AiReviewSuggestion[] | null = null;
    try {
      const raw = await this.ai.completeJSON({
        system,
        user,
        json: true,
        maxTokens: 900,
        meta: {
          operation: 'consultant_ai_review',
          applicationId: analysis.applicationId,
          userId: caller.id,
        },
      });
      aiSuggestions = parseSuggestions(raw);
    } catch (err) {
      this.log.warn(
        `suggestImprovements LLM call failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    if (aiSuggestions && aiSuggestions.length > 0) {
      return { ...base, suggestions: aiSuggestions, source: 'ai' };
    }
    return {
      ...base,
      suggestions: this.fallbackSuggestions(analysis),
      source: 'fallback',
    };
  }

  private async buildSummary(
    analysis: AiReviewAnalysis,
    caller: AiReviewCaller,
  ): Promise<AiReviewSummary> {
    const base = {
      applicationId: analysis.applicationId,
      advisory: true as const,
      generatedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    };

    if (!this.ai.available) {
      return {
        ...base,
        summary: this.fallbackSummary(analysis),
        source: 'fallback',
      };
    }

    const { system, user } = buildSummaryPrompt(analysis);
    let summary: string | null = null;
    try {
      const raw = await this.ai.completeJSON({
        system,
        user,
        json: true,
        maxTokens: 700,
        meta: {
          operation: 'consultant_ai_review',
          applicationId: analysis.applicationId,
          userId: caller.id,
        },
      });
      summary = parseSummary(raw);
    } catch (err) {
      this.log.warn(
        `generateReviewSummary LLM call failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    if (summary) return { ...base, summary, source: 'ai' };
    return {
      ...base,
      summary: this.fallbackSummary(analysis),
      source: 'fallback',
    };
  }

  /** Deterministic suggestions when the LLM is unavailable or returns nothing. */
  private fallbackSuggestions(
    analysis: AiReviewAnalysis,
  ): AiReviewSuggestion[] {
    const out: AiReviewSuggestion[] = [];
    for (const doc of analysis.missingDocuments.slice(0, 10)) {
      out.push({
        title: `Request: ${doc.label}`,
        detail: `This required document is still missing (status: ${doc.status}). Consider asking the applicant to provide it.`,
        priority: 'high',
      });
    }
    for (const flag of analysis.riskFlags.slice(0, 10)) {
      out.push({
        title: flag.message,
        detail: `Review this ${flag.category.replace('_', ' ')} signal and confirm with the applicant or supporting evidence.`,
        priority: flag.severity,
      });
    }
    if (out.length === 0) {
      out.push({
        title: 'No automated gaps detected',
        detail:
          'No missing required documents or risk signals were found in the available data. Continue with your standard review.',
        priority: 'low',
      });
    }
    return out;
  }

  /** Deterministic summary when the LLM is unavailable or returns nothing. */
  private fallbackSummary(analysis: AiReviewAnalysis): string {
    const parts: string[] = [];
    if (analysis.vri) {
      parts.push(`Overall readiness ${analysis.vri.overallScore}/100.`);
    }
    parts.push(
      `${analysis.counts.missingDocuments} missing required document(s), ${analysis.counts.riskFlags} risk flag(s) (${analysis.counts.highSeverity} high severity).`,
    );
    parts.push(
      'Advisory only — the consultant must verify each point and make the final decision.',
    );
    return parts.join(' ');
  }
}

// ---- Pure prompt builders + parsers (no I/O; unit-testable) -----------------

const SYSTEM_RULES = [
  'You assist a licensed human immigration consultant reviewing a visa case.',
  'Your output is ADVISORY ONLY. You are not the decision-maker.',
  'Hard rules:',
  '- Do NOT approve, reject, submit, or recommend an approve/reject decision.',
  '- Do NOT give legal advice or guarantee/predict the application outcome.',
  '- Do NOT invent documents, facts, deadlines, or requirements that are not in the provided context.',
  '- Only reason about the signals provided (checklist gaps, VRI dimensions, verification results).',
  'Help the consultant act: what to request, what to double-check, where the risk is.',
  // Pairs with the asUntrustedData() fences around risk flags and document
  // labels below. Without the directive the fence markers are just punctuation.
  UNTRUSTED_DATA_DIRECTIVE,
].join('\n');

/** Builds the suggestions prompt from the deterministic analysis. */
export function buildSuggestionsPrompt(analysis: AiReviewAnalysis): {
  system: string;
  user: string;
} {
  const system = [
    SYSTEM_RULES,
    'Return ONLY JSON of the form {"suggestions":[{"title":string,"detail":string,"priority":"low"|"medium"|"high"}]}.',
  ].join('\n');
  const user = [
    `Application ${analysis.applicationId} — advisory review.`,
    analysis.vri
      ? `VRI overall: ${analysis.vri.overallScore}/100. Dimensions: ${analysis.vri.dimensions
          .map((d) => `${d.label} ${d.pct}`)
          .join(', ')}.`
      : 'VRI: not yet calculated.',
    // SEC: risk-flag messages and document labels embed applicant-controlled
    // text. `file_name` arrives unvalidated from POST /documents/register and
    // is interpolated into a flag message by flagDocVerifications(), so an
    // applicant can write instructions into their own filename and have them
    // replayed inside the prompt that briefs the licensed consultant reviewing
    // their case. Fenced as data, with the standing directive in the system
    // prompt below.
    `Missing required documents (${analysis.missingDocuments.length}): ${asUntrustedData(
      'document labels',
      analysis.missingDocuments.map((d) => d.label).join('; ') || '(none)',
    )}.`,
    `Risk flags (${analysis.riskFlags.length}): ${asUntrustedData(
      'risk flags',
      analysis.riskFlags
        .map((f) => `[${f.severity}] ${f.message}`)
        .join('; ') || '(none)',
    )}.`,
    '',
    'Produce prioritized, actionable suggestions the consultant can act on.',
  ].join('\n');
  return { system, user };
}

/** Builds the summary prompt from the deterministic analysis. */
export function buildSummaryPrompt(analysis: AiReviewAnalysis): {
  system: string;
  user: string;
} {
  const system = [
    SYSTEM_RULES,
    'Return ONLY JSON of the form {"summary":string}. Keep it to a short paragraph (<= 120 words).',
  ].join('\n');
  const user = [
    `Application ${analysis.applicationId} — write a concise readiness summary for the consultant.`,
    analysis.vri
      ? `VRI overall ${analysis.vri.overallScore}/100.`
      : 'VRI not calculated.',
    `${analysis.counts.missingDocuments} missing required doc(s); ${analysis.counts.riskFlags} risk flag(s) (${analysis.counts.highSeverity} high).`,
    `Top flags: ${asUntrustedData(
      'risk flags',
      analysis.riskFlags
        .slice(0, 5)
        .map((f) => `[${f.severity}] ${f.message}`)
        .join('; ') || '(none)',
    )}.`,
  ].join('\n');
  return { system, user };
}

/** Defensively parse the LLM suggestions JSON into validated entries. */
export function parseSuggestions(raw: string): AiReviewSuggestion[] | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  const list = (obj as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(list)) return null;
  const out: AiReviewSuggestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const detail = typeof rec.detail === 'string' ? rec.detail.trim() : '';
    if (!title && !detail) continue;
    const priority: AiReviewSeverity =
      rec.priority === 'high' || rec.priority === 'low'
        ? rec.priority
        : 'medium';
    out.push({ title: title || detail, detail: detail || title, priority });
  }
  return out;
}

/** Defensively parse the LLM summary JSON (or accept a raw string). */
export function parseSummary(raw: string): string | null {
  try {
    const obj = JSON.parse(raw) as { summary?: unknown };
    if (typeof obj.summary === 'string' && obj.summary.trim())
      return obj.summary.trim();
  } catch {
    // not JSON — fall through
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
