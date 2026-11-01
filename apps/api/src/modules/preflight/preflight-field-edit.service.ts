import { applyFillTransform } from '../automation/fill-transforms';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ActorRef,
  PreflightCategory,
  PreflightCheckKey,
  PreflightMappingInput,
  PreflightReview,
  PrefilledFormField,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { ProvenanceService } from '../provenance/provenance.service';
import { ConsultantApprovalService } from '../consultant/consultant-approval.service';
import { PreflightService } from './preflight.service';
import { PreflightMappingService } from './preflight-mapping.service';
import { PrefillFormStore } from './prefill-form.store';

export interface FieldEditor {
  id: string;
  appRole?: 'admin' | 'consultant' | 'user';
}

export interface FieldEditResult {
  /** Re-derived mappings — what the lock would now cover. */
  mappings: PreflightMappingInput[];
  /** The current review after any check reset (null when none exists). */
  review: PreflightReview | null;
  formUpdated: boolean;
  /** No saved form: the correction went to the interview profile. */
  profileUpdated: boolean;
  provenanceUpdated: boolean;
}

const CATEGORY_CHECK: Record<PreflightCategory, PreflightCheckKey> = {
  passport: 'passport_reviewed',
  dates: 'dates_reviewed',
  travel_history: 'travel_history_reviewed',
  addresses: 'addresses_reviewed',
  employment: 'employment_reviewed',
};

/**
 * PreflightFieldEditService — the consultant corrects a value during the
 * pre-submission review.
 *
 * One write path for both consultant surfaces (the auto-fill review list and the
 * extracted-fields table), so a correction lands in every place that matters:
 *
 *  - the SAVED APPLICATION FORM (prefilled_form_json), when the key is a form
 *    field or a portal-mapped field. The form is the source mappings are
 *    derived from (PreflightMappingService), so this is what auto-fill writes.
 *    The field is stamped `source: 'consultant'`.
 *  - FIELD PROVENANCE, when the key has a current extracted version: a new
 *    `user_entered` version supersedes it (append-only; the OCR value stays in
 *    history). Any consultant approval bound to the old value goes stale.
 *
 * Invariants kept:
 *  - only the active assignee (primary or backup) or an admin may edit;
 *  - a field the LOCK covers (a portal-mapped key) cannot change while the
 *    review is locked — the consultant must start a new review first, which
 *    retires the old lock (PreflightService.start). Unmapped fields are not
 *    covered by the lock and may be corrected at any time;
 *  - editing a mapped field un-ticks its category and the final approval, so
 *    the consultant re-confirms before locking;
 *  - every edit is audited (FIELD_EDITED, actor = the editor, value carried as
 *    a hash only).
 */
@Injectable()
export class PreflightFieldEditService {
  constructor(
    private readonly preflight: PreflightService,
    private readonly mappings: PreflightMappingService,
    private readonly forms: PrefillFormStore,
    private readonly provenance: ProvenanceService,
    private readonly consultant: ConsultantApprovalService,
    private readonly audit: AuditService,
  ) {}

