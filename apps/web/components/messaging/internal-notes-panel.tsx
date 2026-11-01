'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ConsultantNote } from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { createNote, listNotes } from '@/lib/api/consultant-notes-client'

export function InternalNotesPanel({ applicationId }: { applicationId: string }) {
  const [notes, setNotes] = useState<ConsultantNote[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const token = async () => {
    const { data: { session } } = await getSession()
    if (!session) throw new Error('Not signed in')
    return session.access_token
  }

  const load = useCallback(async () => {
    try { setNotes(await listNotes(await token(), applicationId)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load notes') }
  }, [applicationId])

  useEffect(() => { void load() }, [load])

  const add = async () => {
    const text = body.trim()
    if (!text || busy) return
    setBusy(true); setError(null)
    try { await createNote(await token(), applicationId, text); setBody(''); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to add note') }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-atmosphere-wash)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>Internal notes (staff only)</h3>
      <div className="mt-2 flex flex-col gap-1">
        {notes.length === 0 && <p className="text-xs" style={{ color: 'var(--color-pale-stone)' }}>No notes yet.</p>}
        {notes.map((n) => (
          <div key={n.id} className="rounded border px-2 py-1 text-sm" style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)', color: 'var(--color-ink)' }}>
            <span className="mr-2 text-xs" style={{ color: 'var(--color-pale-stone)' }}>{new Date(n.created_at).toLocaleString()}</span>
            {n.body}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add an internal note..."
          className="flex-1 rounded border px-2 py-1 text-sm" style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)', color: 'var(--color-ink)' }} />
        <button type="button" onClick={() => void add()} disabled={busy || !body.trim()}
          className="rounded px-3 py-1 text-sm disabled:opacity-40" style={{ background: 'var(--color-ink)', color: 'var(--color-paper-canvas)' }}>Add</button>
      </div>
      {error && <p className="mt-1 text-xs" style={{ color: 'var(--color-rose)' }}>{error}</p>}
    </div>
  )
}
