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
 *  - strip_dashes: drop dashes (IRCC refuses "special characters" in a
 *    national ID number: CNIC 37405-5309209-7 → 3740553092097).
 *  - digits: keep digits only (telephone numbers).
 *  - whole_number: an amount rounded to whole units ("5,000.60" → "5001").
 * A value the transform cannot read yields no write (the field is skipped).
 */
export type FillTransform =
  | 'date_year'
  | 'date_month'
  | 'date_day'
  | 'ircc_country'
  | 'strip_dashes'
  | 'digits'
  | 'whole_number';

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
  parentValue?: string;
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
  /** Optional gate: only emit when this other profile key is truthy. */
  requires?: string;
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
}

export type PortalFillMapping = FillFieldMapping[];

export interface PortalFillExtras {
  pages?: PortalPageInfo[];
  /** What the applicant fills themselves, given this (normalized) profile. */
  left?: (p: Record<string, unknown>) => ManualFieldNote[];
  /** Profile normalization run before any mapping reads a value. */
  normalize?: (p: Record<string, unknown>) => Record<string, unknown>;
}

const extras = new Map<string, PortalFillExtras>();

const mappings = new Map<string, PortalFillMapping>();

export function registerPortalFill(
  portalId: string,
  mapping: PortalFillMapping,
  more: PortalFillExtras = {},
): void {
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

/** The registered page order (paths) of the portal that has this page. */
export function portalPageOrder(page: string): string[] {
  for (const more of extras.values()) {
    if (more.pages?.some((p) => p.page === page))
      return more.pages.map((p) => p.page);
  }
  return [];
}
