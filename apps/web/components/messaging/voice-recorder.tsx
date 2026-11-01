'use client'

import { useEffect, useRef, useState } from 'react'
import { getSession } from '@/lib/supabase/client'
import { confirmVoice, putToSignedUrl, requestUploadUrl } from '@/lib/api/messaging-attachments-client'

/** Pick a recorder MIME the browser supports and that the server allows. */
function pickAudioMime(): { mime: string; ext: string } {
  const supported = (m: string) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
  if (supported('audio/webm')) return { mime: 'audio/webm', ext: 'webm' }
  if (supported('audio/mp4')) return { mime: 'audio/mp4', ext: 'm4a' } // Safari
  return { mime: 'audio/mpeg', ext: 'mp3' }
}

export function VoiceRecorder({ applicationId, onUploaded }: { applicationId: string; onUploaded: () => void }) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startRef = useRef<number>(0)
  const mimeRef = useRef<{ mime: string; ext: string }>({ mime: 'audio/webm', ext: 'webm' })
  const mountedRef = useRef(true)

  // Stop any live recorder + release the mic on unmount (prevents a leaked
  // MediaStream keeping the browser mic indicator on after navigation).
  useEffect(() => {
    return () => {
      mountedRef.current = false
      try { recRef.current?.stop() } catch { /* already stopped */ }
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const start = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const picked = pickAudioMime()
      mimeRef.current = picked
      const rec = new MediaRecorder(stream, { mimeType: picked.mime })
      chunksRef.current = []
      rec.ondataavailable = (ev) => { if (ev.data.size > 0) chunksRef.current.push(ev.data) }
      rec.onstop = () => { void upload(stream) }
      recRef.current = rec
      startRef.current = Date.now()
      rec.start()
      setRecording(true)
    } catch {
      setError('Microphone unavailable')
    }
  }

  const stop = () => {
    recRef.current?.stop()
    setRecording(false)
  }

  const upload = async (stream: MediaStream) => {
    stream.getTracks().forEach((t) => t.stop())
    const { mime, ext } = mimeRef.current
    const blob = new Blob(chunksRef.current, { type: mime })
    const durationMs = Date.now() - startRef.current
    if (mountedRef.current) setBusy(true)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('Not signed in')
      const token = session.access_token
      const signed = await requestUploadUrl(token, applicationId, { fileName: `voice-${Date.now()}.${ext}`, mimeType: mime, sizeBytes: blob.size, kind: 'voice' })
      await putToSignedUrl(signed.uploadUrl, blob, mime)
      await confirmVoice(token, applicationId, { storagePath: signed.storagePath, mimeType: mime, durationMs, sizeBytes: blob.size })
      if (mountedRef.current) onUploaded()
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : 'Voice upload failed')
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  return (
    <span>
      <button type="button" onClick={recording ? stop : start} disabled={busy}
        className="rounded border px-2 py-1 text-sm disabled:opacity-40"
        style={{ borderColor: 'var(--color-hairline-2)', color: recording ? 'var(--color-rose)' : 'var(--color-ink)' }}>
        {busy ? 'Uploading...' : recording ? 'Stop' : 'Record'}
      </button>
      {error && <span className="ml-2 text-xs" style={{ color: 'var(--color-rose)' }}>{error}</span>}
    </span>
  )
}
