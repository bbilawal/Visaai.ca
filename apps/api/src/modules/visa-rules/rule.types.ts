/**
 * The requirement rule language.
 *
 * WHY THIS EXISTS
 *
 * Conditional visa logic was previously expressed two ways, both bad:
 *
 *   1. `country_frameworks.requirements_json.branch_rules[]` — a bespoke shape
 *      (`{condition: {question, answer}, add: [...]}`) that supports exactly
 *      one comparison, equality against one answer. "required when the
 *      applicant is under 18", "required when the stay exceeds 90 days" and
 *      "required for these nationalities" are all inexpressible in it.
 *   2. Frontend conditionals. Business rules that decide what a government
 *      requires have no business living in a React component, where they
 *      cannot be tested against the source that mandates them and cannot be
 *      enforced server-side.
 *
 * This module is the testable rules layer the spec requires. Rules are DATA
 * (stored in `visa_requirements.rule`), so they can be validated on write,
 * diffed against a source version when the government changes a page, replayed
 * in tests, and explained back to the user as the reason a document appeared.
 *
 * DESIGN CONSTRAINTS
 *
 * - Total. Evaluation never throws on bad input; an unknown fact is `unknown`,
 *   not `false`. The difference matters: "we do not know whether you need this"
 *   must not silently become "you do not need this" on a visa checklist.
 * - Pure. No I/O, no clock, no config. The same facts always give the same
 *   answer, which is what makes a rule reproducible in a test and in an audit.
 * - Closed. A fixed operator set. An unrecognised operator is a validation
 *   error at write time, never a silent `false` at read time.
 */

/** Facts an applicant profile can supply. Closed set: a rule may only ask about things VisaAI actually collects. */
export const RULE_FACTS = [
  'nationality',
  'second_nationality',
  'residence_country',
  'age',
  'passport_type',
  'passport_validity_months',
  'purpose',
  'stay_duration_days',
  'entries_required',
  'employment_status',
  'is_self_employed',
  'is_student',
  'is_retired',
  'has_sponsor',
  'sponsor_relationship',
  'has_dependants',
  'dependant_count',
  'marital_status',
  'has_accommodation_booked',
  'has_itinerary',
  'has_insurance',
  'has_prior_refusal',
  'has_prior_travel',
  'has_criminal_record',
  'funds_available',
  'funds_currency',
  'education_level',
  'occupation',
  'travelling_with_minor',
  'is_minor',
  'application_country',
  'submission_mode',
  'visa_subclass',
  /**
   * Added when extracting Canada's visitor visa: IRCC requires IMM 5476 "(if
   * using an authorized representative)" and IMM 5475 "(if authorizing
   * information from your case file to be released to someone other than
   * yourself)". Without these facts those conditions are inexpressible, and the
   * only alternatives were both wrong — store no rule and render two optional
   * forms as universally required, or drop the requirements entirely.
   *
   * VisaAI does not collect either yet, so a rule using them evaluates to
   * `unknown` and the checklist renders "may be required". That is the correct
   * answer for a question nobody has been asked.
   */
  'uses_representative',
  'authorizes_information_release',
  /**
   * Added for Canada's eTA (dry run 2026-10-16). Who needs an eTA turns on
   * all four: a U.S. lawful permanent resident needs none; the CAN+ branch
   * (visa-required nationals who may apply for an eTA instead) needs a Canadian
   * visa in the past 10 years OR a valid U.S. non-immigrant visa; and every
   * eTA branch applies only to travel BY AIR. The eTA interview asks each.
   */
  'us_lpr',
  'travel_by_air',
  'valid_us_nonimmigrant_visa',
  'canadian_visa_last_10y',
  /**
   * Added for Canada's business visitor route (audit 2026-10-18). IRCC asks for
   * "warranty or service agreements, or contracts, if relevant to your visit"
   * — relevant only to after-sales service (installing, repairing or servicing
   * equipment sold to a Canadian buyer). Without this fact the row was a
   * required upload for every business visitor.
   *
   * Closed vocabulary, set by profile-to-rule-facts.ts only when recognisable:
   * after_sales_service | meetings | buying_goods | training. Unrecognised
   * text leaves it unset, so a rule on it stays `unknown` ("may be required").
   */
  'business_activity',
  /**
   * Added for Canada's work permit checklist (registry v2, 2026-10-29). IRCC's
   * forms-and-documents page splits the documents by permit kind: a positive
   * LMIA and a job offer letter only "if your job requires an lmia", an offer
   * of employment number only "if your job is lmia-exempt", the employer
   * documents only for an employer-specific permit, and "not applicable" for
   * an open permit. Without these facts every work permit applicant was asked
   * for an LMIA.
   *
   * Set by profile-to-rule-facts.ts from the work interview's answers, through
   * the @visaai/types classifiers the interview itself uses:
   *   work_permit_type        lmia | lmia_exempt | open (SAWP is lmia);
   *                           unrecognised text leaves it unset
   *   works_in_quebec         the CAQ (Quebec + LMIA)
   *   open_permit_principal   worker | student, for the family open permit
   *   public_health_occupation, agricultural_occupation, ime_country_six_months
   *                           the medical-exam triggers IRCC states beside the
   *                           stay-and-residence one
   *   resident_non_citizen    lives in a country they are not a citizen of
   *                           (proof of present immigration status there)
   */
  'work_permit_type',
  'works_in_quebec',
  'open_permit_principal',
  'public_health_occupation',
  'agricultural_occupation',
  'ime_country_six_months',
  'resident_non_citizen',
] as const;

export type RuleFact = (typeof RULE_FACTS)[number];

/** Operators. `in`/`nin` take arrays; `exists` takes no value; the rest take a scalar. */
export const RULE_OPERATORS = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'nin',
  'exists',
  'not_exists',
  'contains',
] as const;

export type RuleOperator = (typeof RULE_OPERATORS)[number];

export type RuleScalar = string | number | boolean | null;

export interface RuleCondition {
  fact: RuleFact;
  op: RuleOperator;
  value?: RuleScalar | RuleScalar[];
}

export interface RuleAll {
  all: RuleNode[];
}
export interface RuleAny {
  any: RuleNode[];
}
export interface RuleNot {
  not: RuleNode;
}

export type RuleNode = RuleCondition | RuleAll | RuleAny | RuleNot;

/**
 * Three-valued, deliberately.
 *
 * `unknown` is returned when a rule asks about a fact the applicant has not
 * supplied. Collapsing it into `false` would drop requirements off a checklist
 * because a question had not been reached yet — the applicant would be told
 * their application is ready when it is not. Callers must decide explicitly:
 * the checklist builder shows unknown-gated requirements as "may be required,
 * answer X to confirm", which is the honest rendering.
 */
export type RuleVerdict = 'true' | 'false' | 'unknown';

export type RuleFacts = Partial<Record<RuleFact, unknown>>;

export function isCondition(node: RuleNode): node is RuleCondition {
  return typeof (node as RuleCondition).fact === 'string';
}
export function isAll(node: RuleNode): node is RuleAll {
  return Array.isArray((node as RuleAll).all);
}
export function isAny(node: RuleNode): node is RuleAny {
  return Array.isArray((node as RuleAny).any);
}
export function isNot(node: RuleNode): node is RuleNot {
  return (node as RuleNot).not !== undefined && !isCondition(node);
}
