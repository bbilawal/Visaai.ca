import { mergePersonFields } from './store-prefill';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { routeFormQuestionKeys } from '@visaai/types';
import type { PrefilledFormField } from '@visaai/types';
import type { PrefillState } from '../prefill.state';
import { finalizeFields } from './finalize-fields';
import { languageName } from '../../../../i18n/language';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../../shared/ai/untrusted';

const SYSTEM_PROMPT = `You are VisaAI, an expert immigration assistant.

Your task: given an applicant's profile + extracted document data + the visa they are applying for, produce the COMPLETE set of fields a typical official visa application form for that country and visa type asks for, pre-filled from the supplied data.

Rules:
- Cover ALL standard sections an official form for this visa would request: personal info, identity documents, contact, address, family/marital, employment/education, travel/purpose, financial, immigration history.
- Use ONLY the supplied profile + document data for values. If a field is genuinely unknown, set value to "" (empty string) so the user can fill it in during review.
- NEVER fabricate passport numbers, dates, addresses, employer names, or any other factual data.
- Format dates as YYYY-MM-DD. When the data gives only a month ("2012-06") or only a year, copy it as given (YYYY-MM or YYYY) — never leave such a date empty and never invent a day. Format currency as plain numbers (no symbols). Use ISO country names.
- Use clear, human-readable labels (e.g. "Date of birth", not "dob").
- Group related fields with the "group" key (e.g. "Personal", "Passport", "Travel", "Employment", "Financial", "Family", "Contact").
- Set "source" to "profile" if pulled from the intake profile or the applicant's account details, "document" if from extracted documents, or "inferred" if reasonably derived.
- The account details block holds contact and identity the applicant typed into their profile: USE IT for the Contact and Address sections rather than leaving them blank.
- Use snake_case keys (e.g. "given_name", "family_name", "passport_number") that map cleanly to portal form selectors.
- Do NOT suggest the user consult a lawyer or immigration professional.
- WHOSE DOCUMENT: the applicant is the person named on the passport. Documents are supplied in two blocks — the applicant's own, and documents that are NOT the applicant's (a host's invitation, a sponsor's employment letter / bank statement / pay stub / tax slip, or a financial document that names nobody). You must never use a value from the non-applicant block to fill an applicant field (applicant job title, occupation, employer, employment dates, income, bank balance, name, dates of birth). Those values may only fill sponsor/host/family-member fields (e.g. "sponsor_employer_name", "host_status").
- A signatory on a letter (HR officer, manager) is not the employee — never use a signatory's title as anybody's job title.
- Do not reinterpret income periods: a figure labelled monthly in extraction may be annual. Copy it only onto a field for the same person and leave the period as stated.
- If the profile says the applicant is retired, the applicant's occupation is "Retired" and current employer, employment start date and employment income stay "".
- Duration of stay: when planned entry and departure dates are both known, derive the number of days from them (inclusive); dates win over a stated number.

${UNTRUSTED_DATA_DIRECTIVE}

Return ONLY a JSON array of objects, no prose, no markdown fences. Each object has: {"key": string, "label": string, "value": string, "group": string, "source": "profile" | "document" | "inferred"}.`;

/**
 * Scoped language directive for prefilled portal fields. Only the human-readable
 * `label` and `group` (display text) are translated. `key` (snake_case portal
 * selectors), `value` (passport numbers, dates, names going INTO a government
 * form), and `source` MUST stay machine/original — translating them would
 * corrupt the auto-fill. Returns '' for en/null (no change).
 */
function prefillLanguageDirective(language?: string | null): string {
  const name = languageName(language);
  if (!name || language === 'en') return '';
  return (
    `\n\nRESPONSE LANGUAGE: Write the \`label\` and \`group\` fields in ${name}. ` +
    `Keep \`key\`, \`value\`, and \`source\` exactly as specified — never ` +
    `translate keys, values, dates, names, or identifiers.`
  );
}

