import type { PrefilledFormField } from '@visaai/types';

/**
 * The Forms page's travel-history rows (`travel_history_N_<part>`) and the
 * person edits made to them.
 *
 * The rows are rebuilt from the recorded trips on every generation, so a row
 * number names a different trip from one generation to the next. A person's
 * edit therefore follows its TRIP (country and month left), never its row
 * number: an edit to the old row 1 (then trip 8) must not land on the new
 * row 1 (trip 1). An edit whose trip is no longer recorded keeps a row of its
 * own after the others rather than being written onto another trip.
 */

export const TRIP_ROW_FIELD = /^travel_history_(\d+)_([a-z_]+)$/;

const isPerson = (f: PrefilledFormField) =>
  f.source === 'applicant' || f.source === 'consultant';

const rowOf = (f: PrefilledFormField) => {
  const m = TRIP_ROW_FIELD.exec(f.key);
  return m ? { n: Number(m[1]), part: m[2] } : null;
};

/** Country and month left: what makes a row the same trip. */
function identityOf(row: PrefilledFormField[]): string | undefined {
  const part = (p: string) =>
    String(row.find((f) => rowOf(f)?.part === p)?.value ?? '').trim();
  const country = part('country').toLowerCase();
  const from = part('from').slice(0, 7);
  return country && from ? `${country}|${from}` : undefined;
}

function byRow(fields: PrefilledFormField[]): Map<number, PrefilledFormField[]> {
  const rows = new Map<number, PrefilledFormField[]>();
  for (const f of fields) {
    const r = rowOf(f);
    if (!r) continue;
    rows.set(r.n, [...(rows.get(r.n) ?? []), f]);
  }
  return rows;
}

/**
 * The trip-row fields to carry from a stored form: every row a person edited,
 * whole, so the edit can be matched to its trip by the row's country and
 * month even when the person changed only the city.
 */
export function tripEditRows(
  stored: PrefilledFormField[],
): PrefilledFormField[] {
  return [...byRow(stored).values()]
    .filter((row) => row.some(isPerson))
    .flat();
}

const renumber = (f: PrefilledFormField, n: number): PrefilledFormField => {
  const part = rowOf(f)!.part;
  return {
    ...f,
    key: `travel_history_${n}_${part}`,
    label: f.label.replace(/^Travel history \d+/i, `Travel history ${n}`),
  };
};

/**
 * Write the person-edited trip rows in `edits` onto `fields` by trip. A row
 * that matches a trip in `fields` gets the person's parts only; a row that
 * matches none is added whole after the last trip row, in the trip rows'
 * group. Re-applying the same edits changes nothing.
 */
export function overlayTripEdits(
  fields: PrefilledFormField[],
  edits: PrefilledFormField[],
): PrefilledFormField[] {
  const groups = [...byRow(edits).values()].filter((row) => row.some(isPerson));
  if (groups.length === 0) return fields;
  const out = [...fields];
  for (const group of groups) {
    const rows = byRow(out);
    const id = identityOf(group);
    const personParts = group.filter(isPerson);
    let n: number | undefined;
    for (const [k, row] of rows) {
      const same = id
        ? identityOf(row) === id
        : personParts.every((p) =>
            row.some(
              (r) => rowOf(r)?.part === rowOf(p)?.part && r.value === p.value,
            ),
          );
      if (same) {
        n = k;
        break;
      }
    }
    const matched = n !== undefined;
    if (!matched) n = Math.max(0, ...rows.keys()) + 1;
    const tripIdx = out
      .map((f, i) => (TRIP_ROW_FIELD.test(f.key) ? i : -1))
      .filter((i) => i >= 0);
    const tripGroup = tripIdx.length ? out[tripIdx[0]].group : undefined;
    for (const f of matched ? personParts : group) {
      const g = renumber(f, n!);
      if (!matched && tripGroup) g.group = tripGroup;
      const i = out.findIndex((d) => d.key === g.key);
      if (i >= 0) {
        out[i] = g;
        continue;
      }
      const last = out.reduce(
        (acc, d, j) => (TRIP_ROW_FIELD.test(d.key) ? j : acc),
        -1,
      );
      out.splice(last >= 0 ? last + 1 : out.length, 0, g);
    }
  }
  return out;
}
