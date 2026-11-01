'use client'

import { useState } from 'react'
import { getSession } from '@/lib/supabase/client'
import { ExternalLinkIcon } from '@/components/ui/icons'

interface DownloadButtonProps {
  /** API-relative path that streams the file, e.g. /forms/<id>/file/IMM%205257 */
  path: string
  filename: string
  /** The authority's own page, offered if our copy cannot be fetched. */
  fallbackUrl: string | null
}

/**
 * Downloads a cached government file through the API.
 *
 * WHY THIS IS NOT A PLAIN <a download>
 *
 * The API used to return a Supabase Storage signed URL. MEASURED in production
 * 2026-08-13: SUPABASE_URL on the VPS is http://127.0.0.1:54421 — Kong listens
 * on loopback with no public route — so every "Download" link pointed at the
 * server's own loopback and silently did nothing in the browser. The API now
 * streams the bytes itself, which means the request carries the Supabase bearer
 * token, which an <a href> cannot do. So: fetch, then hand the browser a blob.
 *
 * A failure is SHOWN and leaves the official government page one click away,
 * rather than failing silently the way the broken link did.
 */
export function DownloadButton({ path, filename, fallbackUrl }: DownloadButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')

  async function run() {
    setState('loading')
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('sign in required')

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(String(res.status))

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoked on the next tick, not in the same task as the click: Safari
      // cancels an in-flight download when the object URL disappears first.
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setState('idle')
    } catch {
      setState('error')
    }
  }

  if (state === 'error') {
    return (
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="text-[11px] text-callout-red">Download failed</span>
        {fallbackUrl && (
          <a
            href={fallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1d4ed8] hover:text-[#1e40af] underline underline-offset-2"
          >
            <ExternalLinkIcon size={12} />
            Open official page
          </a>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={state === 'loading'}
      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1d4ed8] hover:text-[#1e40af] underline underline-offset-2 shrink-0 disabled:opacity-60"
    >
      <ExternalLinkIcon size={12} />
      {state === 'loading' ? 'Preparing…' : 'Download'}
    </button>
  )
}
