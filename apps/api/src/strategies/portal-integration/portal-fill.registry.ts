import type {
  PortalFillLeftReason,
  PortalFillOp,
  PreflightCategory,
} from '@visaai/types';

/**
 * Portal fill mappings: per-portal field → selector data used by the assisted
 * auto-fill flow. Country/portal-specific selectors live here as DATA, resolved
 * by portalId — the automation pipeline never hardcodes a portal (e.g. IRCC).
 *
 * Add a portal's mapping = one registration; no changes to the fill engine.
 */
/**
 * Value shaping for portals that split one value over several controls.
 *  - date_year / date_month / date_day: an ISO date (YYYY-MM-DD) → its part,
 *    month zero-padded ("06"), day not ("15", "1") — IRCC's option values.
 *  - ircc_country: a country (ISO-3, ISO-2 or English name) → IRCC's numeric
 *    country code.
 *  - strip_dashes: keep letters, digits and spaces only (IRCC refuses
 *    "special characters" in a national ID number: CNIC 37405-5309209-7 →
 *    3740553092097, CPF 123.456.789-09 → 12345678909).
 *  - digits: keep digits only (telephone numbers).
 *  - plain_words: letters, digits and single spaces only ("&" → "and",
 *    accents dropped) — IRCC's work-history duties box is ng-invalid on any
 *    punctuation, even "," and ":" (live 2026-10-19).
 *  - whole_number: an amount rounded to whole units ("5,000.60" → "5001").
 *  - date_month_name / date_day_padded: an ISO date → its month as the English
 *    name ("May") / its day zero-padded ("01") — the IRCC eTA form's option
 *    text (its date selects are chosen by text; option values are indexes).
 *  - eta_country_code / eta_nationality / eta_place_country: a country → the
 *    option text of the matching IRCC eTA list. The form has three different
 *    lists ("GBR (UK - British citizen)" / "UK - British citizen" /
 *    "England"); see portal-fills/eta-options.ts.
 *  - eapp_month: an ISO date → the IRCC secure-account questionnaire's month
 *    option value (its month codes are not in calendar order: January 1819,
 *    February 1818…; recorded live 2026-10-20, canada-ircc-study-eapp.ts).
 * A value the transform cannot read yields no write (the field is skipped).
 */
export type FillTransform =
  | 'date_year'
  | 'date_month'
  | 'date_day'
  | 'ircc_country'
  | 'strip_dashes'
  | 'digits'
  | 'na_phone'
  | 'whole_number'
  | 'date_month_name'
  | 'date_day_padded'
  | 'eta_country_code'
  | 'eta_nationality'
  | 'eta_place_country'
  | 'ircc_medical_number'
  | 'plain_words'
  | 'ircc_text'
  | 'eapp_month';

