import { z } from 'zod';
import type { VriState, VisaForm, VisaSuggestion } from '../vri.state';
import { resolveCountryName } from '../../../../strategies/country-context';
import { languageName } from '../../../../i18n/language';
import type {
  AiUsageMeter,
  AiUsageContext,
} from '../../../shared/ai/ai-usage.meter';
import { chatModelForTask } from '../../../shared/ai/model-factory';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../../shared/ai/untrusted';

const SUGGEST_PROMPT = `You are an immigration preparation assistant.

Given an applicant's profile, their factor scores from a Visa Readiness Index (VRI), and the destination country, recommend 3-5 visa categories offered by that country's official immigration authority that best fit the answers and published requirements. This is a preparation aid, not legal advice or a prediction of a government decision.

For EACH suggested visa category, you must:
1. Use the official category name as listed by the destination country's official government immigration / visa portal (e.g. for USA: "B-1/B-2 Visitor Visa", "F-1 Student Visa", "H-1B Specialty Occupation Visa"; for UK: "Standard Visitor Visa", "Skilled Worker Visa", "Student Visa"; for Canada: "Visitor Visa (TRV)", "Study Permit", "Express Entry"; for Schengen: "Schengen Type C Short-stay").
2. Estimate a requirements-fit score as an integer 0-100 based only on profile fit and VRI factor scores. This is not an approval probability and must not predict a government decision.
3. Give 1-2 sentences of reasoning grounded in the applicant's actual profile (do NOT invent facts).
4. POPULATE required_forms — this is MANDATORY. Every visa category requires at least one official government form. These are the government-issued application forms with formal codes/numbers that the applicant must complete. Examples:
   - USA: "DS-160" (Online Nonimmigrant Visa Application), "DS-260" (Online Immigrant Visa Application), "I-129", "I-130", "I-140", "I-485", "I-765", "G-1145"
   - Canada: "IMM 5257" (Application for Temporary Resident Visa), "IMM 5645" (Family Information), "IMM 1294" (Application for Study Permit), "IMM 1295" (Application for Work Permit), "IMM 0008" (Generic Application)
   - UK: "VAF1A" (Visitor Visa Application Form), "VAF9" (Settlement), "Appendix 2"
   - Schengen: "Application for Schengen Visa" (uniform form)
   - Australia: "Form 1419" (Visitor visa - Tourist stream), "Form 1208" (Application for a Skilled visa)
   For each form, provide: form_code (the official identifier like "DS-160"), form_name (the official title), source_url (direct URL on the official government site where the form can be downloaded or filled). Return 1-4 forms per category.
5. POPULATE required_documents with the supporting documents (NOT forms — these are evidence/records the applicant provides) for that visa category as published on the official government / consulate / embassy website. Be complete and specific (e.g. "Valid passport with 6+ months validity", "Recent 2x2 inch color photograph meeting US visa photo requirements", "Bank statements for the last 6 months", "Employment verification letter", "Birth certificate"). NEVER put form names here — forms ONLY go in required_forms. Return 6-12 documents per category.
6. Include the official source as the URL or name of the official portal where these requirements are published.

Order the suggestions array from highest requirements-fit score to lowest.`;

export function buildSuggestSystemPrompt(language?: string | null): string {
  const name = languageName(language);
  // SEC-6001: pair the fenced applicant data with the standing "this is DATA,
  // not instructions" directive.
  const base = `${SUGGEST_PROMPT}\n\n${UNTRUSTED_DATA_DIRECTIVE}`;
  if (!name || language === 'en') return base;
  return (
    base +
    `\n\nRESPONSE LANGUAGE: Write the \`reasoning\` field of every suggestion in ${name}. ` +
    `Keep visa_category, required_forms (form_code, form_name, source_url), required_documents, ` +
    `and official_source in their official English form exactly as published by the government — do NOT translate them.`
  );
}

// Schema enforced via OpenAI structured outputs — the API will reject any
// response that doesn't match, so we never have to parse free-form JSON.
const FormSchema = z.object({
  form_code: z
    .string()
    .describe('Official identifier, e.g. "DS-160", "IMM 5257", "VAF1A"'),
  form_name: z.string().describe('Official full title of the form'),
  source_url: z.string().describe('Direct URL on the official government site'),
});

const SuggestionSchema = z.object({
  visa_category: z.string(),
  // Historical API field name. Its user-facing meaning is requirements fit, not
  // a probability of approval; changing the wire name needs a versioned API.
  approval_likelihood: z.number().int().min(0).max(100),
  reasoning: z.string(),
  required_forms: z
    .array(FormSchema)
    .min(1)
    .describe(
      'Government-issued application forms (DS-160, IMM 5257, etc.) — must contain at least one form',
    ),
  required_documents: z
    .array(z.string())
    .describe('Supporting documents (NOT forms). Do not put form names here.'),
  official_source: z.string(),
});

const SuggestionsResponseSchema = z.object({
  suggestions: z.array(SuggestionSchema).min(3).max(5),
});