  async editField(
    applicationId: string,
    editor: FieldEditor,
    fieldKey: string,
    rawValue: string,
    reason?: string,
  ): Promise<FieldEditResult> {
    if (editor.appRole !== 'admin') {
      await this.consultant.assertAssigned(applicationId, editor.id);
    }
    const value = String(rawValue ?? '').trim();
    const actor: ActorRef = {
      id: editor.id,
      role: editor.appRole === 'admin' ? 'admin' : 'consultant',
    };

    const { mapping } = await this.mappings.resolve(applicationId);
    const mapped = mapping?.find((f) => f.profileKey === fieldKey);
    const review = await this.preflight.getActive(applicationId);

    // A value the portal receives in pieces or as a code (a date → year /
    // month / day, a country → IRCC code) must be readable by every transform
    // that writes it; otherwise the edit would silently remove those writes.
    const unreadable = (mapping ?? []).find(
      (f) =>
        f.profileKey === fieldKey &&
        f.transform &&
        applyFillTransform(f.transform, value) === null,
    );
    if (unreadable) {
      const expected: Record<string, string> = {
        ircc_country: 'a country (e.g. PAK or Pakistan)',
        strip_dashes:
          'letters, numbers and spaces (other characters are removed)',
        digits: 'a number',
        whole_number: 'an amount',
        ircc_medical_number:
          'an IME number (8 digits) or a UMI number (2 letters and 8 or 9 digits, or U and 9 digits)',
      };
      throw new BadRequestException(
        `${fieldKey} must be ${expected[unreadable.transform!] ?? 'a date as YYYY-MM-DD'}.`,
      );
    }

    if (mapped && review?.status === 'completed') {
      throw new ConflictException(
        'The pre-submission review is locked, so its fields cannot change. Start a new review to edit this field — that replaces the current lock.',
      );
    }

    // An approval is bound to the value. Changing an approved field — mapped or
    // not — makes the approval stale, and a stale approval breaks the lock
    // (stale_approval). Under a lock that must be a deliberate re-review.
    if (!mapped && review?.status === 'completed') {
      const rollup =
        await this.consultant.getApplicationApproval(applicationId);
      const approval = rollup.fields.find((f) => f.fieldKey === fieldKey);
      if (approval?.decision === 'approved') {
        throw new ConflictException(
          'This field is approved and the pre-submission review is locked; changing it would make the approval stale and break the lock. Start a new review to change it.',
        );
      }
    }

    const [form, current] = await Promise.all([
      this.forms.load(applicationId),
      this.provenance.getCurrentFieldVersion(applicationId, fieldKey),
    ]);
    const formField = form?.payload.fields.find((f) => f.key === fieldKey);

    if (!mapped && !formField && !current) {
      throw new NotFoundException(`unknown field: ${fieldKey}`);
    }
    // No Forms page yet: the interview profile is what auto-fill reads
    // (applyPrefillOverrides), so the correction goes there. Before, this was
    // a 409 and the consultant could correct nothing until the applicant
    // generated a form (live 2026-10-19, eTA app 691755df). A legal
    // declaration stays the applicant's own answer, as on the form path.
    let profileUpdated = false;
    let profilePrevious: unknown = undefined;
    if (mapped && !form) {
      if (mapped.declaration) {
        throw new ConflictException(
          'This is a declaration, so only the applicant can change it. Ask them to correct it in their interview.',
        );
      }
      const { previous: was } = await this.forms.saveProfileValue(
        applicationId,
        fieldKey,
        value,
      );
      profilePrevious = was;
      profileUpdated =
        (typeof was === 'string' ? was.trim() : JSON.stringify(was)) !== value;
    }

    const previous =
      formField?.value ??
      current?.value_snapshot ??
      (profilePrevious === undefined
        ? null
        : typeof profilePrevious === 'string'
          ? profilePrevious
          : JSON.stringify(profilePrevious));

    // 1. the saved form (the auto-fill source)
    let formUpdated = false;
    if (form && (formField || mapped) && formField?.value !== value) {
      const edited: PrefilledFormField = {
        ...(formField ?? {
          key: fieldKey,
          // A split write's label names its piece ("— year"); the form row is the whole.
          label: (mapped?.label ?? fieldKey).replace(
            / — (year|month|day)$/,
            '',
          ),
        }),
        value,
        source: 'consultant',
      };
      // The consultant has looked at it: the "please check this" flag is done.
      delete edited.needsReview;
      const fields = formField
        ? form.payload.fields.map((f) => (f.key === fieldKey ? edited : f))
        : [...form.payload.fields, edited];
      await this.forms.save(form, { ...form.payload, fields });
      formUpdated = true;
    }

    // 2. provenance (the extracted-fields table + approval staleness)
    let provenanceUpdated = false;
    if (current && current.value_snapshot !== value) {
      await this.provenance.supersedeFieldProvenance(
        {
          applicationId,
          fieldKey,
          origin: 'user_entered',
          value,
        },
        actor,
      );
      provenanceUpdated = true;
    }

    // 3. the reviewer must look again at a covered value that changed
    if (
      mapped &&
      review?.status === 'in_review' &&
      (formUpdated || provenanceUpdated || profileUpdated)
    ) {
      await this.preflight.resetChecks(review.id, [
        CATEGORY_CHECK[mapped.category],
      ]);
    }

    if (formUpdated || provenanceUpdated || profileUpdated) {
      await this.audit.append({
        applicationId,
        eventType: 'FIELD_EDITED',
        actor,
        valueHash: this.provenance.valueHash(value),
        refs: { fieldKey },
        payload: {
          action: 'consultant_edit',
          reason: reason?.trim() || null,
          previous_value_hash:
            previous == null ? null : this.provenance.valueHash(previous),
          form_updated: formUpdated,
          profile_updated: profileUpdated,
          provenance_updated: provenanceUpdated,
          portal_mapped: Boolean(mapped),
          preflight_id: review?.id ?? null,
        },
      });
    }

    return {
      mappings: await this.mappings.forApplication(applicationId),
      review: await this.preflight.getActive(applicationId),
      formUpdated,
      profileUpdated,
      provenanceUpdated,
    };
  }

  /**
   * The applicant saved their form (Forms page). If an auto-fill value changed
   * while a review is IN PROGRESS, un-tick the categories that covered it — the
   * consultant ticked a value that no longer exists. A completed lock needs no
   * action: its hash no longer matches, which every gate already detects.
   */
  async onApplicantFormSaved(
    applicationId: string,
    changedKeys: string[],
  ): Promise<void> {
    if (changedKeys.length === 0) return;
    const review = await this.preflight.getActive(applicationId);
    if (review?.status !== 'in_review') return;
    const { mapping } = await this.mappings.resolve(applicationId);
    const changed = new Set(changedKeys);
    const checks = [
      ...new Set(
        (mapping ?? [])
          .filter((f) => changed.has(f.profileKey))
          .map((f) => CATEGORY_CHECK[f.category]),
      ),
    ];
    if (checks.length === 0) return;
    await this.preflight.resetChecks(review.id, checks);
  }
}
