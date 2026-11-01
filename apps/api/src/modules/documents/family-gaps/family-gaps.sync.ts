import type { SupabaseClient } from '@supabase/supabase-js';
import type { FamilyDocumentGapRoute } from '../../../strategies/document-requirements/family-document-gaps.config';
import { safeLog } from '../../shared/log/redact';
import {
  FAMILY_GAP_REASON_PREFIX,
  familyDocumentGaps,
  familyGapRouteFor,
  type FamilyGapItem,
} from './family-gaps';

/**
 * Write the family-gap checklist items (family-gaps.ts) for one application —
 * idempotently, so every place the checklist or the profile changes can call
 * it: the intake checklist rebuild and the document pipeline's sync_profile.
 *
 *  - a gap with no row gets one (status `missing`, required);
 *  - a gap whose row exists keeps it — label and guidance are refreshed, the
 *    status is never touched;
 *  - a row whose gap has CLOSED (the data arrived) is deleted when nothing is
 *    attached to it; when a document is attached it is kept and its
 *    needs-attention marker cleared — the upload is the client's, and removing
 *    the slot would orphan it.
 *
 * Only rows with an `added_reason` of `family_gap:*` are ever read or written.
 */

export interface FamilyGapSyncResult {
  added: string[];
  updated: string[];
  removed: string[];
}

interface GapRow {
  id: string;
  label: string;
  status: string;
  added_reason: string | null;
  meta: Record<string, unknown> | null;
}

function keyOf(row: GapRow): string | null {
  const gap = row.meta?.family_gap as { key?: unknown } | undefined;
  return typeof gap?.key === 'string' ? gap.key : null;
}

/** Stable JSON for comparing meta objects regardless of key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** A closed gap's row that a document still fills: no longer asks for attention. */
function resolvedMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const { needs_attention: _n, attention_message: _m, ...rest } = meta;
  return {
    ...rest,
    family_gap: {
      ...(meta.family_gap && typeof meta.family_gap === 'object'
        ? meta.family_gap
        : {}),
      resolved: true,
    },
  };
}

export async function syncFamilyGapItems(
  db: SupabaseClient,
  params: {
    applicationId: string;
    profile: Record<string, unknown>;
    route: FamilyDocumentGapRoute | null;
  },
): Promise<FamilyGapSyncResult> {
  const { applicationId, profile, route } = params;
  const result: FamilyGapSyncResult = { added: [], updated: [], removed: [] };
  const desired = route ? familyDocumentGaps(profile, route) : [];
  const wanted = new Map<string, FamilyGapItem>(desired.map((g) => [g.key, g]));

  const { data, error } = await db
    .from('checklist_items')
    .select('id, label, status, added_reason, meta')
    .eq('application_id', applicationId)
    .like('added_reason', `${FAMILY_GAP_REASON_PREFIX}:%`);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as GapRow[];

  // Rows for gaps that still exist (first one per key) vs everything else.
  const kept = new Map<string, GapRow>();
  const stale: GapRow[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (key && wanted.has(key) && !kept.has(key)) kept.set(key, row);
    else stale.push(row);
  }

  // 1. Open gaps without a row.
  const toInsert = desired.filter((g) => !kept.has(g.key));
  if (toInsert.length) {
    const { error: insErr } = await db.from('checklist_items').insert(
      toInsert.map((g) => ({
        application_id: applicationId,
        document_type: g.document_type,
        label: g.label,
        required: g.required,
        status: 'missing',
        added_reason: g.added_reason,
        meta: g.meta,
      })),
    );
    if (insErr) throw new Error(insErr.message);
    result.added.push(...toInsert.map((g) => g.key));
  }

  // 2. Open gaps with a row: refresh label / reason / guidance in place.
  for (const [key, row] of kept) {
    const g = wanted.get(key)!;
    if (
      row.label === g.label &&
      row.added_reason === g.added_reason &&
      stable(row.meta) === stable(g.meta)
    ) {
      continue;
    }
    const { error: upErr } = await db
      .from('checklist_items')
      .update({ label: g.label, added_reason: g.added_reason, meta: g.meta })
      .eq('id', row.id)
      .eq('application_id', applicationId);
    if (upErr) throw new Error(upErr.message);
    result.updated.push(key);
  }

  // 3. Closed gaps (and duplicates): delete when unused, else mark resolved.
  if (stale.length) {
    const { data: attached, error: docErr } = await db
      .from('documents')
      .select('checklist_item_id')
      .eq('application_id', applicationId)
      .in(
        'checklist_item_id',
        stale.map((r) => r.id),
      );
    if (docErr) throw new Error(docErr.message);
    const inUse = new Set(
      ((attached ?? []) as Array<{ checklist_item_id: string | null }>).map(
        (d) => d.checklist_item_id,
      ),
    );

    const unused = stale.filter(
      (r) => r.status === 'missing' && !inUse.has(r.id),
    );
    if (unused.length) {
      const { error: delErr } = await db
        .from('checklist_items')
        .delete()
        .in(
          'id',
          unused.map((r) => r.id),
        )
        .eq('application_id', applicationId)
        // Never a row an upload flipped in the meantime.
        .eq('status', 'missing');
      if (delErr) throw new Error(delErr.message);
      result.removed.push(...unused.map((r) => keyOf(r) ?? r.id));
    }

    for (const row of stale) {
      if (unused.includes(row)) continue;
      const meta = row.meta ?? {};
      const next = resolvedMeta(meta);
      if (stable(next) === stable(meta)) continue;
      const { error: upErr } = await db
        .from('checklist_items')
        .update({ meta: next })
        .eq('id', row.id)
        .eq('application_id', applicationId);
      if (upErr) throw new Error(upErr.message);
      result.updated.push(keyOf(row) ?? row.id);
    }
  }

  return result;
}

