import type { SupabaseClient } from '@supabase/supabase-js';
import { plannedStay } from '@visaai/types';
import { identityRole } from './graphs/nodes/identity-compare';
import {
  isApplicantPhotoType,
  isPhotoDocumentType,
  resolveExtractionType,
} from './ocr/extraction-schema';
import {
  choosePolicy,
  readPolicy,
  type StayDates,
} from '../shared/profile/insurance-policy';

/**
 * Put already-uploaded files into the checklist slot they belong to, and keep
 * each slot's status honest about the files it holds.
 *
 * Upload-time matching (DocumentsService) only sees the checklist as it is at
 * that moment. When a slot appears LATER — a registry correction, an intake
 * answer that adds a requirement — a file the applicant already gave us sits
 * in "Additional document" while its slot says "Needed". Prod app 61f16bb5
 * (super visa, 2026-10-16): passport and insurance policy, both classified
 * correctly, both unlinked.
 *
 * Only a document with a KNOWN type is linked, never to a form, and each slot
 * takes at most one file per pass: an automatic link is a guess from the
 * classifier, and one wrong guess in a slot is easier to spot than several.
 *
 * Which file, when several fit: the one that passes its expiry check, then an
 * unchecked one, and an expired one only when it is all there is. Between
 * insurance policies the expiry check cannot separate, the one covering the
 * planned stay (choosePolicy). Same app, after the super visa v2 rebuild: the
 * medical_insurance slot took the 21st Century policy that expired 2026-05-31
 * — the first one uploaded — and the covering DUMMY policy (2027-03-01 →
 * 2028-03-01) stayed unlinked. A slot whose only files failed expiry is
 * therefore still OPEN to a valid file, even though it reads 'uploaded'.
 *
 * And the slot's status: 'verified' needs a read file that passed identity AND
 * did not fail expiry. That slot read 'verified' on the expired policy alone.
 */

export interface OrphanDoc {
  id: string;
  document_type: string | null;
  checklist_item_id: string | null;
  /** documents.expiry_status: pass | warn | fail | unknown | null. */
  expiry_status?: string | null;
  /** Extracted fields — only used to compare insurance policies. */
  fields?: Record<string, unknown> | null;
}

export interface SlotItem {
  id: string;
  document_type: string;
  status: string;
  meta?: Record<string, unknown> | null;
}

function fits(docType: string, slotType: string): boolean {
  if (docType === slotType) return true;
  // A passport is not a photo, nor a photo a passport: `passport` prefixes
  // `passport_photos` (prod 2026-10-24). The applicant's photo fits any
  // applicant-photo slot (`photo` -> `passport_photos`); a wedding photo or a
  // snapshot together only fits its own slot.
  const photoDoc = isPhotoDocumentType(docType);
  if (photoDoc !== isPhotoDocumentType(slotType)) return false;
  const applicantDoc = isApplicantPhotoType(docType);
  if (applicantDoc !== isApplicantPhotoType(slotType)) return false;
  if (applicantDoc) return true;
  if (photoDoc) return slotType.startsWith(`${docType}_`);
  if (slotType.startsWith(`${docType}_`)) return true; // passport -> passport_copy
  const a = resolveExtractionType(docType);
  const b = resolveExtractionType(slotType);
  return a !== null && a === b;
}

function isFormSlot(i: SlotItem): boolean {
  return (
    (i.meta ?? {}).kind === 'form' ||
    String(i.document_type).startsWith('form_')
  );
}

/** pass > warn > not (yet) checked > fail. */
function expiryRank(status: string | null | undefined): number {
  if (status === 'pass') return 3;
  if (status === 'warn') return 2;
  if (status === 'fail') return 0;
  return 1;
}

const NO_STAY: StayDates = { entryDate: null, departureDate: null };

function pickBest(cands: OrphanDoc[], stay: StayDates): OrphanDoc {
  const top = Math.max(...cands.map((d) => expiryRank(d.expiry_status)));
  const group = cands.filter((d) => expiryRank(d.expiry_status) === top);
  if (
    group.length > 1 &&
    group.every(
      (d) =>
        /insurance/.test(d.document_type ?? '') &&
        d.fields &&
        Object.keys(d.fields).length > 0,
    )
  ) {
    const policies = group.map((d) => readPolicy(d.fields ?? {}, stay));
    const chosen = choosePolicy(policies);
    const at = chosen ? policies.indexOf(chosen) : -1;
    if (at >= 0) return group[at];
  }
  return group[0];
}

