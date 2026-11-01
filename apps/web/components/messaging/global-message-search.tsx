'use client'

import { useState } from 'react'
import type { GlobalMessageSearchResult } from '@visaai/types'
import { Link } from '@/i18n/navigation'
import { getSession } from '@/lib/supabase/client'
import { searchAllMessages } from '@/lib/api/messaging-client'

function label(r: GlobalMessageSearchResult): string {
  if (r.country_code && r.visa_type) return `${r.country_code} · ${r.visa_type}`
  if (r.country_code) return r.country_code
  if (r.visa_type) return r.visa_type
  return 'Application'
}

/**
 * Global message search: one box, RLS-scoped results across every conversation
 * the caller can see. Each result links into its thread and focuses the message.
 * Mirrors the in-thread search UX (Enter to run, empty/loading states).
 */
export function GlobalMessageSearch() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GlobalMessageSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  const run = async () => {
    const query = q.trim()
    if (!query) { setResults(null); return }
    setSearching(true)
    try {
      const { data: { session } } = await getSession()
      if (!session) { setResults([]); return }
      setResults(await searchAllMessages(session.access_token, query))
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run() }}
          placeholder="Search all messages…"
          className="flex-1 rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--color-hairline-2)' }}
          aria-label="Search all messages"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={searching}
          className="rounded px-3 py-2 text-sm disabled:opacity-60"
          style={{ background: 'var(--color-ink)', color: 'var(--color-paper-canvas)' }}
        >
          Search
        </button>
      </div>

      {results !== null && (
        <div className="mt-4">
          <p className="mb-2 text-xs" style={{ color: 'var(--color-pale-stone)' }}>
            {searching ? 'Searching…' : `${results.length} result${results.length === 1 ? '' : 's'}`}
          </p>
          <ul className="flex flex-col gap-2" aria-label="Search results">
            {results.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/messages/${r.application_id}?focus=${r.id}`}
                  className="block rounded border px-3 py-2 text-sm hover:bg-[var(--color-atmosphere-wash)]"
                  style={{ borderColor: 'var(--color-hairline-2)' }}
                >
                  <span className="mr-2 font-medium">{label(r)}</span>
                  <span style={{ color: 'var(--color-pale-stone)' }}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                  <span className="mt-1 block truncate">{r.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
