import { evaluateRule } from './rule-evaluator';
import type { RuleFacts, RuleNode } from './rule.types';

/**
 * Bridge from the sourced visa registry to the checklist engine.
 *
 * WHY THIS EXISTS
 *
 * Two things were true at once, and neither was visible from the other side:
 *
 *   1. `update-checklist.ts` contains a written, tested, deterministic
 *      branch-rule engine that decides an applicant's checklist from a
 *      framework. It has never run in production, because
 *      `applications.framework_id` is never populated — so every requirements
 *      decision falls through to an LLM's recall instead.
 *
 *   2. `visa_requirements` now holds 166 requirements for nine visa types,
 *      every one quoted from a government page and bound to the source version
 *      it was read from. Nothing in the application flow read a single one of
 *      them; they served the public pages only.
 *
 * This function is the missing join. It converts registry rows into exactly the
 * `requirementsJson` shape the existing engine already consumes, so the engine
 * starts running on sourced data without being rewritten.
 *
 * WHAT CHANGES FOR AN APPLICANT
 *
 * Their checklist stops being a model's recollection of what Canada asks for
 * and becomes the list IRCC publishes, each item traceable to the page it came
 * from. That is the entire point of the registry, and until now it stopped at
 * the public pages.
 */

/** The shape `update-checklist.ts` reads. Matched exactly — do not "improve" it here. */
export interface FrameworkRequirements {
  base_documents: Array<{
    type: string;
    label: string;
    owner?: 'applicant' | 'sponsor';
    specs?: Record<string, string>;
    /**
     * `false` for advice the government does not require (kind `recommended`,
     * or `officially_required: false`). Absent means required. Without it a
     * recommendation such as "Evidence of previous travel" gated form
     * generation for applicants who have never travelled.
     */
    required?: false;
    /**
     * Months the document must stay valid after the planned entry date, from
     * the registry's `parameters.minimum_validity_months` (super visa medical
     * insurance: 12). The expiry check measures against it.
     */
    validity_months?: number;
  }>;
  base_forms: Array<{
    form_code: string;
    form_name: string;
    source_url?: string;
    owner?: 'applicant' | 'sponsor';
    /** The registry description — what the applicant must do with the form. */
    specs?: Record<string, string>;
  }>;
  /**
   * Left empty on purpose. The old `branch_rules` shape supports exactly one
   * comparison — equality against one intake answer — and cannot express
   * "nationality in [...]", "age < 18" or "stay > 90 days". Rather than
   * down-convert richer rules into a form that would silently drop their
   * conditions, conditional requirements are evaluated HERE with the real rule
   * engine and emitted as base items when they apply. See `verdict` below.
   */
  branch_rules: never[];
  /** Provenance, for the UI to show why an item is on the list. */
  source: 'visa_registry';
  visaai_id: string;
}

export interface RegistryRequirement {
  requirement_code: string;
  kind: string;
  officially_required: boolean;
  label: string;
  description: string | null;
  official_form_code: string | null;
  official_form_url: string | null;
  rule: unknown;
  display_order: number;
  /**
   * Structured figures from the registry row. Two keys matter to the
   * checklist: `document_owner` ('sponsor' = the host/sponsor obtains it) and
   * `minimum_validity_months`. Optional so older callers keep compiling.
   */
  parameters?: Record<string, unknown> | null;
}

export interface ConversionResult {
  framework: FrameworkRequirements;
  /**
   * Requirements whose rule evaluated `unknown` — the applicant has not
   * answered the question that decides them.
   *
   * These are NOT in `base_documents`, and they are NOT dropped. Dropping them
   * is the failure the three-valued rule engine exists to prevent: an
   * applicant would be shown a complete-looking checklist that silently omits
   * a document they will need. The caller surfaces these as "may be required —
   * answer X to confirm".
   */
  undetermined: Array<{
    requirement_code: string;
    label: string;
    /** The facts that would settle it, for the question to ask next. */
    dependsOn: string[];
    /**
     * Registry kind, so the checklist can render the item the same way it
     * would render it once determined (a form vs a document) — and skip the
     * kinds that are never checklist rows (condition / step / fee).
     */
    kind: string;
    official_form_code?: string;
    official_form_url?: string;
    description?: string;
  }>;
  /** Requirements a known fact ruled out. Recorded so the UI can explain an absence. */
  excluded: string[];
}

/**
 * Map a registry `kind` onto the checklist's document taxonomy.
 *
 * `condition`, `step` and `fee` are deliberately NOT documents. A checklist is
 * a list of things to obtain and upload; "be in good health" and "pay CAD 100"
 * are neither, and putting them in the document list would produce items an
 * applicant can never satisfy by uploading a file. They belong to the readiness
 * view, which is a separate surface.
 */
const DOCUMENT_KINDS = new Set(['evidence', 'recommended']);

/**
 * A CLASSIFICATION MISTAKE THIS SET INVITES, RECORDED BECAUSE I MADE IT TWICE.
 *
 * `evidence` means a thing the applicant obtains and uploads. It does NOT mean
 * "a sentence about documents". Two Dutch requirements were extracted as
 * evidence when they are statements about where the document list lives —
 * "your employer holds the list of documents you need" and "the document list
 * comes from your educational institution".
 *
 * Classified as evidence they became checklist rows. For the highly skilled
 * migrant permit that row was the ENTIRE checklist: a one-item list the
 * applicant could not action, with nothing indicating the real list existed
 * elsewhere. A checklist that looks complete and is empty is worse than no
 * checklist at all.
 *
 * Both are now `condition`. The test to apply when extracting: can the
 * applicant put this in a folder? If not, it is not evidence.
 */