/**
 * Which unattached documents go into which slot. `docs` may include linked
 * documents: they are never moved, but they tell the planner which slots hold
 * only expired files.
 */
export function planOrphanLinks(
  docs: OrphanDoc[],
  items: SlotItem[],
  stay: StayDates = NO_STAY,
): Array<{ documentId: string; itemId: string }> {
  const held = new Map<string, OrphanDoc[]>();
  for (const d of docs) {
    if (!d.checklist_item_id) continue;
    held.set(d.checklist_item_id, [
      ...(held.get(d.checklist_item_id) ?? []),
      d,
    ]);
  }

  const claimed = new Set<string>();
  const links: Array<{ documentId: string; itemId: string }> = [];
  for (const slot of items) {
    if (slot.status === 'waived' || isFormSlot(slot)) continue;
    const files = held.get(slot.id) ?? [];
    const expiredOnly =
      files.length > 0 && files.every((d) => d.expiry_status === 'fail');
    // A missing slot takes the best file there is. A slot holding only
    // expired files takes a file that is not expired — never another
    // expired one. Any other slot is satisfied.
    const requireValid = slot.status !== 'missing';
    if (requireValid && !expiredOnly) continue;

    const slotType = slot.document_type.toLowerCase();
    const cands = docs.filter((d) => {
      if (d.checklist_item_id || claimed.has(d.id)) return false;
      const type = (d.document_type ?? '').toLowerCase().trim();
      if (identityRole(type) === 'generic' || type.startsWith('form_'))
        return false;
      if (requireValid && d.expiry_status === 'fail') return false;
      return fits(type, slotType);
    });
    if (cands.length === 0) continue;
    const best = pickBest(cands, stay);
    claimed.add(best.id);
    links.push({ documentId: best.id, itemId: slot.id });
  }
  return links;
}

export interface SlotFile {
  ocr_status?: string | null;
  expiry_status?: string | null;
  /** The latest identity verification passed. */
  identityPass: boolean;
}

/**
 * What a slot's status should be, from the files linked to it. 'verified'
 * needs one read file that passed identity and did not fail expiry;
 * `expiredOnly` says every file failed expiry (the reason to tell the user).
 */
export function slotStatusFor(files: SlotFile[]): {
  status: 'missing' | 'uploaded' | 'verified';
  expiredOnly: boolean;
} {
  if (files.length === 0) return { status: 'missing', expiredOnly: false };
  const expiredOnly = files.every((f) => f.expiry_status === 'fail');
  const verified = files.some(
    (f) =>
      f.ocr_status === 'complete' &&
      f.identityPass &&
      f.expiry_status !== 'fail',
  );
  return { status: verified ? 'verified' : 'uploaded', expiredOnly };
}

interface DocRow extends OrphanDoc {
  ocr_status?: string | null;
  file_name?: string | null;
}

interface VerificationRow {
  document_id: string;
  verification_type: string;
  result: string;
  details_json?: Record<string, unknown> | null;
  verified_at?: string | null;
}

/** The newest row of one type per document (re-reads add rows). */
function latestByDoc(
  rows: VerificationRow[],
  type: string,
): Map<string, VerificationRow> {
  const out = new Map<string, VerificationRow>();
  for (const v of rows) {
    if (v.verification_type !== type) continue;
    const prev = out.get(v.document_id);
    if (!prev || (v.verified_at ?? '') >= (prev.verified_at ?? ''))
      out.set(v.document_id, v);
  }
  return out;
}

const ATTENTION_SOURCE = 'expiry';

function expiryNotice(files: DocRow[], expiry: Map<string, VerificationRow>) {
  const parts = files.map((d) => {
    const basis = expiry.get(d.id)?.details_json?.basis;
    const why =
      typeof basis === 'string' && basis.trim()
        ? basis.trim()
        : 'it is not valid for the required period';
    return `“${d.file_name ?? 'The uploaded file'}” failed the validity check (${why})`;
  });
  return `${parts.join('; ')}. Upload a document that is valid for your planned stay.`;
}

/**
 * Link orphans for one application, then settle the status of every slot that
 * holds files. Best-effort: returns how many it linked, never throws. Runs
 * after every document read (sync_checklist) and every checklist rebuild
 * (update_checklist), so an application already in a bad state corrects on
 * the next of either.
 */