export interface FillFieldMapping {
  /** Key in the applicant profile. */
  profileKey: string;
  /** Portal page (URL path) the selector lives on; see PreflightMappingInput.page. */
  page?: string;
  transform?: FillTransform;
  selector: string;
  action: 'fill' | 'select';
  /**
   * Radio questions: answer → the input to click (IRCC: `…-01-input` Yes,
   * `…-02-input` No). The answer is the value written and shown; `selector`
   * is then only the question's name, for reading.
   */
  choices?: Readonly<Record<string, string>>;
  /** Non-value operation (radio, checkbox, option by text, dialog). */
  op?: PortalFillOp;
  /** Revealed by an earlier step on the page; waited for, never probed. */
  reveal?: boolean;
  /** Lives inside the open "add row" dialog. */
  dialog?: boolean;
  /**
   * A <select> (op 'select_text') whose option list loads only after an
   * earlier answer (IRCC eTA job title: 1–5 s after the occupation group).
   * The probe counts it present while disabled for loading, and the
   * extension waits for the option before choosing it. Every other select
   * fails at once when its option is not listed. Part of the lock hash.
   */
  awaitOptions?: boolean;
  /** A legal declaration: only ever answered from the applicant's explicit answer. */
  declaration?: boolean;
  /**
   * Derive the raw value when the profile has nothing under `profileKey`. For
   * value writes a value stored under `profileKey` itself (a correction on the
   * saved form, the consultant's edit) always wins, blank included. For
   * radio / checkbox / option-text writes the derivation always runs and must
   * read `profileKey` itself first: an answer arrives as true, "no", "Yes",
   * "married"…, and only the derivation knows the portal's answer for it.
   */
  derive?: (p: Record<string, unknown>) => unknown;
  /** Longest value the portal accepts; a longer one is not written. */
  maxLength?: number;
  /**
   * Written only when the mapping with this `profileKey` (the parent radio,
   * checkbox or dialog step) is written — with `parentValue`, when given.
   * A revealed field whose parent was not answered never appears, and waiting
   * for it would stop the run.
   */
  parent?: string;
  /** One answer, or any of several (Married or Common-Law). */
  parentValue?: string | readonly string[];
  /**
   * Not listed as "left for you" when it resolves to nothing (dialog rows and
   * optional fields, whose gaps the portal's `left` notes describe better).
   */
  silent?: boolean;
  label: string;
  /**
   * Which of the six preflight review categories this field belongs to. The
   * consultant ticks one check per category, so every writable field must
   * declare the category whose sign-off covers it — a field with no category
   * could be written without anyone having reviewed it.
   */
  category: PreflightCategory;
  /**
   * The control's QUESTION, for portals that reuse one id for different
   * questions on one URL (IRCC's secure-account questionnaire "eapp": every
   * screen is /eapp/eapp and `answerlist[0]` is a different question on each).
   * The control is the one `selector` names whose own label (label[for],
   * a wrapping label, aria-label / aria-labelledby, its fieldset's legend)
   * matches. On a screen showing another question it resolves to nothing, so
   * the write waits for a later screen instead of landing on the wrong
   * question. Absent: the selector alone decides (every other portal).
   * Composed into the selector string (`scopedSelector`), so it is part of
   * the lock hash and reaches the extension with no protocol change.
   */
  labelMatch?: RegExp;
  /**
   * Like `labelMatch`, for a control whose own label is not the question (a
   * date's year select, one radio answer): the page must show text matching
   * this somewhere (labels, legends, headings, paragraphs).
   */
  pageMatch?: RegExp;
  /**
   * Written only on the principal applicant's own form (IRCC PR portal: every
   * person has their own IMM 5406 / IMM 5669 at the same path with the same
   * ids). Composed into the selector as `>> principal`; the extension resolves
   * it from Section A's checked "Yourself (the principal applicant)" radio and
   * the form's `documentId` (resolve-target.ts principalFormHere). Part of the
   * lock hash.
   */
  principalForm?: boolean;
  /**
   * A box that may already hold someone's answer (an inline row): a
   * different non-empty value is not overwritten, the run stops there
   * (`>> keep`, extension content.ts). Part of the lock hash.
   */
  keepExisting?: boolean;
  /**
   * Lives in the IRCC PR profile's inline "Add dependant" form (opened by an
   * op 'dependant_open' entry). Composed into the selector as `>> dependant`:
   * the extension resolves it inside that one open form only — the form
   * reuses ids of the principal's own profile (`#personalDetailsForm-dob`,
   * live 2026-10-20), so a page-wide lookup could write the principal's
   * date of birth. Part of the lock hash.
   */
  dependantForm?: boolean;
  /**
   * Entries that stand or fall together (one repeating section): excluding
   * any one of them from the fill (the consultant's "not applicable")
   * excludes them all, so a section is never half-filled.
   */
  group?: string;
  /** Optional gate: only emit when this other profile key is truthy. */
  requires?: string;
  /**
   * Optional gate on the whole profile, checked BEFORE any value is read —
   * so a value stored under the mapping's own key (the saved form, a
   * consultant's correction) cannot bypass it the way it bypasses `derive`.
   * For two entries that share a key but write different selectors (PR
   * portal mailing boxes: plain ids vs `>> nth=1/2`): exactly one may hold.
   */
  onlyIf?: (p: Record<string, unknown>) => boolean;
  /**
   * The selector was not read off the live portal (it came from the portal's
   * source, or is inferred). It is never probed — a page missing it still
   * fills its verified fields — but waited for like a revealed field, so a
   * control that is not there halts the run at this write instead of writing
   * somewhere else. Place unverified writes last on their page.
   */
  unverified?: boolean;
}