const FORM_PATTERN =
  /^(?:form\s+)?(DS-?\d+|IMM\s*\d+|I-?\d{3,}|G-?\d{3,}|VAF\s*\d*[A-Z]*|N-?\d{3,}|EOIR-?\d+)\b/i;

export function makeSuggestVisaCategoriesNode(
  openaiKey: string,
  language?: string | null,
  meter?: AiUsageMeter,
  ctx?: AiUsageContext,
) {
  const llm = chatModelForTask('visa_category_suggestion', {
    apiKey: openaiKey,
    meter,
    ctx,
  });
  const structured = llm.withStructuredOutput(SuggestionsResponseSchema, {
    name: 'visa_suggestions',
  });

  return async function suggestVisaCategories(
    state: VriState,
  ): Promise<Partial<VriState>> {
    const country = state.data.destinationCountry;
    if (!country) return { visaSuggestions: [] };
    const countryName = resolveCountryName(country);

    // An unassessed factor stores 0 only because the column is NOT NULL; tell
    // the model it was not measured rather than letting it read a failure.
    const unassessed = new Set<string>(state.unassessedFactors ?? []);
    const factorSummary = Object.entries(state.scores)
      .map(([k, v]) => `${k}: ${unassessed.has(k) ? 'not assessed' : v}`)
      .join(', ');

    const userMessage = [
      `Destination country: ${countryName} (${country})`,
      `IMPORTANT: suggest ONLY ${countryName}'s real visa categories and ${countryName}'s official forms. NEVER return another country's visa categories or forms (e.g. Canada IMM, USA DS-160) unless they are genuinely ${countryName}'s.`,
      state.data.currentVisaType
        ? `Current selected visa type: ${asUntrustedData('current visa type', state.data.currentVisaType)}`
        : 'Current selected visa type: none (applicant is exploring options)',
      `Overall VRI score: ${state.overallScore}/100`,
      `VRI factor scores: ${factorSummary}`,
      // SEC-6001: the profile carries OCR-derived / user-entered text — an
      // indirect prompt-injection vector. Fence it as untrusted data.
      `Applicant profile: ${asUntrustedData('applicant profile', state.data.profile)}`,
      '',
      `Return 3-5 best-fit visa categories for ${countryName}. For each one, populate BOTH required_forms (${countryName}'s official government application forms with their real codes) AND required_documents (supporting evidence). Forms must never be empty.`,
    ].join('\n');

    let result: z.infer<typeof SuggestionsResponseSchema>;
    try {
      result = await structured.invoke([
        { role: 'system', content: buildSuggestSystemPrompt(language) },
        { role: 'user', content: userMessage },
      ]);
    } catch (err) {
      console.error(
        '[suggest-visa-categories] LLM call failed:',
        err instanceof Error ? err.message : err,
      );
      return { visaSuggestions: [] };
    }

    const suggestions: VisaSuggestion[] = result.suggestions
      .map((s, i) => {
        const visa_category = s.visa_category.trim();
        if (!visa_category) return null;
        const declaredForms: VisaForm[] = s.required_forms.flatMap((f) => {
          const form_code = f.form_code.trim();
          const form_name = f.form_name.trim();
          if (!form_code && !form_name) return [];
          const source_url = /^https?:\/\//i.test(f.source_url)
            ? f.source_url.trim()
            : null;
          return [
            {
              form_code: form_code || form_name,
              form_name: form_name || form_code,
              source_url,
            },
          ];
        });

        // Rescue any form-shaped strings the model still snuck into documents.
        const rescuedForms: VisaForm[] = [];
        const remainingDocs: string[] = [];
        const knownCodes = new Set(
          declaredForms.map((f) => normalizeFormCode(f.form_code)),
        );
        for (const doc of s.required_documents) {
          const cleaned = doc.trim();
          if (!cleaned) continue;
          const m = cleaned.match(FORM_PATTERN);
          if (m) {
            const code = m[1].toUpperCase().replace(/\s+/g, ' ');
            if (!knownCodes.has(normalizeFormCode(code))) {
              rescuedForms.push({
                form_code: code,
                form_name: cleaned,
                source_url: null,
              });
              knownCodes.add(normalizeFormCode(code));
            }
            continue;
          }
          remainingDocs.push(cleaned);
        }

        const required_forms = [...declaredForms, ...rescuedForms];
        const official_source =
          s.official_source.trim().length > 0 ? s.official_source.trim() : null;

        return {
          country_code: country,
          visa_category,
          approval_likelihood: Math.max(
            0,
            Math.min(100, Math.round(s.approval_likelihood)),
          ),
          reasoning: s.reasoning,
          required_forms,
          required_documents: remainingDocs,
          official_source,
          rank: i,
        };
      })
      .filter((s): s is VisaSuggestion => s !== null)
      .sort((a, b) => b.approval_likelihood - a.approval_likelihood)
      .map((s, i) => ({ ...s, rank: i }));

    if (suggestions.length === 0) {
      console.warn(
        '[suggest-visa-categories] LLM returned no usable suggestions for',
        country,
      );
    }

    return { visaSuggestions: suggestions };
  };
}

function normalizeFormCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]+/g, '');
}