export async function linkOrphanDocuments(
  supabase: SupabaseClient,
  applicationId: string,
): Promise<number> {
  try {
    const { data: docRows } = await supabase
      .from('documents')
      .select(
        'id, document_type, checklist_item_id, ocr_status, expiry_status, file_name',
      )
      .eq('application_id', applicationId);
    const docs = (docRows ?? []) as DocRow[];
    if (docs.length === 0) return 0;

    const { data: itemRows } = await supabase
      .from('checklist_items')
      .select('id, document_type, status, meta')
      .eq('application_id', applicationId);
    const items = (itemRows ?? []) as SlotItem[];
    if (items.length === 0) return 0;

    const { data: vRows } = await supabase
      .from('document_verifications')
      .select(
        'document_id, verification_type, result, details_json, verified_at',
      )
      .in(
        'document_id',
        docs.map((d) => d.id),
      );
    const verifications = (vRows ?? []) as VerificationRow[];
    const identity = latestByDoc(verifications, 'identity');
    const expiry = latestByDoc(verifications, 'expiry');
    for (const d of docs) {
      const f = identity.get(d.id)?.details_json?.extracted_fields;
      d.fields =
        f && typeof f === 'object' && !Array.isArray(f)
          ? (f as Record<string, unknown>)
          : null;
    }

    // The planned stay only matters when two policies compete.
    const orphanPolicies = docs.filter(
      (d) => !d.checklist_item_id && /insurance/.test(d.document_type ?? ''),
    );
    let stay = NO_STAY;
    if (orphanPolicies.length > 1) {
      const { data: prof } = await supabase
        .from('application_profiles')
        .select('profile_json')
        .eq('application_id', applicationId);
      const raw = ((prof ?? []) as Array<{ profile_json?: unknown }>)[0]
        ?.profile_json;
      const p = plannedStay(
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : null,
      );
      stay = { entryDate: p.entryDate, departureDate: p.departureDate };
    }

    const links = planOrphanLinks(docs, items, stay);
    const newlyLinked = new Set<string>();
    let linked = 0;
    for (const link of links) {
      const { error } = await supabase
        .from('documents')
        .update({ checklist_item_id: link.itemId })
        .eq('id', link.documentId)
        .eq('application_id', applicationId);
      if (error) continue;
      const doc = docs.find((d) => d.id === link.documentId);
      if (doc) doc.checklist_item_id = link.itemId;
      newlyLinked.add(link.itemId);
      linked++;
    }

    for (const slot of items) {
      if (slot.status === 'waived' || isFormSlot(slot)) continue;
      const files = docs.filter((d) => d.checklist_item_id === slot.id);
      if (files.length === 0) continue;
      const { status, expiredOnly } = slotStatusFor(
        files.map((d) => ({
          ocr_status: d.ocr_status,
          expiry_status: d.expiry_status,
          identityPass: identity.get(d.id)?.result === 'pass',
        })),
      );

      // Which slots this pass may re-status: one it just filled, and one
      // holding files (uploaded/verified) whose files all failed expiry or
      // that carries our own expiry notice. A slot re-opened as the wrong
      // document ('missing' with a file) is left to sync_checklist.
      const meta = { ...(slot.meta ?? {}) };
      const ownNotice = meta.attention_source === ATTENTION_SOURCE;
      const held = slot.status === 'uploaded' || slot.status === 'verified';
      let next = slot.status;
      if (newlyLinked.has(slot.id)) next = status;
      else if (held && expiredOnly) next = 'uploaded';
      else if (held && ownNotice) next = status;

      let metaChanged = false;
      if (expiredOnly && (held || newlyLinked.has(slot.id))) {
        if (!meta.needs_attention || ownNotice) {
          const message = expiryNotice(files, expiry);
          if (!ownNotice || meta.attention_message !== message) {
            meta.needs_attention = true;
            meta.attention_message = message;
            meta.attention_source = ATTENTION_SOURCE;
            metaChanged = true;
          }
        }
      } else if (ownNotice) {
        delete meta.needs_attention;
        delete meta.attention_message;
        delete meta.attention_source;
        metaChanged = true;
      }

      if (next === slot.status && !metaChanged) continue;
      const values: Record<string, unknown> = { status: next };
      if (metaChanged) values.meta = meta;
      await supabase
        .from('checklist_items')
        .update(values)
        .eq('id', slot.id)
        .eq('application_id', applicationId);
    }
    return linked;
  } catch (err) {
    console.warn(
      '[slot-link] orphan linking skipped:',
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}
