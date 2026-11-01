import { SupabaseClient } from '@supabase/supabase-js';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { IntakeState, ChecklistItemSnapshot } from '../intake.state';
import {
  resolveCountryName,
  isForeignForm,
} from '../../../../strategies/country-context';
import { languageName } from '../../../../i18n/language';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../../shared/ai/untrusted';
import { isFamilyGapItem } from '../../../documents/family-gaps/family-gaps';
import { strategyRegistry } from '../../../../strategies';
import { routeVisaaiId } from './check-complete';
import { syncFamilyGapsForApplication } from '../../../documents/family-gaps/family-gaps.sync';
import { linkOrphanDocuments } from '../../../documents/slot-link';
import { preparedFormNote } from '../../../../strategies/form-mapping/prepared-forms';
import {
  planRegistryReconcile,
  sourcedDocumentMeta,
} from './registry-reconcile';

/**
 * The slice of AiCacheService this node needs.
 *
 * A structural type rather than the class: the node is built by a factory that
 * tests call directly with hand-made stubs, and importing the Nest service
 * would drag its Redis config into every one of them.
 */
export interface AiCacheLike {
  get(parts: {
    task: 'intake_checklist_discovery';
    input: string;
  }): Promise<string | null>;
  set(
    parts: { task: 'intake_checklist_discovery'; input: string },
    value: string,
  ): Promise<void>;
}

type Owner = 'applicant' | 'sponsor';

interface BranchRule {
  condition: { question: string; answer: boolean | string | number };
  add: Array<{
    type: string;
    label: string;
    owner?: Owner;
    specs?: Record<string, string>;
  }>;
}

