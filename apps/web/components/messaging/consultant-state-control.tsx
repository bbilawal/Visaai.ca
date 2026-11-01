'use client'

import { useState } from 'react'
import type { ConsultantState } from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { setConsultantState } from '@/lib/api/messaging-client'

const STATES: { value: ConsultantState; label: string }[] = [
  { value: 'pending_user_response', label: 'Pending user response' },
  { value: 'waiting_documents', label: 'Waiting documents' },
  { value: 'under_review', label: 'Under review' },
  { value: 'resolved', label: 'Resolved' },
]

const LABEL: Record<ConsultantState, string> = {
  pending_user_response: 'Pending user response',
  waiting_documents: 'Waiting documents',
  under_review: 'Under review',
  resolved: 'Resolved',
}

/** Read-only badge for everyone. */
export function ConsultantStateBadge({ state }: { state: ConsultantState | null }) {
  if (!state) return null
  return (
    <span className="rounded px-2 py-0.5 text-xs uppercase" style={{ background: 'var(--color-atmosphere-wash)', color: 'var(--color-ink)' }}>
      {LABEL[state]}
    </span>
  )
}

/** Staff-only dropdown to change the state. */
export function ConsultantStateControl({ applicationId, current, onChanged }: { applicationId: string; current: ConsultantState | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const change = async (state: ConsultantState) => {
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('Not signed in')
      await setConsultantState(session.access_token, applicationId, state)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set state')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select value={current ?? ''} disabled={busy} onChange={(e) => { if (e.target.value) void change(e.target.value as ConsultantState) }}
        className="rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)', color: 'var(--color-ink)' }}>
        <option value="">Set state…</option>
        {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      {error && <span className="text-xs" style={{ color: 'var(--color-rose)' }}>{error}</span>}
    </span>
  )
}
