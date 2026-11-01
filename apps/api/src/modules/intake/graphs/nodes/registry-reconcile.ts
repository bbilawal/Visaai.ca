/**
 * Bring an application's REGISTRY-DERIVED checklist rows in line with the
 * registry as it stands now.
 *
 * WHY
 *
 * `update-checklist` only ever adds. A correction to the sourced registry —
 * a relabelled requirement, a content rule reclassified from `evidence` to
 * `condition`, an alternative ("Option 2") that stopped being its own upload
 * slot — therefore never reached an application whose checklist was already
 * built. Prod app 61f16bb5 (super visa, 2026-10-16) kept a slot titled "The
 * invitation letter must state the family-size list…" that nobody can upload
 * and that blocked "Generate my forms".
 *
 * WHAT IT TOUCHES
 *
 * Only document rows the registry itself put there (`base_requirement`, and
 * `base_conditional` "may be required" rows). Forms, discovery and
 * strengthening suggestions, family-gap requests and anything else are never
 * touched. A stale row the applicant already uploaded into is KEPT — deleting
 * it would cascade their file away — but demoted to optional so it stops
 * gating anything.
 *
 * Pure: the caller does the I/O.
 */

export interface ReconcileRow {
  id: string;
  document_type: string;
  label?: string | null;
  required?: boolean | null;
  added_reason?: string | null;
  meta?: Record<string, unknown> | null;
}

/** A registry document as `convertRegistryToFramework` emits it. */
export interface SourcedDocument {
  type: string;
  label: string;
  owner?: 'applicant' | 'sponsor';
  specs?: Record<string, string>;
  required?: boolean;
  validity_months?: number;
}

export interface ReconcilePlan {
  updates: Array<{ id: string; values: Record<string, unknown> }>;
  deletes: string[];
}

const RECONCILED_REASONS = new Set(['base_requirement', 'base_conditional']);

export function isReconciledRow(row: ReconcileRow): boolean {
  const kind = (row.meta ?? {}).kind;
  return RECONCILED_REASONS.has(row.added_reason ?? '') && kind !== 'form';
}

/** The meta a sourced document should carry, preserving unrelated keys. */
export function sourcedDocumentMeta(
  doc: SourcedDocument,
  existing: Record<string, unknown> | null | undefined = {},
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(existing ?? {}) };
  delete rest.specs;
  delete rest.owner;
  delete rest.min_validity_months;
  delete rest.may_be_required;
  delete rest.depends_on;
  const specs = compact(doc.specs);
  return {
    ...rest,
    kind: 'document',
    owner: doc.owner === 'sponsor' ? 'sponsor' : 'applicant',
    ...(specs ? { specs } : {}),
    ...(doc.validity_months
      ? { min_validity_months: doc.validity_months }
      : {}),
  };
}

export function planRegistryReconcile(
  rows: ReconcileRow[],
  documents: SourcedDocument[],
  undeterminedTypes: Iterable<string>,
  usedItemIds: ReadonlySet<string>,
): ReconcilePlan {
  const byType = new Map(documents.map((d) => [d.type, d]));
  const undetermined = new Set(undeterminedTypes);
  const plan: ReconcilePlan = { updates: [], deletes: [] };

  for (const row of rows) {
    if (!isReconciledRow(row)) continue;
    const doc = byType.get(row.document_type);

    if (!doc) {
      // Still possibly required — the applicant has not answered what decides
      // it. Leave it exactly as it is.
      if (undetermined.has(row.document_type)) continue;
      if (usedItemIds.has(row.id)) {
        if (row.required !== false) {
          plan.updates.push({ id: row.id, values: { required: false } });
        }
      } else {
        plan.deletes.push(row.id);
      }
      continue;
    }

    // A "may be required" row whose rule has resolved is promoted by the
    // caller's own path; reconcile only maintains settled sourced rows.
    if (row.added_reason !== 'base_requirement') continue;

    const values: Record<string, unknown> = {};
    const wantRequired = doc.required !== false;
    if (typeof row.required === 'boolean' && row.required !== wantRequired) {
      values.required = wantRequired;
    }
    if (typeof row.label === 'string' && row.label !== doc.label) {
      values.label = doc.label;
    }
    if (row.meta) {
      const want = sourcedDocumentMeta(doc, row.meta);
      // An absent owner already means the applicant.
      const have = { owner: 'applicant', ...row.meta };
      if (!sameJson(have, want)) values.meta = want;
    }
    if (Object.keys(values).length > 0) {
      plan.updates.push({ id: row.id, values });
    }
  }
  return plan;
}

function compact(
  specs?: Record<string, string> | null,
): Record<string, string> | undefined {
  if (!specs) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function sameJson(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
