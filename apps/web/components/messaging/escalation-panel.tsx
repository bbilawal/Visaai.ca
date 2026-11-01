'use client'

import { useCallback, useEffect, useState } from 'react'
import type { EscalationRecord, EscalationType } from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { createEscalation, listEscalations, resolveEscalation } from '@/lib/api/escalation-client'

const TYPES: { value: EscalationType; label: string }[] = [
  { value: 'complex_case', label: 'Complex case' },
  { value: 'legal_review', label: 'Legal review' },
  { value: 'supervisor_review', label: 'Supervisor review' },
  { value: 'specialist_review', label: 'Immigration specialist review' },
]

export function EscalationPanel({ applicationId }: { applicationId: string }) {
  const [items, setItems] = useState<EscalationRecord[]>([])
  const [type, setType] = useState<EscalationType>('complex_case')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const token = async () => {
    const { data: { session } } = await getSession()
    if (!session) throw new Error('Not signed in')
    return session.access_token
  }

  const load = useCallback(async () => {
    try { setItems(await listEscalations(await token(), applicationId)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load escalations') }
  }, [applicationId])

  useEffect(() => { void load() }, [load])

  const escalate = async () => {
    const r = reason.trim()
    if (!r || busy) return
    setBusy(true); setError(null)
    try { await createEscalation(await token(), applicationId, type, r); setReason(''); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to escalate') }
    finally { setBusy(false) }
  }

  const resolve = async (id: string) => {
    setBusy(true); setError(null)
    try { await resolveEscalation(await token(), id); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to resolve') }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>Escalations (staff only)</h3>
      <div className="mt-2 flex flex-col gap-1">
        {items.length === 0 && <p className="text-xs" style={{ color: 'var(--color-pale-stone)' }}>No escalations.</p>}
        {items.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded border px-2 py-1 text-sm" style={{ borderColor: 'var(--color-hairline-2)', color: 'var(--color-ink)' }}>
            <span>{e.escalation_type.replace(/_/g, ' ')} — {e.reason}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs uppercase" style={{ color: e.status === 'open' ? 'var(--color-rose)' : 'var(--color-emerald)' }}>{e.status}</span>
              {e.status === 'open' && <button type="button" disabled={busy} onClick={() => void resolve(e.id)} className="rounded border px-2 py-0.5 text-xs" style={{ borderColor: 'var(--color-hairline-2)' }}>Resolve</button>}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <select value={type} onChange={(e) => setType(e.target.value as EscalationType)} className="rounded border px-2 py-1 text-sm" style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)' }}>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason..." className="flex-1 rounded border px-2 py-1 text-sm" style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)', color: 'var(--color-ink)' }} />
        <button type="button" onClick={() => void escalate()} disabled={busy || !reason.trim()} className="rounded px-3 py-1 text-sm disabled:opacity-40" style={{ background: 'var(--color-rose)', color: 'var(--color-paper-canvas)' }}>Escalate</button>
      </div>
      {error && <p className="mt-1 text-xs" style={{ color: 'var(--color-rose)' }}>{error}</p>}
    </div>
  )
}