/** Drop empty-string spec fields so meta only carries real requirements. */
function compactSpecs(
  specs?: Record<string, string> | null,
): Record<string, string> | undefined {
  if (!specs) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

interface PendingAdd {
  document_type: string;
  label: string;
  added_reason: string;
  meta: Record<string, unknown>;
  required?: boolean;
}

const DISCOVERY_PROMPT = `You are an expert immigration assistant. Given a visa applicant's destination country and the partial profile gathered so far, suggest what they will need to file: official government FORMS first (e.g. DS-160, IMM 5257, VAF1A) and supporting DOCUMENTS (passport, bank statements, etc.). Base both on the destination country's official immigration website.

Every item must be tagged with an "owner":
- "applicant" — the person who is travelling / applying for the visa.
- "sponsor" — a separate party who supports the application: a financial sponsor, host, inviting relative, spouse/partner petitioner, employer, or educational institution.
Only emit "sponsor" items when the visa type or profile clearly implies a sponsor exists — e.g. spouse/partner/family visas, family sponsorship, a student with a financial sponsor, a visitor with an inviting host, or a work visa with an employer. For a self-funded tourist with no host, EVERYTHING is "applicant". Never invent a sponsor the profile does not support. Sponsors may have their own forms (e.g. USA I-864 Affidavit of Support, Canada IMM 5645) and their own documents (sponsor bank statements, invitation letter, proof of relationship, employment letter).

Rules for required_forms (government application forms with formal codes/numbers):
- USA examples: "DS-160" (Online Nonimmigrant Visa Application), "DS-260", "I-129", "I-130", "I-140", "I-485", "I-765", "G-1145", "I-864" (sponsor Affidavit of Support)
- Canada examples: "IMM 5257" (Application for Temporary Resident Visa), "IMM 5645" (Family Information), "IMM 1294" (Study Permit), "IMM 1295" (Work Permit), "IMM 0008" (Generic)
- UK examples: "VAF1A" (Visitor Visa), "VAF9" (Settlement), "Appendix 2"
- Schengen example: "Application for Schengen Visa"
- Australia examples: "Form 1419" (Tourist), "Form 1208" (Skilled)
- For each: provide form_code (official identifier), form_name (official title), source_url (direct URL on the official government site where the form is downloaded or filled), owner.
- Suggest 1-3 forms relevant to what we already know about the applicant.

Rules for required_documents (supporting evidence, NOT forms):
- type: stable lowercase snake_case (e.g. "passport", "passport_biographic_page", "passport_photo", "bank_statement_3mo", "employment_letter", "pay_stubs", "tax_return", "invitation_letter", "travel_itinerary", "hotel_booking", "i20", "admission_letter", "marriage_certificate", "birth_certificate", "police_clearance", "medical_exam", "biometrics_receipt"). Prefix sponsor docs to keep them distinct, e.g. "sponsor_bank_statement_3mo", "sponsor_employment_letter", "sponsor_passport".
- label: short human-readable name.
- reason: one short phrase justifying why this applicant needs it.
- owner: "applicant" or "sponsor".
- specs: the destination country's OFFICIAL preparation requirements for this document. Fill each field when applicable, else use an empty string:
  - format: accepted file format / medium, e.g. "Color scan, PDF or JPG".
  - dimensions: physical or photo size, e.g. "35 × 45 mm, face 70-80% of frame".
  - file_requirements: digital constraints, e.g. "Max 5 MB, min 600×600 px, 300 DPI".
  - validity: recency / validity rule, e.g. "Issued within the last 6 months", "Valid 6+ months beyond travel".
  - notes: any other key requirement, e.g. "White background, no glasses", "All pages including blanks".
- Only include documents clearly justified by what we know. Do not speculate.
- NEVER put form names here. Forms go in required_forms.

Rules for strengthening_documents (OPTIONAL evidence + EVIDENCE SOURCES that make the case stronger, not officially required):
- These are concrete pieces of evidence that improve approval odds by addressing the officer's main concerns (ties to home country, sufficient funds, genuine purpose, credibility). Examples: property deeds / land ownership, prior travel history (old visas + stamps), additional savings or fixed deposits, employer tenure / promotion letter, business ownership proof, family ties evidence (marriage/birth certs of dependents staying home), sponsor's strong-tie evidence, return flight reservation, leave-approval letter, evidence of a previous compliant visa.
- For EACH item, specs.source MUST say WHERE/HOW the applicant obtains that evidence (e.g. "Land registry / municipal office", "Your bank — ask for a 6-month stamped statement", "Employer HR — letter on company letterhead", "Airline / travel agent — refundable reservation"). This is the key value: tell them the source.
- Same shape as required_documents (type, label, reason, owner, specs). Prefix sponsor items with "sponsor_".
- reason: phrase it as how it strengthens the case, e.g. "shows strong home ties so officer trusts you'll return".
- Suggest 2-6, tailored to this applicant's apparent risk profile. Do NOT duplicate anything already required or already in the existing list — each run should propose NEW strengthening evidence/sources only.

Global rules:
- Do NOT include items already in the "existing" list.
- Cap each array at the limits stated.
- If you genuinely have nothing new to add for a category, return an empty array for that category.`;

const OwnerSchema = z
  .enum(['applicant', 'sponsor'])
  .describe(
    'Who is responsible for this item: the visa applicant or their sponsor/host',
  );

const SpecsSchema = z.object({
  format: z
    .string()
    .describe('Accepted file format / medium. Empty string if not applicable.'),
  dimensions: z
    .string()
    .describe('Physical or photo dimensions. Empty string if not applicable.'),
  file_requirements: z
    .string()
    .describe('Digital file constraints. Empty string if not applicable.'),
  validity: z
    .string()
    .describe('Recency / validity rule. Empty string if not applicable.'),
  source: z
    .string()
    .describe(
      'WHERE/HOW to obtain this evidence, e.g. "Land registry office", "Your bank — request a stamped statement", "Employer HR". Empty string if obvious.',
    ),
  notes: z
    .string()
    .describe('Any other key requirement. Empty string if none.'),
});

const FormSchema = z.object({
  form_code: z.string().describe('Official identifier, e.g. DS-160'),
  form_name: z.string().describe('Official full title of the form'),
  source_url: z.string().describe('Direct URL on the official government site'),
  owner: OwnerSchema,
});

const DocSchema = z.object({
  type: z.string().describe('snake_case identifier'),
  label: z.string().describe('Short human label'),
  reason: z.string().describe('One short phrase justifying the doc'),
  owner: OwnerSchema,
  specs: SpecsSchema,
});

const DiscoverySchema = z.object({
  required_forms: z.array(FormSchema).max(3),
  required_documents: z.array(DocSchema).max(10),
  strengthening_documents: z.array(DocSchema).max(6),
});

/**
 * The discovery answer as it looks MID-STREAM: every field optional, because a
 * chunk is a JSON document that is still being written.
 */
type PartialDiscovery = {
  required_forms?: Array<Partial<z.infer<typeof FormSchema>>>;
  required_documents?: Array<Partial<z.infer<typeof DocSchema>>>;
  strengthening_documents?: Array<Partial<z.infer<typeof DocSchema>>>;
};

/**
 * Drop the element the model is still writing.
 *
 * An array element is only known to be FINISHED once a later element has
 * begun — until then its label may be "Proof of fun" on its way to "Proof of
 * funds", and showing that to an applicant is worse than showing nothing. So
 * while the stream is open, the last element of each group is withheld; when it
 * closes, `final` lets everything through.
 */
export function completedItemsOnly(
  result: PartialDiscovery,
  final: boolean,
): PartialDiscovery {
  if (final) return result;
  const trim = <T>(xs: T[] | undefined): T[] =>
    xs && xs.length > 1 ? xs.slice(0, -1) : [];
  return {
    required_forms: trim(result.required_forms),
    required_documents: trim(result.required_documents),
    strengthening_documents: trim(result.strengthening_documents),
  };
}

/** Called with each newly-completed batch of items while the model streams. */
export type DiscoveryProgress = (items: PendingAdd[]) => void | Promise<void>;

/** The form's guidance plus, for a form VisaAI prepares, where to get it. */
function withPreparedNote(
  formCode: string,
  specs: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const prepared = preparedFormNote(formCode);
  if (!prepared) return specs;
  return { ...(specs ?? {}), visaai: prepared };
}

export function makeUpdateChecklistNode(
  supabase: SupabaseClient,
  llm: ChatOpenAI,
  language?: string | null,
  /**
   * Optional so every existing caller and test keeps working: without it the
   * node behaves exactly as before and simply always calls the model.
   */
  cache?: AiCacheLike,
  /**
   * Notified with each batch of items the model has finished writing, before
   * the whole answer is in. Optional: without it the node behaves exactly as
   * it always did and the applicant sees the list only when it is complete.
   */
  onProgress?: DiscoveryProgress,
) {
  return async function updateChecklist(
    state: IntakeState,
  ): Promise<Partial<IntakeState>> {
    const result = await buildChecklist(state);
    // Family documents the profile still lacks (a child's birth certificate,
    // the spouse's ID, the marriage certificate) are requested as missing
    // items — for configured routes only, and closed again when the data
    // arrives. Reads the stored profile: the document pipeline writes there,
    // and the checkpoint's copy can be older. Never throws.
    await syncFamilyGapsForApplication(
      supabase,
      state.applicationId,
      undefined,
      state.visaTypeId ?? undefined,
    );
    // A slot that appeared on this build may already have its file: one the
    // applicant uploaded to "Additional document" when the slot did not exist
    // (prod app 61f16bb5: passport and insurance policy). Never throws.
    await linkOrphanDocuments(supabase, state.applicationId);
    return result;
  };

  async function buildChecklist(
    state: IntakeState,
  ): Promise<Partial<IntakeState>> {
    // Which requirements do we HAVE — not which table they came from.
    //
    // This branched on `state.frameworkId`, and that is the wrong question.
    // `loadFromRegistry` fills `requirementsJson` from the sourced registry
    // keyed on `visaTypeId` and never sets a `frameworkId` (there is no legacy
    // `country_frameworks` row to point at). So every registry-backed
    // application — the normal case since the registry landed — took the
    // discovery branch and its own sourced requirements were never turned into
    // checklist items at all.
    //
    // Observed on production 2026-09-03: a completed Express Entry intake, 40
    // messages, `isComplete: true`, `requirementsJson.base_documents` holding 2
    // sourced entries, and a document vault that said "Complete the AI intake
    // first" over an empty list.
    //
    // frameworkChecklist emits static labels from those requirements (no LLM),
    // so only the LLM-driven discovery path threads the language directive.
    // A route whose official list is short BY DESIGN opts out of discovery
    // entirely — supplement and fallback alike. Canada's eTA asks for a
    // passport; discovery's "strengthening" evidence (invitation letters, a
    // son's funds and accommodation) was visitor-visa advice the eTA never
    // asks for (dry run 2026-10-16).
    if (!routeAllowsDiscovery(state)) {
      return frameworkChecklist(state, supabase);
    }

    if (hasRequirements(state)) {
      const fromRequirements = await frameworkChecklist(state, supabase);
      const sourcedState: IntakeState = fromRequirements.checklistItems
        ? { ...state, checklistItems: fromRequirements.checklistItems }
        : state;

      // Sourced requirements are authoritative but not always sufficient:
      // `condition`, `step` and `fee` rows are correctly not documents, so a
      // visa type made mostly of those converts to few documents or none.
      // When the requirements produced nothing to upload, discovery still
      // has something to say. It never overwrites — it only adds types that
      // are not already on the list.
      // persistAdds returns `{}` when it added nothing, so fall back to what
      // the application already had. Discovery runs only when the applicant
      // would otherwise be looking at an empty vault — never merely to pad a
      // list that the requirements already answered, which would spend a model
      // call on every open.
      const items =
        fromRequirements.checklistItems ?? state.checklistItems ?? [];
      if (items.length > 0) {
        // A THIN sourced list still gets discovery's evidence — additively.
        //
        // Dry run 2026-10-14: a Canada TRV family visitor with a prior
        // refusal was shown IMM 5257, a passport copy and travel history.
        // IRCC's own page states the rest as `condition` rows (sufficient
        // funds, ties to home), which are correctly not documents — so the
        // applicant never heard about bank statements or home-tie evidence.
        //
        // Supplement mode adds documents only (no forms: the registry is
        // authoritative there), never marks them required, never duplicates,
        // and runs once per checklist — see needsSupplement.
        if (!needsSupplement(items)) return fromRequirements;
        try {
          const supplement = await discoveryChecklist(
            sourcedState,
            supabase,
            llm,
            language,
            cache,
            onProgress,
            'supplement',
          );
          return supplement.checklistItems ? supplement : fromRequirements;
        } catch (err) {
          console.error(
            '[update-checklist] supplemental discovery failed:',
            err instanceof Error ? err.message : err,
          );
          return fromRequirements;
        }
      }
    }

    return discoveryChecklist(
      state,
      supabase,
      llm,
      language,
      cache,
      onProgress,
    );
  }
}

/** False when the route's program says its sourced list must stand alone. */
function routeAllowsDiscovery(state: IntakeState): boolean {
  const program = strategyRegistry.resolveRoute(
    state.destinationCountry,
    routeVisaaiId(state),
  )?.program;
  return program?.checklistSupplement !== false;
}

/** At or below this many sourced documents, discovery supplements the list. */
const THIN_SOURCED_DOCUMENTS = 3;

/**
 * Should discovery add evidence on top of a sourced list?
 *
 * Only when the sourced list is thin (≤ THIN_SOURCED_DOCUMENTS required
 * non-form items) AND discovery has not already contributed. The second guard
 * is what keeps this to one model call: discovery's prompt includes the
 * existing list, so without it every turn would ask again and every answer
 * would add a few more "new" items.
 */
function needsSupplement(all: ChecklistItemSnapshot[]): boolean {
  // Family-gap requests describe the applicant's family, not the route: they
  // neither fill a thin sourced list nor count as discovery having run.
  const items = all.filter((i) => !isFamilyGapItem(i));
  const alreadyDiscovered = items.some((i) => {
    const reason = i.added_reason ?? '';
    const meta = (i.meta ?? {}) as { strength?: unknown };
    return (
      meta.strength === true ||
      reason.startsWith('discovery') ||
      reason.startsWith('strengthening')
    );
  });
  if (alreadyDiscovered) return false;
  const sourcedDocs = items.filter((i) => {
    const meta = (i.meta ?? {}) as { kind?: unknown };
    return i.required !== false && meta.kind !== 'form';
  });
  return sourcedDocs.length <= THIN_SOURCED_DOCUMENTS;
}

/**
 * True when `requirementsJson` actually carries something to build from,
 * whatever its source — the sourced registry or the legacy framework table,
 * which share this shape.
 */
function hasRequirements(state: IntakeState): boolean {
  const r = state.requirementsJson ?? {};
  const len = (k: string) =>
    Array.isArray(r[k]) ? (r[k] as unknown[]).length : 0;
  return len('base_documents') + len('base_forms') + len('branch_rules') > 0;
}

async function frameworkChecklist(
  state: IntakeState,
  supabase: SupabaseClient,
): Promise<Partial<IntakeState>> {
  const rules: BranchRule[] = Array.isArray(state.requirementsJson.branch_rules)
    ? (state.requirementsJson.branch_rules as BranchRule[])
    : [];
  const baseDocuments: Array<{
    type: string;
    label: string;
    owner?: Owner;
    specs?: Record<string, string>;
    required?: boolean;
    validity_months?: number;
  }> = Array.isArray(state.requirementsJson.base_documents)
    ? (state.requirementsJson.base_documents as Array<{
        type: string;
        label: string;
        owner?: Owner;
        specs?: Record<string, string>;
        required?: boolean;
        validity_months?: number;
      }>)
    : [];
  // Optional framework field: official forms required by the visa category.
  const baseForms: Array<{
    form_code: string;
    form_name: string;
    source_url?: string;
    owner?: Owner;
    /** Registry guidance (e.g. who signs IMM 5476), shown with the item. */
    specs?: Record<string, string>;
  }> = Array.isArray(state.requirementsJson.base_forms)
    ? (state.requirementsJson.base_forms as Array<{
        form_code: string;
        form_name: string;
        source_url?: string;
        owner?: Owner;
        specs?: Record<string, string>;
      }>)
    : [];

  const { data: currentItems } = await supabase
    .from('checklist_items')
    .select('id, document_type, label, required, added_reason, meta')
    .eq('application_id', state.applicationId);

  // Registry-sourced checklists are kept IN STEP with the registry, not only
  // added to: a relabelled requirement, or one reclassified as a condition
  // (super visa's "the invitation letter must state the family-size list"),
  // must change the applicant's existing rows too. See registry-reconcile.ts.
  const fromRegistry = state.requirementsJson.source === 'visa_registry';
  let reconcileUpdates: Array<{ id: string; values: Record<string, unknown> }> =
    [];
  const removedIds = new Set<string>();
  if (fromRegistry && currentItems && currentItems.length > 0) {
    try {
      const { data: linked } = await supabase
        .from('documents')
        .select('checklist_item_id')
        .eq('application_id', state.applicationId);
      const used = new Set(
        ((linked ?? []) as Array<{ checklist_item_id?: string | null }>)
          .map((d) => d.checklist_item_id)
          .filter((id): id is string => Boolean(id)),
      );
      const plan = planRegistryReconcile(
        currentItems,
        baseDocuments,
        undeterminedOf(state)
          .filter((u) => u.kind !== 'form')
          .map((u) => u.requirement_code),
        used,
      );
      reconcileUpdates = plan.updates;
      if (plan.deletes.length > 0) {
        const { error } = await supabase
          .from('checklist_items')
          .delete()
          .in('id', plan.deletes);
        if (error) {
          console.warn(
            '[update-checklist] reconcile delete failed:',
            error.message,
          );
        } else {
          plan.deletes.forEach((id) => removedIds.add(id));
        }
      }
    } catch (err) {
      console.warn(
        '[update-checklist] reconcile skipped:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const toAdd: PendingAdd[] = [];
  // A family-gap row ("Birth certificate — <child>") is a request for one
  // person's document; it must not stand in for the route's own requirement
  // of the same type, which would vanish when the gap closes.
  const existingTypes = new Set(
    (currentItems ?? state.checklistItems)
      .filter((i) => !isFamilyGapItem(i))
      .filter((i: { id?: string }) => !i.id || !removedIds.has(i.id))
      .map((i) => i.document_type),
  );

  // Items added earlier as "may be required" whose rule has since resolved
  // true: promote them in place rather than leaving them optional (the type
  // already exists, so the add loops below would otherwise skip them).
  const maybeRows = new Map<string, string>();
  for (const row of (currentItems ?? []) as Array<{
    id?: string;
    document_type: string;
    meta?: { may_be_required?: unknown } | null;
  }>) {
    if (row.id && row.meta?.may_be_required === true) {
      maybeRows.set(row.document_type, row.id);
    }
  }
  const promotions: Array<{ id: string; values: Record<string, unknown> }> = [
    ...reconcileUpdates,
  ];
  // Registry rows the source marks optional but that an earlier build inserted
  // as required (before `required: false` was carried). Only our own
  // `base_requirement` rows are touched — never discovery or applicant rows.
  const requiredBaseRows = new Map<string, string>();
  for (const row of (currentItems ?? []) as Array<{
    id?: string;
    document_type: string;
    required?: boolean | null;
    added_reason?: string | null;
  }>) {
    if (
      !fromRegistry && // registry rows are maintained by the reconcile above
      row.id &&
      row.required === true &&
      row.added_reason === 'base_requirement'
    ) {
      requiredBaseRows.set(row.document_type, row.id);
    }
  }

  for (const form of baseForms) {
    const type = `form_${form.form_code
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')}`;
    const formItem: PendingAdd = {
      document_type: type,
      label:
        form.form_name && form.form_code !== form.form_name
          ? `Form ${form.form_code} — ${form.form_name}`
          : `Form ${form.form_code}`,
      added_reason: 'base_form',
      meta: {
        kind: 'form',
        owner: form.owner === 'sponsor' ? 'sponsor' : 'applicant',
        form_code: form.form_code,
        form_name: form.form_name,
        source_url: form.source_url ?? null,
        ...(compactSpecs(withPreparedNote(form.form_code, form.specs))
          ? {
              specs: compactSpecs(withPreparedNote(form.form_code, form.specs)),
            }
          : {}),
      },
    };
    if (maybeRows.has(type)) {
      promotions.push({ id: maybeRows.get(type)!, values: promoted(formItem) });
      maybeRows.delete(type);
    } else if (!existingTypes.has(type)) {
      toAdd.push(formItem);
      existingTypes.add(type);
    }
  }

  for (const doc of baseDocuments) {
    const optional = doc.required === false;
    if (optional && requiredBaseRows.has(doc.type)) {
      promotions.push({
        id: requiredBaseRows.get(doc.type)!,
        values: { required: false },
      });
      continue;
    }
    const docItem: PendingAdd = {
      document_type: doc.type,
      label: doc.label,
      ...(optional ? { required: false } : {}),
      added_reason: 'base_requirement',
      meta: sourcedDocumentMeta(doc),
    };
    if (maybeRows.has(doc.type)) {
      promotions.push({
        id: maybeRows.get(doc.type)!,
        values: promoted(docItem),
      });
      maybeRows.delete(doc.type);
    } else if (!existingTypes.has(doc.type)) {
      toAdd.push(docItem);
      existingTypes.add(doc.type);
    }
  }

  // Requirements whose rule is still `unknown` — the applicant has not
  // answered what settles them. `convertRegistryToFramework` reports them so
  // they are not silently dropped; this is where they reach the applicant, as
  // optional "may be required" items. `base_conditional` starts with `base_`
  // on purpose: a route change retires them with the rest of the route's rows.
  for (const u of undeterminedOf(state)) {
    const isForm = u.kind === 'form';
    if (!isForm && !UNDETERMINED_DOCUMENT_KINDS.has(u.kind)) continue;
    const formCode = u.official_form_code ?? u.requirement_code.toUpperCase();
    const type = isForm
      ? `form_${formCode
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')}`
      : u.requirement_code;
    if (existingTypes.has(type)) continue;
    const baseLabel = isForm
      ? u.label && formCode !== u.label
        ? `Form ${formCode} — ${u.label}`
        : `Form ${formCode}`
      : u.label;
    toAdd.push({
      document_type: type,
      label: `${baseLabel} (may be required)`,
      required: false,
      added_reason: 'base_conditional',
      meta: {
        kind: isForm ? 'form' : 'document',
        owner: 'applicant',
        may_be_required: true,
        depends_on: u.dependsOn ?? [],
        ...(isForm
          ? {
              form_code: formCode,
              form_name: u.label,
              source_url: u.official_form_url ?? null,
            }
          : {}),
        ...(u.description ? { specs: { note: u.description } } : {}),
      },
    });
    existingTypes.add(type);
  }

  const promotedValues = new Map<string, Record<string, unknown>>();
  for (const p of promotions) {
    try {
      const { error } = await supabase
        .from('checklist_items')
        .update(p.values)
        .eq('id', p.id);
      if (error) {
        console.warn('[update-checklist] promote failed:', error.message);
      } else {
        promotedValues.set(p.id, p.values);
      }
    } catch (err) {
      console.warn(
        '[update-checklist] promote failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  for (const rule of rules) {
    const profileValue = state.profileJson[rule.condition.question];
    if (profileValue === rule.condition.answer) {
      for (const doc of rule.add) {
        if (!existingTypes.has(doc.type)) {
          toAdd.push({
            document_type: doc.type,
            label: doc.label,
            added_reason: `branch:${rule.condition.question}`,
            meta: {
              kind: 'document',
              owner: doc.owner === 'sponsor' ? 'sponsor' : 'applicant',
              ...(compactSpecs(doc.specs)
                ? { specs: compactSpecs(doc.specs) }
                : {}),
            },
          });
          existingTypes.add(doc.type);
        }
      }
    }
  }

  if (removedIds.size > 0) {
    state = {
      ...state,
      checklistItems: state.checklistItems.filter(
        (i) => !i.id || !removedIds.has(i.id),
      ),
    };
  }
  if (promotedValues.size === 0) {
    const added = await persistAdds(state, supabase, toAdd);
    return added.checklistItems || removedIds.size === 0
      ? added
      : { checklistItems: state.checklistItems };
  }
  // Keep the in-memory snapshot in step with the promoted rows.
  const promotedState: IntakeState = {
    ...state,
    checklistItems: state.checklistItems.map((i) =>
      i.id && promotedValues.has(i.id)
        ? ({ ...i, ...promotedValues.get(i.id) } as ChecklistItemSnapshot)
        : i,
    ),
  };
  const added = await persistAdds(promotedState, supabase, toAdd);
  return added.checklistItems
    ? added
    : { checklistItems: promotedState.checklistItems };
}

/** Undetermined kinds that become checklist rows (forms are handled separately). */
const UNDETERMINED_DOCUMENT_KINDS = new Set(['evidence', 'recommended']);

interface UndeterminedRequirement {
  requirement_code: string;
  label: string;
  dependsOn?: string[];
  kind: string;
  official_form_code?: string;
  official_form_url?: string;
  description?: string;
}

function undeterminedOf(state: IntakeState): UndeterminedRequirement[] {
  const raw = (state.requirementsJson ?? {}).undetermined;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (u): u is UndeterminedRequirement =>
      !!u &&
      typeof u === 'object' &&
      typeof (u as UndeterminedRequirement).requirement_code === 'string' &&
      typeof (u as UndeterminedRequirement).label === 'string' &&
      typeof (u as UndeterminedRequirement).kind === 'string',
  );
}

/** The column values that turn a "may be required" row into a required one. */
function promoted(item: PendingAdd): Record<string, unknown> {
  return {
    required: item.required ?? true,
    label: item.label,
    added_reason: item.added_reason,
    meta: item.meta,
  };
}

/**
 * Supplement mode: discovery on top of a sourced list. Forms are dropped (the
 * registry is authoritative for official forms) and every document is added as
 * optional supporting evidence, never as an official requirement.
 */
function asSupplement(adds: PendingAdd[]): PendingAdd[] {
  return adds
    .filter((a) => a.meta.kind !== 'form')
    .map((a) => ({
      ...a,
      required: false,
      meta: { ...a.meta, strength: true },
    }));
}

async function discoveryChecklist(
  state: IntakeState,
  supabase: SupabaseClient,
  llm: ChatOpenAI,
  language?: string | null,
  cache?: AiCacheLike,
  onProgress?: DiscoveryProgress,
  mode: 'full' | 'supplement' = 'full',
): Promise<Partial<IntakeState>> {
  const shape = (adds: PendingAdd[]) =>
    mode === 'supplement' ? asSupplement(adds) : adds;
  if (!state.destinationCountry) return {};

  // An empty profile used to end discovery here, on the reasoning that with no
  // answers there is nothing to reason from. That is right when the route is
  // unknown too — the model would be guessing from a country alone.
  //
  // It is wrong once the applicant has named their route, and that case is
  // common: 31 of the 177 visa types with requirements have NO document-kind
  // rows at all (every Japanese status of residence, five French routes, and
  // Canada's Express Entry until 2026-10-19), so the registry yields nothing
  // to upload and discovery is the only thing left. A brand-new application then showed an
  // empty vault with no explanation — observed 2026-09-04 on an Express Entry
  // application, where the rebuild returned `[]` in 18ms because this line was
  // reached before any model call.
  //
  // A named route plus a country is real signal, not a blank guess.
  if (Object.keys(state.profileJson).length === 0 && !state.visaTypeId) {
    return {};
  }

  const { data: currentItems } = await supabase
    .from('checklist_items')
    .select('document_type, label, meta')
    .eq('application_id', state.applicationId);

  type ExistingRow = {
    document_type: string;
    label: string;
    meta?: { kind?: string; form_code?: string } | null;
  };
  const existing = [...((currentItems ?? []) as ExistingRow[])];
  // Also dedupe against items this same run just inserted (the sourced list in
  // supplement mode), so a read that does not yet see them cannot duplicate.
  const seenTypes = new Set(existing.map((i) => i.document_type));
  for (const i of state.checklistItems ?? []) {
    if (seenTypes.has(i.document_type)) continue;
    seenTypes.add(i.document_type);
    existing.push({
      document_type: i.document_type,
      label: i.label,
      meta: (i.meta ?? null) as ExistingRow['meta'],
    });
  }
  const existingTypes = new Set(existing.map((i) => i.document_type));
  const existingFormCodes = new Set(
    existing
      .filter(
        (i) => i.meta?.kind === 'form' && typeof i.meta.form_code === 'string',
      )
      .map((i) => normalizeFormCode(i.meta!.form_code as string)),
  );

  const profileSummary =
    Object.entries(state.profileJson)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join('\n') || '(none yet)';

  const existingList = existing.length
    ? existing.map((i) => `- ${i.document_type}: ${i.label}`).join('\n')
    : '(none)';

  const stateLine = state.destinationState
    ? ` (state/province: ${state.destinationState})`
    : '';
  const countryName = resolveCountryName(state.destinationCountry);

  /**
   * The route, when one is chosen.
   *
   * Discovery named only the country, so an Express Entry applicant and a
   * visitor-visa applicant to the same country were sent the same prompt and
   * got the same documents. The route is the single strongest determinant of
   * what someone must file — a permanent-residence pathway and a two-week
   * tourist visit share almost nothing — so omitting it made every discovered
   * list generic at best and wrong at worst.
   *
   * Registry data, not applicant input, so it is not fenced as untrusted.
   */
  let routeLine = '';
  if (state.visaTypeId) {
    try {
      const { data: route } = await supabase
        .from('visa_types')
        .select('official_name, official_code')
        .eq('id', state.visaTypeId)
        .maybeSingle();
      const named = route as {
        official_name?: string | null;
        official_code?: string | null;
      } | null;
      if (named?.official_name) {
        const code = named.official_code ? ` (${named.official_code})` : '';
        routeLine =
          `Visa route the applicant has chosen: ${named.official_name}${code}\n` +
          `Return the documents and forms THIS route requires. A different ` +
          `route to the same country needs a different list.\n\n`;
      }
    } catch {
      // Naming the route sharpens the list; it is not required to produce one.
      // Same posture as loadFromRegistry: a registry read that fails degrades
      // the answer rather than denying the applicant a checklist entirely.
    }
  }

  const userMessage =
    `Destination country: ${countryName} (${state.destinationCountry})${stateLine}\n\n` +
    routeLine +
    (mode === 'supplement'
      ? `The existing checklist below is the government's own sourced list for ` +
        `this route. Do not restate it; suggest only additional supporting ` +
        `evidence that would help this applicant's case.\n\n`
      : '') +
    `IMPORTANT: Generate ONLY ${countryName}'s official forms and supporting ` +
    `documents, based on ${countryName}'s official government immigration ` +
    `website. NEVER include another country's forms (e.g. Canada IMM, USA ` +
    `DS-160/I-/G-, UK VAF/Appendix, Australia subclass forms) unless they are ` +
    `genuinely ${countryName}'s.\n\n` +
    // SEC-6004: the profile is user-supplied intake answers — fence it.
    `Applicant profile so far:\n${asUntrustedData('applicant profile', profileSummary)}\n\n` +
    `Existing checklist items (do not duplicate):\n${existingList}\n\n` +
    `Return the new official forms and supporting documents this applicant should prepare next for ${countryName}.`;

  // Checklist item titles/descriptions are shown to the user, so generated
  // human-readable text is written in their language. Scoped so identifiers
  // (type/form_code/source_url) and form codes stay machine/original — only the
  // display fields (label, reason, specs free-text) are translated. en/null
  // yields no directive, preserving the default English behaviour.
  const langName = languageName(language);
  const langDirective =
    langName && language !== 'en'
      ? `\n\nRESPONSE LANGUAGE: Write the human-readable display fields — "label", "reason", and the free-text values inside "specs" — in ${langName}. Keep machine fields exactly as specified: "type" (snake_case identifiers), "form_code", and "source_url" must NEVER be translated, and official government form codes (DS-160, IMM 5257, VAF1A, etc.) stay in their original form.`
      : '';

  /**
   * Cached on every path, not only the empty-profile one.
   *
   * The first version restricted caching to applications with no answers yet,
   * reasoning that only then is the prompt free of applicant data. That
   * protected the wrong thing and missed the actual cost: the freshness check
   * rebuilds whenever the profile moves, so an applicant going between the
   * interview and their documents paid a full model call EVERY time. Measured
   * in production after that change: 23,134ms, cache never consulted.
   *
   * Widening it is safe because of how the key is built. `aiCacheKey` puts
   * `sha256(input)` inside an already-hashed key, so the prompt and the answers
   * in it never reach Redis in readable form, and an entry is reachable only by
   * reproducing the identical prompt — which means the identical applicant
   * state. That same Redis already holds the LangGraph checkpoints, which carry
   * far more of the applicant's answers than a document list does.
   *
   * Same situation, same list, no second model call.
   */
  const cacheable = !!cache;

  let result: z.infer<typeof DiscoverySchema>;
  let cached: z.infer<typeof DiscoverySchema> | null = null;

  if (cacheable) {
    try {
      const hit = await cache.get({
        task: 'intake_checklist_discovery',
        input: userMessage,
      });
      if (hit) {
        const parsed = DiscoverySchema.safeParse(JSON.parse(hit));
        // A cached value that no longer matches the schema is a miss, not an
        // error: the schema can change under a live cache.
        if (parsed.success) cached = parsed.data;
      }
    } catch {
      // Fail open, always. A cache that can break the checklist is a liability.
    }
  }

  if (cached) {
    result = cached;
  } else {
    const structured = llm.withStructuredOutput(DiscoverySchema, {
      name: 'intake_checklist',
    });
    const prompt = [
      {
        role: 'system',
        content: `${DISCOVERY_PROMPT}${langDirective}\n\n${UNTRUSTED_DATA_DIRECTIVE}`,
      },
      { role: 'user', content: userMessage },
    ];

    /**
     * Streamed so the applicant sees the list being written, not a spinner.
     *
     * This generation was measured at 9-21s, and for the 31 visa types whose
     * registry carries no document-kind rows at all (Express Entry was one)
     * it is the ONLY thing that produces a checklist — so those applicants
     * watched an empty vault for the whole of it.
     *
     * The prompt and the schema are untouched: this streams the SAME structured
     * call, so the finished list is identical to what the blocking call
     * produced. If the model or the parser declines to yield anything early,
     * the loop simply ends with one final chunk and the only thing lost is the
     * early paint — which is why the fallback below is a plain `invoke` rather
     * than anything cleverer.
     */
    let streamed: PartialDiscovery | null = null;
    try {
      let emitted = 0;
      for await (const chunk of await structured.stream(prompt)) {
        streamed = chunk;
        if (!onProgress) continue;
        const adds = shape(
          mapDiscoveryToAdds(
            completedItemsOnly(streamed, false),
            state,
            existingTypes,
            existingFormCodes,
          ),
        );
        if (adds.length > emitted) {
          // `mapDiscoveryToAdds` is stable over a growing input, so everything
          // past the high-water mark is new and everything before it has
          // already been sent.
          const delta = adds.slice(emitted);
          emitted = adds.length;
          try {
            await onProgress(delta);
          } catch {
            // A consumer that has gone away (a closed tab) must not abort a
            // generation the checklist still needs finishing.
          }
        }
      }
    } catch (err) {
      console.error(
        '[update-checklist:discovery] stream error:',
        err instanceof Error ? err.message : err,
      );
      streamed = null;
    }

    // Defaults BEFORE validation. The schema requires all three groups, and a
    // model that had nothing to say about one of them simply omits the key —
    // which would fail the parse and throw away a perfectly good answer, then
    // pay for a second call to be told the same thing.
    const parsed = streamed
      ? DiscoverySchema.safeParse({
          required_forms: [],
          required_documents: [],
          strengthening_documents: [],
          ...completedItemsOnly(streamed, true),
        })
      : null;
    if (parsed?.success) {
      result = parsed.data;
    } else {
      // Nothing usable came out of the stream. Fall back to the blocking call
      // that has always been here, so a streaming failure costs latency and
      // nothing else.
      try {
        const fallback: unknown = await structured.invoke(prompt);
        const reparsed = DiscoverySchema.safeParse({
          required_forms: [],
          required_documents: [],
          strengthening_documents: [],
          ...(fallback as object),
        });
        // An unusable answer is an empty checklist, never a crash on the way to
        // rendering one.
        if (!reparsed.success) return {};
        result = reparsed.data;
      } catch (err) {
        console.error(
          '[update-checklist:discovery] LLM error:',
          err instanceof Error ? err.message : err,
        );
        return {};
      }
    }
  }

  // Write back only what was just generated, and only for the shared case.
  // Fire-and-forget: a cache write that fails must not cost the applicant the
  // checklist the model already produced.
  if (cacheable && !cached) {
    void cache
      .set(
        { task: 'intake_checklist_discovery', input: userMessage },
        JSON.stringify(result),
      )
      .catch(() => undefined);
  }

  const toAdd = shape(
    mapDiscoveryToAdds(result, state, existingTypes, existingFormCodes),
  );

  return persistAdds(state, supabase, toAdd);
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'form'
  );
}

function normalizeFormCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]+/g, '');
}

function uniqueType(base: string, existing: Set<string>): string | null {
  if (!existing.has(base)) return base;
  for (let i = 2; i < 50; i += 1) {
    const candidate = `${base}_${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return null;
}

async function persistAdds(
  state: IntakeState,
  supabase: SupabaseClient,
  toAdd: PendingAdd[],
): Promise<Partial<IntakeState>> {
  if (toAdd.length === 0) return {};

  const rows = toAdd.map((item) => ({
    application_id: state.applicationId,
    document_type: item.document_type,
    label: item.label,
    required: item.required ?? true,
    status: 'missing' as const,
    added_reason: item.added_reason,
    meta: item.meta,
  }));

  const { data: inserted, error } = await supabase
    .from('checklist_items')
    .insert(rows)
    .select('*');

  if (error) {
    console.error('[update-checklist] insert error:', error.message);
    return {};
  }

  const newItems: ChecklistItemSnapshot[] = (inserted ?? []).map((r) => ({
    id: r.id,
    document_type: r.document_type,
    label: r.label,
    required: r.required,
    status: r.status,
    added_reason: r.added_reason,
    meta: r.meta ?? null,
  }));

  return { checklistItems: [...state.checklistItems, ...newItems] };
}

/**
 * A snapshot of the model's answer, mapped to the items it implies.
 *
 * Lifted out of `discoveryChecklist` unchanged so it can be run REPEATEDLY over
 * a partial answer as it streams in, not only once at the end. It is pure: the
 * dedupe sets are copied rather than mutated, so running it over chunk N+1
 * yields chunk N's items plus the new ones, in the same order, every time —
 * which is what makes "everything after what I already sent" a safe delta.
 *
 * Fields are read defensively because a streamed chunk is a half-written
 * object. `completedItemsOnly` is what keeps a half-written ITEM from reaching
 * here at all.
 */
function mapDiscoveryToAdds(
  result: PartialDiscovery,
  state: IntakeState,
  baseTypes: ReadonlySet<string>,
  baseFormCodes: ReadonlySet<string>,
): PendingAdd[] {
  const toAdd: PendingAdd[] = [];
  // Copies: this runs repeatedly over a GROWING partial result, and the
  // dedupe sets must start from the same baseline every time, or an item
  // mapped from an earlier chunk would suppress itself in the next one.
  const existingTypes = new Set(baseTypes);
  const existingFormCodes = new Set(baseFormCodes);

  for (const form of result.required_forms ?? []) {
    const code = (form.form_code ?? '').trim();
    if (!code) continue;
    // Cross-country leakage guard: drop a form whose code clearly belongs to a
    // different country than the destination (e.g. Canadian IMM in a Finland
    // flow). Deterministic backstop in case the prompt's country-lock is ignored.
    if (isForeignForm(state.destinationCountry, code)) {
      console.warn(
        `[update-checklist] dropped foreign form "${code}" for destination ${state.destinationCountry}`,
      );
      continue;
    }
    if (existingFormCodes.has(normalizeFormCode(code))) continue;
    const documentType = uniqueType(`form_${slugify(code)}`, existingTypes);
    if (!documentType) continue;
    existingTypes.add(documentType);
    existingFormCodes.add(normalizeFormCode(code));
    const source_url =
      typeof form.source_url === 'string' &&
      /^https?:\/\//i.test(form.source_url)
        ? form.source_url.trim()
        : null;
    const name = (form.form_name ?? '').trim();
    toAdd.push({
      document_type: documentType,
      label: name && name !== code ? `Form ${code} — ${name}` : `Form ${code}`,
      added_reason: 'discovery_form',
      meta: {
        kind: 'form',
        owner: form.owner === 'sponsor' ? 'sponsor' : 'applicant',
        form_code: code,
        form_name: name || code,
        source_url,
      },
    });
  }

  for (const doc of result.required_documents ?? []) {
    const normalized = (doc.type ?? '').toLowerCase().trim();
    if (!normalized || !doc.label) continue;
    if (existingTypes.has(normalized)) continue;
    existingTypes.add(normalized);
    const specs = compactSpecs(doc.specs);
    toAdd.push({
      document_type: normalized,
      label: doc.label,
      added_reason: doc.reason ? `discovery:${doc.reason}` : 'discovery',
      meta: {
        kind: 'document',
        owner: doc.owner === 'sponsor' ? 'sponsor' : 'applicant',
        ...(specs ? { specs } : {}),
      },
    });
    if (toAdd.length >= 13) break;
  }

  // Optional case-strengthening documents — not required, won't block prefill,
  // but improve approval odds. Tagged meta.strength so the UI can group them.
  for (const doc of result.strengthening_documents ?? []) {
    const normalized = (doc.type ?? '').toLowerCase().trim();
    if (!normalized || !doc.label) continue;
    if (existingTypes.has(normalized)) continue;
    existingTypes.add(normalized);
    const specs = compactSpecs(doc.specs);
    toAdd.push({
      document_type: normalized,
      label: doc.label,
      required: false,
      added_reason: doc.reason
        ? `strengthening:${doc.reason}`
        : 'strengthening',
      meta: {
        kind: 'document',
        owner: doc.owner === 'sponsor' ? 'sponsor' : 'applicant',
        strength: true,
        ...(specs ? { specs } : {}),
      },
    });
    if (toAdd.length >= 19) break;
  }
  return toAdd;
}
