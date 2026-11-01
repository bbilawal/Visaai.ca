'use client'

import { useRef, useState } from 'react'
import type { DocumentRequest, DocumentRequestStatus } from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { setDocumentRequestStatus, fulfillDocumentRequest } from '@/lib/api/document-requests-client'
import { confirmAttachment, putToSignedUrl, requestUploadUrl } from '@/lib/api/messaging-attachments-client'

const STATUS_COLOR: Record<DocumentRequestStatus, string> = {
  pending: 'var(--color-pale-stone)',
  submitted: 'var(--color-atmosphere-wash)',
  under_review: 'var(--color-atmosphere-wash)',
  approved: 'var(--color-emerald)',
  rejected: 'var(--color-rose)',
}

export function DocumentRequestCard({
  request,
  applicationId,
  isStaff,
  onChanged,
}: {
  request: DocumentRequest
  applicationId: string
  isStaff: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const token = async () => {
    const { data: { session } } = await getSession()
    if (!session) throw new Error('Not signed in')
    return session.access_token
  }

  const uploadAndFulfill = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const t = await token()
      const kind = file.type.startsWith('image/') ? 'image' as const : 'file' as const
      const signed = await requestUploadUrl(t, applicationId, { fileName: file.name, mimeType: file.type, sizeBytes: file.size, kind })
      await putToSignedUrl(signed.uploadUrl, file, file.type)
      const att = await confirmAttachment(t, applicationId, { storagePath: signed.storagePath, fileName: file.name, mimeType: file.type, sizeBytes: file.size, kind })
      await fulfillDocumentRequest(t, request.id, att.id)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const changeStatus = async (status: DocumentRequestStatus) => {
    setBusy(true)
    setError(null)
    try {
      await setDocumentRequestStatus(await token(), request.id, status)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="my-2 rounded-lg border p-3" style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)' }}>
      <div className="flex items-center justify-between">
        <strong style={{ color: 'var(--color-ink)' }}>{request.label}</strong>
        <span className="rounded px-2 py-0.5 text-xs uppercase" style={{ background: STATUS_COLOR[request.status], color: 'var(--color-ink)' }}>
          {request.status.replace(/_/g, ' ')}
        </span>
      </div>
      <div className="mt-1 text-xs" style={{ color: 'var(--color-pale-stone)' }}>
        Priority: {request.priority}{request.due_date ? ` · Due ${request.due_date}` : ''}
      </div>
      {request.notes && <p className="mt-1 text-sm" style={{ color: 'var(--color-ink)' }}>{request.notes}</p>}

      {!isStaff && (request.status === 'pending' || request.status === 'rejected') && (
        <label className="mt-2 inline-block cursor-pointer text-sm underline" style={{ color: 'var(--color-ink)' }}>
          {busy ? 'Uploading...' : 'Upload requested document'}
          <input ref={fileInputRef} type="file" hidden disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAndFulfill(f) }} />
        </label>
      )}

      {isStaff && request.status === 'submitted' && (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void changeStatus('under_review')} className="rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--color-hairline-2)' }}>Review</button>
          <button type="button" disabled={busy} onClick={() => void changeStatus('approved')} className="rounded px-2 py-1 text-xs" style={{ background: 'var(--color-emerald)', color: 'var(--color-paper-canvas)' }}>Approve</button>
          <button type="button" disabled={busy} onClick={() => void changeStatus('rejected')} className="rounded px-2 py-1 text-xs" style={{ background: 'var(--color-rose)', color: 'var(--color-paper-canvas)' }}>Reject</button>
        </div>
      )}
      {isStaff && request.status === 'under_review' && (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void changeStatus('approved')} className="rounded px-2 py-1 text-xs" style={{ background: 'var(--color-emerald)', color: 'var(--color-paper-canvas)' }}>Approve</button>
          <button type="button" disabled={busy} onClick={() => void changeStatus('rejected')} className="rounded px-2 py-1 text-xs" style={{ background: 'var(--color-rose)', color: 'var(--color-paper-canvas)' }}>Reject</button>
        </div>
      )}

      {error && <p className="mt-1 text-xs" style={{ color: 'var(--color-rose)' }}>{error}</p>}
    </div>
  )
}
