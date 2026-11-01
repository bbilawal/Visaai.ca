import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import { EntitlementService } from '../entitlement/entitlement.service';
import { buildVriGraph } from './graphs/vri.graph';
import { RiskConfigService } from './risk-config.service';
import { AssignmentService } from '../consultant/assignment.service';
import { NotificationEventBus } from '../notifications/notification-event-bus';
import type { Env } from '../../config/configuration';

@Injectable()
export class VriService {
  private readonly openaiKey: string;

  constructor(
    private supabase: SupabaseService,
    private config: ConfigService<Env>,
    private riskConfig: RiskConfigService,
    private assignment: AssignmentService,
    private notifBus: NotificationEventBus,
    private meter: AiUsageMeter,
    private entitlement: EntitlementService,
  ) {
    this.openaiKey = this.config.get('OPENAI_API_KEY', { infer: true })!;
  }

  // F1: ownership check runs under the caller's RLS-scoped client.
  private async verifyOwnership(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ): Promise<{ planTier: string }> {
    const { data } = await db
      .from('applications')
      .select('id, plan_tier')
      .eq('id', applicationId)
      .eq('user_id', userId)
      .single();
    if (!data) throw new ForbiddenException('Access denied');

    // Report the EFFECTIVE tier, not the stored column.
    //
    // The readiness screen decides what to show from this value, so a
    // free-access tester whose application row still says `none` would be
    // shown the upgrade wall while the API happily allowed the request behind
    // it — access granted on one side of the same gate and refused on the
    // other. EntitlementService stays the single place that answers "what is
    // this user entitled to".
    if (this.entitlement.hasFreeAccess(userId)) {
      return { planTier: 'expert' };
    }
    return { planTier: (data as { plan_tier?: string }).plan_tier ?? 'none' };
  }

  /** Best-effort read of the user's preferred UI language (drives AI response
   *  language). Falls back to null (English) on any error or unset preference. */
  private async getUserLanguage(
    db: SupabaseClient,
    userId: string,
  ): Promise<string | null> {
    try {
      const { data } = await db
        .from('users')
        .select('preferred_language')
        .eq('id', userId)
        .single();
      return (
        (data as { preferred_language?: string | null } | null)
          ?.preferred_language ?? null
      );
    } catch {
      return null;
    }
  }

  async calculate(db: SupabaseClient, applicationId: string, userId: string) {
    const { planTier } = await this.verifyOwnership(db, applicationId, userId);
    const language = await this.getUserLanguage(db, userId);
    // Resolve the config snapshot (weights + thresholds) once per calculate().
    // Pure inputs to the (still pure) scoring math; never crashes (falls back to
    // hardcoded defaults). See RiskConfigService.
    const riskConfig = await this.riskConfig.getSnapshot();
    // F1: graph built per-request with the scoped client so its read/write nodes
    // run under Row-Level Security instead of the service-role key.
    const graph = buildVriGraph(
      db,
      this.openaiKey,
      language,
      riskConfig,
      this.meter,
      {
        applicationId,
        userId,
      },
      // SEC-4094: applications.vri_score is pinned against owner writes, so
      // the save node's single denormalising update needs the service role.
      // Ownership was verified just above.
      this.supabase.admin,
    );
    const result = await graph.invoke({ applicationId });

    // AUTO-ESCALATE-ON-LOW-SCORE (HITL): the aggregate node decided this and the
    // save node persisted vri_scores.escalated + applications.needs_consultant_escalation.
    // Here we ALSO record a durable, system-actor consultant escalation audit event.
    // Best-effort: escalation bookkeeping must never break the readiness calculation.
    if (result.escalate) {
      try {
        await this.assignment.flagForConsultantEscalation(
          applicationId,
          result.escalationReason ?? null,
        );
      } catch {
        // swallow: the DB flag remains the cross-module contract.
      }
    }

    // North-star event (Strategy Action 19): an application reached a Readiness
    // score. Best-effort; analytics must never break the core request.
    try {
      // System analytics write uses the service-role client (no user-insert policy needed).
      await this.supabase.admin.from('analytics_events').insert({
        user_id: userId,
        application_id: applicationId,
        event_name: 'application_readiness_reached',
        stage: 'readiness',
        properties: { overall_score: result.overallScore },
      });
    } catch {
      // swallow: instrumentation is non-critical
    }

    // Notify the applicant their assessment finished. Best-effort — never blocks.
    try {
      this.notifBus.emit({
        type: 'ai.assessment_complete',
        userId,
        applicationId,
        data: { score: result.overallScore },
      });
    } catch {
      /* best-effort */
    }

    return {
      planTier,
      overallScore: result.overallScore,
      scores: result.scores,
      // What each factor actually read (or could not read) — so a number is
      // never presented without the evidence behind it.
      unassessedFactors: result.unassessedFactors,
      evidence: result.factorEvidence,
      recommendations: result.recommendations,
      visaSuggestions: result.visaSuggestions,
      escalate: result.escalate,
      escalationReason: result.escalationReason,
    };
  }