/**
 * A field on a portal page the assistant does not fill, listed so the
 * applicant knows it is theirs (the readback gate's "left for you").
 */
export interface ManualFieldNote {
  page: string;
  label: string;
  reason: PortalFillLeftReason;
  note?: string;
  /** Only listed when this returns true for the profile (default: always). */
  when?: (p: Record<string, unknown>) => boolean;
}

/** Portal page metadata: order and title, for coverage and "next page". */
export interface PortalPageInfo {
  page: string;
  title: string;
  /**
   * One page whose questions appear as earlier ones are answered and as the
   * applicant presses the portal's own Next (IRCC eTA: the path never
   * changes). A run fills the targets on the page now, looks again for what
   * its writes revealed, and leaves the rest for a later launch, instead of
   * refusing the page because most of its targets are not there yet.
   */
  progressive?: boolean;
}

export type PortalFillMapping = FillFieldMapping[];

/**
 * Separator of a scoped selector: `<css> >> label=/re/flags >> page=/re/flags`.
 * The extension's resolve-target.ts parses exactly this shape; a selector
 * without it is plain CSS, as before.
 */
export const SCOPE_SEPARATOR = ' >> ';

function scopePart(kind: 'label' | 'page', re: RegExp): string {
  if (re.source.includes(SCOPE_SEPARATOR.trim()))
    throw new Error(
      `a ${kind} match may not contain "${SCOPE_SEPARATOR.trim()}"`,
    );
  // Case-insensitive always; g / y would make RegExp.test stateful.
  const flags = [...new Set(['i', ...re.flags.replace(/[gy]/g, '')])].join('');
  return `${kind}=/${re.source}/${flags}`;
}

/**
 * The option a scoped <select> write chooses, by value (a recorded code) or
 * by its visible text. In the selector, the extension's probe checks the
 * option is listed BEFORE anything on the screen is written, so a list that
 * changed is reported up front instead of stopping the screen half-filled.
 */
export interface ScopedOption {
  by: 'value' | 'text';
  value: string;
}

/** The selector a mapping entry writes to: CSS plus its question scope, if any. */
export function scopedSelector(
  css: string,
  labelMatch?: RegExp,
  pageMatch?: RegExp,
  option?: ScopedOption,
  principalForm = false,
  keepExisting = false,
  dependantForm = false,
): string {
  const parts = [css];
  if (labelMatch) parts.push(scopePart('label', labelMatch));
  if (pageMatch) parts.push(scopePart('page', pageMatch));
  if (principalForm) parts.push('principal');
  if (keepExisting) parts.push('keep');
  if (dependantForm) parts.push('dependant');
  if (option) {
    if (
      option.value.includes(SCOPE_SEPARATOR.trim()) ||
      /[\r\n]/.test(option.value)
    )
      throw new Error('an option may not contain ">>" or a line break');
    parts.push(`option=${option.by}:${option.value}`);
  }
  return parts.join(SCOPE_SEPARATOR);
}

export interface PortalFillExtras {
  pages?: PortalPageInfo[];
  /**
   * What the applicant fills themselves, given this (normalized) profile and
   * the profile keys the consultant excluded from the fill in the review.
   */
  left?: (
    p: Record<string, unknown>,
    exclude?: ReadonlySet<string>,
  ) => ManualFieldNote[];
  /**
   * Profile normalization run before any mapping reads a value. `raw` is the
   * profile before the universal normalization (stay dates, composed purpose).
   */
  normalize?: (
    p: Record<string, unknown>,
    raw: Record<string, unknown>,
  ) => Record<string, unknown>;
}

const extras = new Map<string, PortalFillExtras>();

const mappings = new Map<string, PortalFillMapping>();

