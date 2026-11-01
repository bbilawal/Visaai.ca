import { SupabaseClient } from '@supabase/supabase-js';
import type { VriState } from '../vri.state';

/**
 * @param supabase the caller's RLS-scoped client. Writes the per-score rows
 *   (vri_scores / vri_recommendations / vri_visa_suggestions), which RLS
 *   allows the owner to insert.
 * @param admin the service-role client. Used for EXACTLY ONE write: the
 *   denormalised applications.vri_score / escalation flag. SEC-4094 pins
 *   vri_score against owner writes (it is system-controlled), so the user
 *   client cannot set it. Ownership has already been verified by
 *   VriService.calculate before the graph runs; the update is still scoped to
 *   the application id AND its owner as defence in depth.
 * @param userId the verified owner of `state.applicationId`.
 */
export function makeSaveVriNode(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  userId: string,
) {
  return async function saveVri(state: VriState): Promise<Partial<VriState>> {
    const { data: scoreRow, error } = await supabase
      .from('vri_scores')
      .insert({
        application_id: state.applicationId,
        overall_score: state.overallScore,
        documentation_pct: state.scores.documentation_pct,
        financial_pct: state.scores.financial_pct,
        travel_history_pct: state.scores.travel_history_pct,
        home_ties_pct: state.scores.home_ties_pct,
        employment_pct: state.scores.employment_pct,
        consistency_pct: state.scores.consistency_pct,
        // FAKE-003: persist WHICH factors were never assessed.
        //
        // The columns above are `int not null`, so an unassessed factor still
        // has to store a number. It stores 0, and the readiness UI would render
        // that as "0% · Weak" — a failure the applicant never actually had, the
        // mirror image of the original bug where an unrun consistency check
        // reported 100%. Neither number is true; only this array is.
        //
        // The aggregate already excludes these factors and renormalises the
        // remaining weights, so the overall score is unaffected either way.
        // This exists purely so the UI can say "Not assessed" instead of
        // inventing a percentage.
        unassessed_factors: state.unassessedFactors?.length
          ? state.unassessedFactors
          : null,
        escalated: state.escalate,
        escalation_reason: state.escalationReason,
      })
      .select('id')
      .single();

    if (error || !scoreRow)
      throw new Error(`Failed to save VRI score: ${error?.message}`);

    // Everything below must land or the score row must go. Before this, a
    // failure here (e.g. the SEC-4094 trigger) left an orphan vri_scores row
    // that GET /vri/:id served as the latest result for a calculate that had
    // returned a 500. Deleting the score row cascades to its recommendations
    // and suggestions.
    try {
      if (state.recommendations.length > 0) {
        const { error: recErr } = await supabase
          .from('vri_recommendations')
          .insert(
            state.recommendations.map((r) => ({
              vri_score_id: scoreRow.id,
              factor: r.factor,
              issue: r.issue,
              recommendation_text: r.recommendation_text,
              priority: r.priority,
            })),
          );
        if (recErr)
          throw new Error(
            `Failed to save VRI recommendations: ${recErr.message}`,
          );
      }

      if (state.visaSuggestions.length > 0) {
        const { error: suggestErr } = await supabase
          .from('vri_visa_suggestions')
          .insert(
            state.visaSuggestions.map((s) => ({
              vri_score_id: scoreRow.id,
              country_code: s.country_code,
              visa_category: s.visa_category,
              approval_likelihood: s.approval_likelihood,
              reasoning: s.reasoning,
              required_forms: s.required_forms,
              required_documents: s.required_documents,
              official_source: s.official_source,
              rank: s.rank,
            })),
          );
        if (suggestErr)
          throw new Error(
            `Failed to save VRI visa suggestions: ${suggestErr.message}`,
          );
      }

      // Denormalize the score AND the actionable escalation flag onto the application
      // (mirrors the existing vri_score denormalization). The consultant flow reads
      // `needs_consultant_escalation` to pick up low-readiness cases — see the
      // one-line AssignmentService wiring documented in vri.service.ts.
      // SEC-4094: service-role write, scoped to this one application + owner.
      const { data: updated, error: updateErr } = await admin
        .from('applications')
        .update({
          vri_score: state.overallScore,
          needs_consultant_escalation: state.escalate,
          escalation_reason: state.escalationReason,
        })
        .eq('id', state.applicationId)
        .eq('user_id', userId)
        .select('id');
      if (updateErr)
        throw new Error(
          `Failed to update application VRI score: ${updateErr.message}`,
        );
      if (!Array.isArray(updated) || updated.length === 0)
        throw new Error(
          'Failed to update application VRI score: no application row matched the verified owner',
        );
    } catch (err) {
      const { error: cleanupErr } = await supabase
        .from('vri_scores')
        .delete()
        .eq('id', scoreRow.id);
      if (cleanupErr) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `${msg} (and failed to remove partial VRI score ${scoreRow.id}: ${cleanupErr.message})`,
        );
      }
      throw err;
    }

    return {};
  };
}