/**
 * Requirements that are NEVER an upload, whatever kind they were extracted as.
 *
 * Dry run 2026-10-16 (Canada eTA): "An accepted credit or debit card" and "A
 * valid email address" were extracted as `evidence`, became required upload
 * slots, and a photo of a VOID card was accepted and marked Verified. A card
 * image is cardholder data VisaAI has no reason to hold — the government takes
 * the card on its own payment page — and an email address is typed, not
 * scanned. Migration 20261016120000 re-kinds the eTA rows as `condition`; this
 * guard holds before it is applied and against any extraction that repeats the
 * mistake on another route.
 */
const NEVER_UPLOADED =
  /(^|_)(payment_method|payment_card|credit_card|debit_card|card_details|email_address)(_|$)/;

/**
 * Proof of paying the government's own fee. It goes in with the application,
 * but the applicant only gets it when they pay, at submission — so it is on
 * the list and never a gate on preparing the forms. Live E2E 2026-10-19
 * (spousal sponsorship): the Forms page refused to draft anything until an
 * IRCC fee receipt was uploaded.
 */
// Anchored to the application's own fee: other receipts (Lebanon's
// endorsement_fee_receipt_copy) are obtained BEFORE applying and must gate.
const OBTAINED_AT_SUBMISSION = /^(processing|application|visa)_fee_receipt$/;

export function convertRegistryToFramework(
  visaaiId: string,
  requirements: RegistryRequirement[],
  facts: RuleFacts = {},
): ConversionResult {
  const base_documents: FrameworkRequirements['base_documents'] = [];
  const base_forms: FrameworkRequirements['base_forms'] = [];
  const undetermined: ConversionResult['undetermined'] = [];
  const excluded: string[] = [];

  const ordered = [...requirements].sort(
    (a, b) => a.display_order - b.display_order,
  );

  for (const r of ordered) {
    const verdict = evaluateRule((r.rule ?? null) as RuleNode | null, facts);

    if (verdict === 'false') {
      excluded.push(r.requirement_code);
      continue;
    }

    if (verdict === 'unknown') {
      undetermined.push({
        requirement_code: r.requirement_code,
        label: r.label,
        dependsOn: factsIn(r.rule as RuleNode | null),
        kind: r.kind,
        ...(r.official_form_code
          ? { official_form_code: r.official_form_code }
          : {}),
        ...(r.official_form_url
          ? { official_form_url: r.official_form_url }
          : {}),
        ...(r.description ? { description: r.description } : {}),
      });
      continue;
    }

    // verdict === 'true' — it applies.
    if (r.kind === 'form') {
      base_forms.push({
        form_code: r.official_form_code ?? r.requirement_code.toUpperCase(),
        form_name: r.label,
        ...(r.official_form_url ? { source_url: r.official_form_url } : {}),
        ...(r.description ? { specs: { note: r.description } } : {}),
      });
      continue;
    }

    if (DOCUMENT_KINDS.has(r.kind) && !NEVER_UPLOADED.test(r.requirement_code)) {
      // `may_follow_application`: officially required, but supplied after the
      // application when the authority asks for it (super visa IME without an
      // upfront exam). On the list, never a gate on preparing the forms.
      const optional =
        r.kind === 'recommended' ||
        r.officially_required === false ||
        r.parameters?.may_follow_application === true ||
        OBTAINED_AT_SUBMISSION.test(r.requirement_code);
      const owner = ownerOf(r.parameters);
      const validity = validityMonthsOf(r.parameters);
      base_documents.push({
        type: r.requirement_code,
        label: r.label,
        ...(owner ? { owner } : {}),
        ...(r.description ? { specs: { note: r.description } } : {}),
        ...(optional ? { required: false as const } : {}),
        ...(validity !== undefined ? { validity_months: validity } : {}),
      });
    }
    // condition / step / fee fall through: real requirements, not checklist
    // documents. See DOCUMENT_KINDS.
  }

  return {
    framework: {
      base_documents,
      base_forms,
      branch_rules: [],
      source: 'visa_registry',
      visaai_id: visaaiId,
    },
    undetermined,
    excluded,
  };
}

/**
 * Who obtains a document. Only an explicit sponsor/host marker moves it off
 * the applicant: a super visa host's invitation letter, status proof and
 * income proof are the host's to produce, and the vault groups them so.
 */
function ownerOf(
  parameters: Record<string, unknown> | null | undefined,
): 'sponsor' | undefined {
  const v = parameters?.document_owner;
  return v === 'sponsor' || v === 'host' ? 'sponsor' : undefined;
}

function validityMonthsOf(
  parameters: Record<string, unknown> | null | undefined,
): number | undefined {
  const v = parameters?.minimum_validity_months;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Facts a rule reads. Local copy to keep this module free of a circular import. */
function factsIn(rule: RuleNode | null): string[] {
  const out = new Set<string>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const node = n as Record<string, unknown>;
    if (Array.isArray(node.all)) return node.all.forEach(walk);
    if (Array.isArray(node.any)) return node.any.forEach(walk);
    if (node.not !== undefined) return walk(node.not);
    if (typeof node.fact === 'string') out.add(node.fact);
  };
  walk(rule);
  return [...out];
}