export function makeGenerateFieldsNode(
  llm: ChatOpenAI,
  language?: string | null,
) {
  return async function generateFields(
    state: PrefillState,
  ): Promise<Partial<PrefillState>> {
    const { context } = state;

    const userPrompt = `Visa being applied for:
- Country: ${context.countryCode || 'unknown'}
- Visa type: ${context.visaType || 'unknown'}
- Purpose: ${context.purpose || 'unknown'}

${asUntrustedData('Account details the applicant already gave us (name, nationality, phone, postal address)', context.accountProfile ?? {})}

${asUntrustedData('Applicant profile (from intake)', context.profile)}

Applicant (as named on the passport): ${context.applicantName || 'unknown'}

${asUntrustedData("The APPLICANT's own documents (merged)", context.documentFields)}

Grouped by the document each value came from — use it to tell which document supports which value (a balance from a bank statement, a course start date from an admission letter, parents' names from a birth certificate):
${asUntrustedData("The APPLICANT's own documents by document type", context.documentFieldsByType ?? {})}

${asUntrustedData("Documents that are NOT the applicant's (sponsor / host / third party / unnamed financial) — sponsor or host fields only, never applicant fields", context.otherPartyDocuments ?? [])}

${routeKeysDirective(context.countryCode, context.visaaiId ?? null)}Generate the prefilled form fields now.`;

    const response = await llm.invoke([
      new SystemMessage(SYSTEM_PROMPT + prefillLanguageDirective(language)),
      new HumanMessage(userPrompt),
    ]);

    const raw =
      typeof response.content === 'string'
        ? response.content
        : (response.content[0] as { text: string }).text;

    const parsed = parseFields(raw);
    // An empty list is a failed generation, not an empty form. Returning it
    // would let store_prefill replace the applicant's existing draft (and
    // their saved edits) with nothing, and report success.
    if (parsed.length === 0) {
      throw new Error(
        'The form generator returned no form fields. Your existing draft was kept — try Regenerate again.',
      );
    }

    // Start from what people already entered, so the IRCC questions step
    // sees the applicant's typed answers (father's name → father questions).
    const fields = finalizeFields(
      mergePersonFields(parsed, context.personFields ?? []),
      {
        applicantName: context.applicantName ?? null,
        profile: context.profile,
        documentFields: context.documentFields,
        documentFieldsByType: context.documentFieldsByType ?? {},
        otherPartyDocuments: context.otherPartyDocuments ?? [],
        accountProfile: context.accountProfile ?? {},
        insurancePolicies: context.insurancePolicies ?? [],
        route: {
          country: context.countryCode,
          visaaiId: context.visaaiId ?? null,
        },
      },
    );
    return { fields };
  };
}

/**
 * Parse the model's JSON array of fields.
 *
 * A long form can exhaust the output budget, which cuts the array off
 * mid-object (prod 2026-10-14: output_tokens == maxOutputTokens, 102 fields
 * lost). Rather than `JSON.parse` the whole thing — which turns one missing
 * `]` into zero fields — walk the array and keep every object that closed.
 */
export function parseFields(raw: string): PrefilledFormField[] {
  return completeObjects(raw)
    .map(
      (f): PrefilledFormField => ({
        key: String(f.key ?? ''),
        label: String(f.label ?? f.key ?? ''),
        value: f.value == null ? '' : String(f.value),
        group: f.group ? String(f.group) : undefined,
        source:
          f.source === 'document' || f.source === 'inferred'
            ? f.source
            : 'profile',
      }),
    )
    .filter((f) => f.key);
}

/** Top-level objects of the first JSON array in `raw`, string-aware. */
function completeObjects(raw: string): Record<string, unknown>[] {
  const start = raw.indexOf('[');
  if (start < 0) return [];
  const out: Record<string, unknown>[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          const obj = JSON.parse(raw.slice(objStart, i + 1)) as unknown;
          if (obj && typeof obj === 'object' && !Array.isArray(obj))
            out.push(obj as Record<string, unknown>);
        } catch {
          // a malformed object is skipped, not fatal to its neighbours
        }
        objStart = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }
  return out;
}

/**
 * On a route that asks its questions on the Forms page, the generator is
 * told their keys so it does not invent a second key for the same question
 * (live E2E 2026-10-30: employer_name beside work_employer_name). Empty on
 * every other route.
 */
export function routeKeysDirective(
  country: string | null | undefined,
  visaaiId: string | null,
): string {
  const qs = routeFormQuestionKeys({ country: country ?? '', visaaiId });
  if (qs.length === 0) return '';
  return (
    'For any field that is one of these questions, use exactly this key (the label is for you; keep your own clear label). Do not add a field just because it is listed:\n' +
    qs.map((q) => `- ${q.key}: ${q.label}`).join('\n') +
    '\n\n'
  );
}
