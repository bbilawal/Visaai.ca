import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { NarrativeState, DocType } from '../narrative.state';
import { resolveCountryName } from '../../../../strategies/country-context';
import { languageDirective } from '../../../../i18n/language';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../../shared/ai/untrusted';
import { stripMetaCommentary } from './strip-meta';
import { restoreIdentifiers } from './restore-identifiers';
import type { NarrativeContext } from '../narrative.state';

const DOC_INSTRUCTIONS: Record<DocType, string> = {
  loe: `Write a Letter of Explanation (LOE) for a visa application. Address the visa officer professionally.
Explain the applicant's purpose of travel, ties to their home country, financial capacity, and intent to return.
Keep it factual, concise (3-4 paragraphs), and based ONLY on the provided profile data. Never invent facts.`,
  itinerary: `Write a realistic travel itinerary for a visa application. Include arrival, planned activities aligned with the stated purpose,
accommodation approach, and departure. Format as a day-by-day or phase-by-phase plan. Base duration and activities ONLY on the provided profile.`,
  cover_letter: `Write a visa application cover letter summarizing the submission. List the purpose, key supporting documents,
and a brief statement of the applicant's eligibility. Keep it professional and under one page. Base it ONLY on the provided profile.`,
};

const OUTPUT_RULES = `Output ONLY the document itself, exactly as the visa officer will read it, in clean markdown.
Never address the applicant or talk about the document: never write "Here is", "Below is", "Sure", "Certainly", "I have drafted", and never add a "Note:", disclaimer, tip, placeholder explanation, or offer to make changes before or after the document.
Do not use markdown tables; use headings, short paragraphs and lists.`;

/** The authoritative trip length line, or '' when the dates are unknown. */
export function stayDirective(ctx: NarrativeContext): string {
  const s = ctx.stay;
  if (!s) return '';
  return `\n\nTrip dates (authoritative): entering ${s.entryDate}, departing ${s.departureDate} — a stay of ${s.days} days (counting both the entry and the departure day). Whenever the length of stay is mentioned, use exactly ${s.days} days and these dates; never use any other figure from the profile.`;
}

// Spec: these generated documents are written in the user's selected language.
// They are read by visa officers, so officer-language output may become a future
// product toggle; until then we honour the user's preference. Official form codes
// (DS-160, IMM 5257, etc.) stay untranslated — languageDirective enforces this.
export function makeDraftDocumentNode(
  llm: ChatOpenAI,
  language?: string | null,
) {
  return async function draftDocument(
    state: NarrativeState,
  ): Promise<Partial<NarrativeState>> {
    const instruction = DOC_INSTRUCTIONS[state.docType];

    const revisionNote = state.critique
      ? `\n\nA reviewer critiqued the previous draft. Address this feedback:\n${state.critique}\n\nPrevious draft:\n${state.draft}`
      : '';

    const response = await llm.invoke([
      new SystemMessage(
        `You are an expert immigration document writer. ${OUTPUT_RULES}\n\n${UNTRUSTED_DATA_DIRECTIVE}\n\n${instruction}${languageDirective(language)}`,
      ),
      new HumanMessage(
        `Destination country: ${resolveCountryName(state.context.countryCode)} (${state.context.countryCode})\nVisa: ${state.context.visaType} (${state.context.purpose})\n\n${asUntrustedData('Applicant profile', state.context.profile)}${stayDirective(state.context)}${revisionNote}\n\nWrite the document for the destination country above:`,
      ),
    ]);

    const raw =
      typeof response.content === 'string'
        ? response.content
        : ((response.content[0] as { text?: string } | undefined)?.text ?? '');
    const draft = restoreIdentifiers(
      stripMetaCommentary(raw),
      (state.context.profile ?? {}) as Record<string, unknown>,
    );

    return { draft, revisionCount: state.revisionCount + 1 };
  };
}