export function registerPortalFill(
  portalId: string,
  mapping: PortalFillMapping,
  more: PortalFillExtras = {},
): void {
  // Page titles, order and the progressive flag are looked up by page key
  // across every portal (the extension reports a URL path, not a portal), so
  // two portals must never register the same page key with different page
  // info. The one exception is one physical page two portal ids both fill
  // with the same title and progressive flag (IRCC's secure-account
  // questionnaire /eapp/eapp: 'ircc-study' and 'ircc-work'), where every
  // lookup by page key gives the same answer whichever portal it finds.
  for (const [other, ex] of extras) {
    if (other === portalId) continue;
    const clash = more.pages?.find((p) =>
      ex.pages?.some(
        (q) =>
          q.page === p.page &&
          (q.title !== p.title ||
            (q.progressive === true) !== (p.progressive === true)),
      ),
    );
    if (clash)
      throw new Error(
        `portal page "${clash.page}" is registered by both '${other}' and '${portalId}'`,
      );
  }
  mappings.set(portalId, mapping);
  extras.set(portalId, more);
  extrasByMapping.set(mapping, more);
}

const extrasByMapping = new WeakMap<PortalFillMapping, PortalFillExtras>();

/** Pages, manual notes and normalization registered with a mapping. */
export function portalFillExtras(
  mapping: PortalFillMapping | undefined,
): PortalFillExtras {
  return (mapping && extrasByMapping.get(mapping)) ?? {};
}

export function resolvePortalFillExtras(portalId: string): PortalFillExtras {
  return extras.get(portalId) ?? {};
}

export function resolvePortalFill(
  portalId: string,
): PortalFillMapping | undefined {
  return mappings.get(portalId);
}

const variants = new Map<string, PortalFillMapping>();
const variantKey = (portalId: string, visaaiId: string) =>
  `${portalId}#${visaaiId}`;

/**
 * A route's own mapping on a portal it shares with other routes. The portal
 * itself is chosen per route by the country strategy (`portalForRoute`: a
 * Canada eTA files on 'ircc-eta'); a variant covers routes that file on the
 * SAME portal but answer some of its questions differently (IRCC tr-rt: the
 * visitor visa and the super visa). Resolved by `resolvePortalFillFor`.
 *
 * A variant is the same portal, so it shares the portal's page keys: it is
 * kept apart from the per-portal page registry (titles, order, progressive),
 * which keeps describing the portal itself. Its own pages and notes still
 * reach coverage through `portalFillExtras(mapping)`.
 */
export function registerPortalFillVariant(
  portalId: string,
  visaaiId: string,
  mapping: PortalFillMapping,
  more: PortalFillExtras = {},
): void {
  if (!mappings.has(portalId))
    throw new Error(
      `register the '${portalId}' mapping before its '${visaaiId}' variant`,
    );
  variants.set(variantKey(portalId, visaaiId), mapping);
  extrasByMapping.set(mapping, more);
}

/**
 * The mapping for this portal and registry visa type (`visa_types.visaai_id`):
 * the route's own variant when one is registered, the portal's mapping
 * otherwise.
 */
export function resolvePortalFillFor(
  portalId: string,
  visaaiId?: string | null,
): PortalFillMapping | undefined {
  const variant = visaaiId
    ? variants.get(variantKey(portalId, visaaiId))
    : undefined;
  return variant ?? mappings.get(portalId);
}

export function isPortalFillRegistered(portalId: string): boolean {
  return mappings.has(portalId);
}

/** Title of a portal page from any registered mapping's page list. */
export function portalPageTitle(page: string): string | null {
  for (const more of extras.values()) {
    const hit = more.pages?.find((p) => p.page === page);
    if (hit) return hit.title;
  }
  return null;
}

/** Whether a registered portal page reveals its targets progressively. */
export function isProgressivePage(page: string): boolean {
  for (const more of extras.values()) {
    const hit = more.pages?.find((p) => p.page === page);
    if (hit) return hit.progressive === true;
  }
  return false;
}

/** The registered page order (paths) of the portal that has this page. */
export function portalPageOrder(page: string): string[] {
  for (const more of extras.values()) {
    if (more.pages?.some((p) => p.page === page))
      return more.pages.map((p) => p.page);
  }
  return [];
}

/** Whether a parent's written answer opens a follow-up gated on `want`. */
export function parentValueMatches(
  written: string,
  want: string | readonly string[] | undefined,
): boolean {
  if (want == null) return true;
  return typeof want === 'string' ? written === want : want.includes(written);
}
