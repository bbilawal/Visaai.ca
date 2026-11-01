'use client'

import { useRef, useState } from 'react'
import type { AttachmentKind } from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { confirmAttachment, putToSignedUrl, requestUploadUrl } from '@/lib/api/messaging-attachments-client'

const MAX_BYTES = 25 * 1024 * 1024

function kindOf(mime: string): AttachmentKind {
  return mime.startsWith('image/') ? 'image' : 'file'
}

export function AttachmentUploader({ applicationId, onUploaded }: { applicationId: string; onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = () => inputRef.current?.click()

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    if (file.size > MAX_BYTES) { setError('File exceeds 25MB'); return }
    setBusy(true)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('Not signed in')
      const token = session.access_token
      const kind = kindOf(file.type)
      const signed = await requestUploadUrl(token, applicationId, { fileName: file.name, mimeType: file.type, sizeBytes: file.size, kind })
      await putToSignedUrl(signed.uploadUrl, file, file.type)
      await confirmAttachment(token, applicationId, { storagePath: signed.storagePath, fileName: file.name, mimeType: file.type, sizeBytes: file.size, kind })
      onUploaded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <span>
      <input ref={inputRef} type="file" hidden onChange={onFile}
        accept="application/pdf,image/png,image/jpeg,image/webp,image/heic" />
      <button type="button" onClick={pick} disabled={busy}
        className="rounded border px-2 py-1 text-sm disabled:opacity-40"
        style={{ borderColor: 'var(--color-hairline-2)', color: 'var(--color-ink)' }}>
        {busy ? 'Uploading...' : 'Attach'}
      </button>
      {error && <span className="ml-2 text-xs" style={{ color: 'var(--color-rose)' }}>{error}</span>}
    </span>
  )
}
