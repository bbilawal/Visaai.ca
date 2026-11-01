import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import type { NarrativeState } from '../narrative.state';
import {
  familyTiesDirective,
  routeDirective,
  stayDirective,
} from './draft-document';
import { evidenceDirective } from './document-evidence';
import { languageDirective } from '../../../../i18n/language';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../../shared/ai/untrusted';

const MAX_REVISIONS = 5;
const logger = new Logger('NarrativeSelfReview');

const REVIEW_PROMPT = `You are a strict immigration document reviewer. Review the draft for:
1. Consistency with the applicant profile (no invented facts)
2. Professional tone appropriate for a visa officer
3. Completeness for its document type
4. No commentary addressed to the applicant (e.g. "Here is the letter", "Note: ...", offers to edit) — the text must be only the document
5. Any length of stay matches the authoritative trip dates, when given
6. Any route-specific facts and rules given below are followed exactly (who writes the letter, the figures, what it must contain)
Respond with ONLY a JSON object: {"approved": boolean, "critique": "specific feedback if not approved, empty string if approved"}

${UNTRUSTED_DATA_DIRECTIVE}`;

/**
 * Parse + validate the reviewer's JSON. Returns null on anything that isn't a
 * well-formed object with a boolean `approved` — the caller treats null as
 * "not reviewed" (fail-closed) rather than silently approving.
 */
function parseReview(
  raw: string,
): { approved: boolean; critique: string } | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    if (typeof obj.approved !== 'boolean') return null;
    return {
      approved: obj.approved,
      critique: typeof obj.critique === 'string' ? obj.critique : '',
    };
  } catch {
    return null;
  }
}

export function makeSelfReviewNode(llm: ChatOpenAI, language?: string | null) {
  // The `critique` text is fed back into the draft node to rewrite the document,
  // so it must be in the user's language to keep the rewrite in-language. The
  // `approved` boolean is structural and unaffected by the directive.
  return async function selfReview(
    state: NarrativeState,
  ): Promise<Partial<NarrativeState>> {
    // FAIL CLOSED at the revision cap. Previously this returned
    // `{approved: true}`, silently stamping a non-converging draft as reviewer-
    // approved. Instead, terminate the loop by escalating for human review — the
    // draft is never presented as machine-approved.
    if (state.revisionCount >= MAX_REVISIONS) {
      logger.warn(
        `application ${state.applicationId} (${state.docType}): auto-review did not converge in ${MAX_REVISIONS} revisions — escalating for human review`,
      );
      return {
        approved: false,
        needsHumanReview: true,
        critique: `Automated review did not converge after ${MAX_REVISIONS} revisions; flagged for human review.`,
      };
    }

    const response = await llm.invoke([
      new SystemMessage(REVIEW_PROMPT + languageDirective(language)),
      new HumanMessage(
        `Document type: ${state.docType}\n\n${asUntrustedData(
          'Applicant profile',
          state.context.profile,
        )}${stayDirective(state.context)}${routeDirective(state.context, state.docType)}${familyTiesDirective(state.context, state.docType)}${evidenceDirective(state.context.evidence)}\n\n${asUntrustedData('Draft document', state.draft)}\n\nReview as JSON:`,
      ),
    ]);

    const raw =
      typeof response.content === 'string'
        ? response.content
        : ((response.content[0] as { text?: string } | undefined)?.text ?? '');

    const parsed = parseReview(raw);

    // FAIL CLOSED on unreadable reviewer output. Previously this defaulted to
    // `{approved: true}`. Now we do NOT approve; we route back for another
    // drafting attempt (the revision cap above bounds the loop and escalates if
    // the reviewer stays broken).
    if (!parsed) {
      logger.warn(
        `application ${state.applicationId} (${state.docType}): unreadable self-review output — not approving`,
      );
      return {
        approved: false,
        needsHumanReview: false,
        critique:
          'Automated reviewer returned unreadable output; regenerating the draft.',
      };
    }

    return {
      approved: parsed.approved,
      needsHumanReview: false,
      critique: parsed.approved ? '' : parsed.critique,
    };
  };
}

export function reviewRouter(state: NarrativeState): 'draft' | 'finalize' {
  // Terminate on genuine approval OR on escalation; only loop back to draft when
  // the draft was rejected with actionable critique and we're under the cap.
  return state.approved || state.needsHumanReview ? 'finalize' : 'draft';
}