/** The configured family-gap route of a registry visa type, or null. */
export async function resolveFamilyGapRoute(
  db: SupabaseClient,
  visaTypeId: string | null | undefined,
): Promise<FamilyDocumentGapRoute | null> {
  if (!visaTypeId) return null;
  const { data, error } = await db
    .from('visa_types')
    .select('visaai_id')
    .eq('id', visaTypeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return familyGapRouteFor(
    (data as { visaai_id?: string | null } | null)?.visaai_id,
  );
}

/**
 * Sync one application's family-gap items, reading its route — and, unless
 * one is given, its stored profile. Best effort: never throws; returns null
 * when the sync could not run.
 */
export async function syncFamilyGapsForApplication(
  db: SupabaseClient,
  applicationId: string,
  profile?: Record<string, unknown>,
  visaTypeId?: string | null,
): Promise<FamilyGapSyncResult | null> {
  try {
    let routeVisaType = visaTypeId;
    if (routeVisaType === undefined) {
      const { data: app, error } = await db
        .from('applications')
        .select('visa_type_id')
        .eq('id', applicationId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      routeVisaType =
        (app as { visa_type_id?: string | null } | null)?.visa_type_id ?? null;
    }
    const route = await resolveFamilyGapRoute(db, routeVisaType);

    let current = profile;
    if (!current) {
      const { data: row, error } = await db
        .from('application_profiles')
        .select('profile_json')
        .eq('application_id', applicationId)
        .maybeSingle();
      // A failed read is not an empty profile: closing every gap on it would
      // delete the client's open requests.
      if (error) throw new Error(error.message);
      const raw = (row as { profile_json?: unknown } | null)?.profile_json;
      current =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
    }

    const result = await syncFamilyGapItems(db, {
      applicationId,
      profile: current,
      route,
    });
    if (result.added.length || result.updated.length || result.removed.length) {
      safeLog.warn(
        'documents.family_gaps',
        `application ${applicationId}: ${result.added.length} family document(s) requested, ` +
          `${result.updated.length} updated, ${result.removed.length} closed`,
      );
    }
    return result;
  } catch (err) {
    safeLog.warn(
      'documents.family_gaps',
      `family gap sync skipped for ${applicationId}: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
    return null;
  }
}
