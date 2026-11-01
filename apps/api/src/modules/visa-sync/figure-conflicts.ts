/**
 * Detect the same monetary figure stored under conflicting temporal qualifiers.
 *
 * WHY THIS EXISTS
 *
 * Migrationsverket publishes the same six maintenance amounts - SEK 6,243 /
 * 10,314 / 3,336 / 4,004 / 4,672 / 5,339 - on two pages, introducing them on one
 * as "for 2025, the amount you must have left after paying your rent is:" and on
 * the other as "in 2026, the amount you must have left over after tax and the
 * rent is paid is:". Same authority, identical numbers, two different years. One
 * page is stale and neither says which.
 *
 * Both extractions verify perfectly. `verify-excerpts.ts` confirms each quote is
 * on its page; `verify-extraction-bounds.ts` confirms each came from the right
 * section. Neither can see the contradiction, because each file is individually
 * correct - the conflict exists only BETWEEN files.
 *
 * It was caught because I happened to read the sentence introducing the figures
 * rather than only the figures. That is not a control. This is.
 *
 * WHAT COUNTS AS A CONFLICT
 *
 * The same parameter key holding the same value in two extractions of the SAME
 * destination, where the temporal qualifiers disagree. Scoped to one destination
 * on purpose: two countries sharing a number is coincidence, and flagging that
 * would bury the real signal in noise.
 *
 * A missing qualifier on one side is NOT a conflict. Most figures carry no year
 * at all, and demanding one everywhere would turn this into a style checker.
 */

/** Parameter keys that date a figure rather than measure one. */
const TEMPORAL_KEYS = [
  'stated_for_year',
  'in_force_since',
  'in_force_from',
  'edition_date',
] as const;

export interface ExtractionFile {
  /** Filename or path, used only for reporting. */
  file: string;
  visaai_id: string;
  requirements: Array<{
    requirement_code: string;
    parameters?: Record<string, unknown> | null;
  }>;
}

export interface FigureConflict {
  /** Destination prefix shared by the conflicting files, e.g. "se". */
  destination: string;
  parameterKey: string;
  value: number;
  /** Every qualified sighting of the figure, sorted for stable output. */
  sides: Array<{
    file: string;
    requirement_code: string;
    qualifier: string;
    qualifierValue: string;
  }>;
}

/** "se-eu-blue-card" -> "se". Destination is the segment before the first dash. */
export function destinationOf(visaaiId: string): string {
  const dash = visaaiId.indexOf('-');
  return dash === -1 ? visaaiId : visaaiId.slice(0, dash);
}

/** The temporal qualifier on a parameter bag, if it carries one. */
function qualifierOf(
  parameters: Record<string, unknown>,
): { key: string; value: string } | null {
  for (const key of TEMPORAL_KEYS) {
    const v = parameters[key];
    if (typeof v === 'number' || typeof v === 'string')
      return { key, value: String(v) };
  }
  return null;
}

export function findFigureConflicts(files: ExtractionFile[]): FigureConflict[] {
  // (destination, key, value) -> the qualified sightings of that figure.
  const seen = new Map<string, FigureConflict['sides']>();
  const meta = new Map<
    string,
    { destination: string; parameterKey: string; value: number }
  >();

  for (const doc of files) {
    const destination = destinationOf(doc.visaai_id);
    for (const req of doc.requirements ?? []) {
      const p = req.parameters;
      if (!p) continue;
      const qualifier = qualifierOf(p);
      // No qualifier means nothing to contradict. Most figures are like this.
      if (!qualifier) continue;

      for (const [key, value] of Object.entries(p)) {
        if (typeof value !== 'number') continue;
        if ((TEMPORAL_KEYS as readonly string[]).includes(key)) continue;

        const id = `${destination} ${key} ${value}`;
        if (!meta.has(id))
          meta.set(id, { destination, parameterKey: key, value });
        const sides = seen.get(id) ?? [];
        sides.push({
          file: doc.file,
          requirement_code: req.requirement_code,
          qualifier: qualifier.key,
          qualifierValue: qualifier.value,
        });
        seen.set(id, sides);
      }
    }
  }

  const conflicts: FigureConflict[] = [];
  for (const [id, sides] of seen) {
    const distinct = new Set(
      sides.map((s) => `${s.qualifier}=${s.qualifierValue}`),
    );
    // One agreed qualifier is the healthy case: the same figure restated
    // consistently across two routes of the same destination.
    if (distinct.size < 2) continue;
    const m = meta.get(id)!;
    conflicts.push({
      ...m,
      sides: [...sides].sort((a, b) =>
        `${a.file}${a.requirement_code}`.localeCompare(
          `${b.file}${b.requirement_code}`,
        ),
      ),
    });
  }

  return conflicts.sort((a, b) =>
    `${a.destination}${a.parameterKey}${a.value}`.localeCompare(
      `${b.destination}${b.parameterKey}${b.value}`,
    ),
  );
}

/** Stable identity for allowlisting a conflict that has been reviewed. */
export function conflictKey(c: FigureConflict): string {
  return `${c.destination}:${c.parameterKey}:${c.value}`;
}