  async getLatest(db: SupabaseClient, applicationId: string, userId: string) {
    const { planTier } = await this.verifyOwnership(db, applicationId, userId);

    const { data: score } = await db
      .from('vri_scores')
      .select('*')
      .eq('application_id', applicationId)
      .order('calculated_at', { ascending: false })
      .limit(1)
      .single();

    if (!score)
      return {
        planTier,
        score: null,
        recommendations: [],
        visaSuggestions: [],
      };

    const [{ data: recommendations }, { data: visaSuggestions }] =
      await Promise.all([
        db
          .from('vri_recommendations')
          .select('*')
          .eq('vri_score_id', score.id)
          .order('priority', { ascending: false }),
        db
          .from('vri_visa_suggestions')
          .select('*')
          .eq('vri_score_id', score.id)
          .order('rank', { ascending: true }),
      ]);

    return {
      planTier,
      score,
      recommendations: recommendations ?? [],
      visaSuggestions: visaSuggestions ?? [],
    };
  }

  async applySuggestionToChecklist(
    db: SupabaseClient,
    applicationId: string,
    suggestionId: string,
    userId: string,
  ) {
    await this.verifyOwnership(db, applicationId, userId);

    const { data: suggestion } = await db
      .from('vri_visa_suggestions')
      .select(
        'id, visa_category, required_forms, required_documents, vri_score_id, vri_scores!inner(application_id)',
      )
      .eq('id', suggestionId)
      .single();

    if (!suggestion) throw new NotFoundException('Suggestion not found');
    // RLS already scopes by user, but double-check the suggestion belongs to this app
    // so a tampered URL can't paste another application's docs into this checklist.
    const linkedApp = (
      suggestion as unknown as { vri_scores: { application_id: string } }
    ).vri_scores.application_id;
    if (linkedApp !== applicationId)
      throw new ForbiddenException(
        'Suggestion does not belong to this application',
      );

    const visaCategory = (suggestion as { visa_category: string })
      .visa_category;
    const docs = (suggestion as { required_documents?: unknown })
      .required_documents;
    const rawForms = (suggestion as { required_forms?: unknown })
      .required_forms;

    const docLabels: string[] = Array.isArray(docs)
      ? docs
          .filter(
            (d): d is string => typeof d === 'string' && d.trim().length > 0,
          )
          .map((d) => d.trim())
      : [];

    const forms: Array<{
      form_code: string;
      form_name: string;
      source_url: string | null;
    }> = Array.isArray(rawForms)
      ? (rawForms as Array<Record<string, unknown>>).flatMap((f) => {
          const form_code =
            typeof f.form_code === 'string' ? f.form_code.trim() : '';
          const form_name =
            typeof f.form_name === 'string' ? f.form_name.trim() : '';
          if (!form_code && !form_name) return [];
          const source_url =
            typeof f.source_url === 'string' &&
            /^https?:\/\//i.test(f.source_url)
              ? f.source_url.trim()
              : null;
          return [
            {
              form_code: form_code || form_name,
              form_name: form_name || form_code,
              source_url,
            },
          ];
        })
      : [];

    if (docLabels.length === 0 && forms.length === 0)
      return { added: 0, skipped: 0, items: [] };

    const { data: existing } = await db
      .from('checklist_items')
      .select('document_type')
      .eq('application_id', applicationId);
    const existingTypes = new Set(
      (existing ?? [])
        .map((r) => r.document_type)
        .filter((t): t is string => !!t),
    );

    type Row = {
      document_type: string;
      label: string;
      reason: string;
      meta: Record<string, unknown>;
    };
    const rows: Row[] = [];
    const usedTypes = new Set<string>();
    const totalCandidates = docLabels.length + forms.length;

    function reserveType(base: string): string | null {
      let documentType = base;
      let suffix = 1;
      while (existingTypes.has(documentType) || usedTypes.has(documentType)) {
        suffix += 1;
        documentType = `${base}_${suffix}`;
        if (suffix > 50) return null;
      }
      usedTypes.add(documentType);
      return documentType;
    }

    // Forms first so they cluster at the top of the checklist.
    for (const form of forms) {
      const baseLabel =
        form.form_code && form.form_name && form.form_code !== form.form_name
          ? `Form ${form.form_code} — ${form.form_name}`
          : `Form ${form.form_code || form.form_name}`;
      const base = `form_${slugifyDocumentType(form.form_code || form.form_name)}`;
      const documentType = reserveType(base);
      if (!documentType) continue;
      rows.push({
        document_type: documentType,
        label: baseLabel,
        reason: `vri_form:${visaCategory}`,
        meta: {
          kind: 'form',
          form_code: form.form_code,
          form_name: form.form_name,
          source_url: form.source_url,
        },
      });
    }

    for (const label of docLabels) {
      const documentType = reserveType(slugifyDocumentType(label));
      if (!documentType) continue;
      rows.push({
        document_type: documentType,
        label,
        reason: `vri_suggestion:${visaCategory}`,
        meta: { kind: 'document' },
      });
    }

    if (rows.length === 0)
      return { added: 0, skipped: totalCandidates, items: [] };

    const { data: inserted, error } = await db
      .from('checklist_items')
      .insert(
        rows.map((r) => ({
          application_id: applicationId,
          document_type: r.document_type,
          label: r.label,
          required: true,
          status: 'missing' as const,
          added_reason: r.reason,
          meta: r.meta,
        })),
      )
      .select('id, document_type, label, status, added_reason, meta');

    if (error)
      throw new Error(`Failed to add suggested documents: ${error.message}`);

    return {
      added: inserted?.length ?? 0,
      skipped: totalCandidates - (inserted?.length ?? 0),
      items: inserted ?? [],
    };
  }
}

function slugifyDocumentType(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'document'
  );
}
