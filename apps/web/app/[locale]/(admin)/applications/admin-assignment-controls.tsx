'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import type { AssignmentStatus } from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { InlineConfirm } from '@/components/ui/inline-confirm'
import {
  adminAddBackup,
  adminAssign,
  adminPromote,
  adminReassign,
  adminRemoveBackup,
  adminSetDeadline,
  adminUnassign,
} from '@/lib/api/assignment-client'

interface ConsultantOption {
  id: string
  email: string
}

/**
 * Format a Date as the value a <input type="datetime-local"> expects: local
 * wall-clock time, "YYYY-MM-DDTHH:mm" (no timezone, no seconds). We can't use
 * toISOString() here because that is UTC and would shift the displayed time.
 */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/**
 * Admin assign / reassign / unassign controls for one application. Pure
 * transport: it picks a consultant and calls the backend, which owns every
 * rule (409 on conflict, etc.). router.refresh() re-pulls authoritative state.
 */
export function AdminAssignmentControls({
  applicationId,
  assignmentStatus,
  currentConsultantId,
  consultants,
}: {
  applicationId: string
  assignmentStatus: AssignmentStatus
  currentConsultantId: string | null
  consultants: ConsultantOption[]
}) {
  const t = useTranslations('admin')
  const router = useRouter()
  const { toast } = useToast()
  const [picked, setPicked] = useState<string>(currentConsultantId ?? consultants[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  // Absolute deadline as a local-wall-clock "YYYY-MM-DDTHH:mm" string (the value
  // a datetime-local input uses). Empty until the admin picks one or a preset.
  const [deadline, setDeadlineValue] = useState<string>('')

  // Quick presets prefill the datetime input relative to now.
  function applyPreset(ms: number) {
    setDeadlineValue(toLocalInputValue(new Date(Date.now() + ms)))
  }

  // Set/override the review window (SLA) as an ABSOLUTE deadline. Converts the
  // local-wall-clock input to ISO and sends { dueAt }; the backend validates the
  // > now+5m / < now+1y horizon and owns the rule. English-only (assignment UI).
  async function setDeadline() {
    if (busy) return
    if (!deadline) {
      toast('Pick a deadline date and time', 'error')
      return
    }
    // datetime-local has no timezone; new Date(localString) parses it as LOCAL.
    const due = new Date(deadline)
    if (Number.isNaN(due.getTime())) {
      toast('Enter a valid date and time', 'error')
      return
    }
    if (due.getTime() <= Date.now()) {
      toast('Deadline must be in the future', 'error')
      return
    }
    setBusy(true)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error(t('sessionExpired'))
      await adminSetDeadline(session.access_token, applicationId, {
        dueAt: due.toISOString(),
      })
      toast(`Review deadline set to ${due.toLocaleString()}`, 'success')
      router.refresh()
    } catch (err) {
      toast(err instanceof Error ? err.message : t('couldNotAction'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const doneToastKey = {
    assign: 'toastAssigned',
    reassign: 'toastReassigned',
    unassign: 'toastUnassigned',
  } as const

  // Multi-consultant (P3c) success messages — English-only for now (messaging/
  // assignment i18n keys are added in a later i18n pass, consistent with P3a/P3b).
  const backupToast = {
    addBackup: 'Backup added',
    promote: 'Promoted to primary',
    removeBackup: 'Backup removed',
  } as const

  type Action =
    | 'assign'
    | 'reassign'
    | 'unassign'
    | 'addBackup'
    | 'promote'
    | 'removeBackup'

  async function run(action: Action) {
    if (busy) return
    if (action !== 'unassign' && !picked) {
      toast(t('pickConsultantFirst'), 'error')
      return
    }
    // 'unassign' is confirmed in the page by InlineConfirm below, not window.confirm.
    setBusy(true)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error(t('sessionExpired'))
      const token = session.access_token
      if (action === 'assign') await adminAssign(token, applicationId, picked)
      else if (action === 'reassign') await adminReassign(token, applicationId, picked)
      else if (action === 'addBackup') await adminAddBackup(token, applicationId, picked)
      else if (action === 'promote') await adminPromote(token, applicationId, picked)
      else if (action === 'removeBackup') await adminRemoveBackup(token, applicationId, picked)
      else await adminUnassign(token, applicationId)
      toast(
        action in backupToast
          ? backupToast[action as keyof typeof backupToast]
          : t(doneToastKey[action as keyof typeof doneToastKey]),
        'success',
      )
      router.refresh()
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? (err as { status: number }).status
          : 0
      toast(
        status === 409
          ? t('conflictActive')
          : err instanceof Error
            ? err.message
            : t('couldNotAction'),
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  if (consultants.length === 0) {
    return <span className="mono text-muted" style={{ fontSize: '0.72rem' }}>{t('noConsultants')}</span>
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* Type-to-filter consultant picker (replaces the plain <select>). Same
          picked-id behavior; backend still owns role + country eligibility. */}
      <SearchableSelect
        id={`consultant-${applicationId}`}
        value={picked || null}
        onChange={setPicked}
        disabled={busy}
        compact
        ariaLabel={t('ariaConsultant')}
        placeholder="Search consultant…"
        options={consultants.map((c) => ({ value: c.id, label: c.email }))}
      />
      {assignmentStatus === 'UNASSIGNED' ? (
        <button className="btn btn-primary btn-xs" disabled={busy} onClick={() => void run('assign')}>
          {t('btnAssign')}
        </button>
      ) : (
        <>
          <button className="btn btn-outline btn-xs" disabled={busy} onClick={() => void run('reassign')}>
            {t('btnReassign')}
          </button>
          <InlineConfirm
            triggerClassName="btn btn-ghost btn-xs"
            confirmClassName="btn btn-danger btn-xs"
            cancelClassName="btn btn-ghost btn-xs"
            label={t('btnUnassign')}
            question={t('confirmUnassign')}
            confirmLabel={t('confirmUnassignYes')}
            cancelLabel={t('cancelConfirm')}
            onConfirm={() => void run('unassign')}
            disabled={busy}
          />
          {/* P3c multi-consultant: act on the selected consultant above. */}
          <button className="btn btn-outline btn-xs" disabled={busy} onClick={() => void run('addBackup')}>
            + Backup
          </button>
          <button className="btn btn-outline btn-xs" disabled={busy} onClick={() => void run('promote')}>
            Promote
          </button>
          <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => void run('removeBackup')}>
            − Backup
          </button>
          {/* SLA: override the review window as an absolute deadline. Presets
              prefill the picker; the value is sent as { dueAt } (ISO). */}
          <input
            type="datetime-local"
            value={deadline}
            disabled={busy}
            onChange={(e) => setDeadlineValue(e.target.value)}
            min={toLocalInputValue(new Date())}
            className="mono"
            style={{ fontSize: '0.78rem' }}
            aria-label="Review deadline (date and time)"
          />
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            onClick={() => applyPreset(24 * 60 * 60 * 1000)}
          >
            +24h
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            onClick={() => applyPreset(48 * 60 * 60 * 1000)}
          >
            +48h
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            onClick={() => applyPreset(7 * 24 * 60 * 60 * 1000)}
          >
            +7d
          </button>
          <button className="btn btn-outline btn-xs" disabled={busy} onClick={() => void setDeadline()}>
            Set deadline
          </button>
        </>
      )}
    </span>
  )
}
