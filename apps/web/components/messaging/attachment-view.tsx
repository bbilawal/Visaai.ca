'use client'

import { useEffect, useState } from 'react'
import type { MessageAttachment, VoiceMessage } from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { getAttachmentUrl, getVoiceUrl } from '@/lib/api/messaging-attachments-client'

export function AttachmentView({ attachment }: { attachment: MessageAttachment }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      const { data: { session } } = await getSession()
      if (!session) return
      const { url } = await getAttachmentUrl(session.access_token, attachment.id)
      if (active) setUrl(url)
    })()
    return () => { active = false }
  }, [attachment.id])

  if (!url) return <span className="text-xs" style={{ color: 'var(--color-pale-stone)' }}>{attachment.file_name}</span>
  if (attachment.kind === 'image') {
    return <img src={url} alt={attachment.file_name} className="mt-1 max-h-48 rounded border" style={{ borderColor: 'var(--color-hairline-2)' }} />
  }
  return <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm underline" style={{ color: 'var(--color-ink)' }}>{attachment.file_name}</a>
}

export function VoiceView({ voice }: { voice: VoiceMessage }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      const { data: { session } } = await getSession()
      if (!session) return
      const { url } = await getVoiceUrl(session.access_token, voice.id)
      if (active) setUrl(url)
    })()
    return () => { active = false }
  }, [voice.id])

  if (!url) return <span className="text-xs" style={{ color: 'var(--color-pale-stone)' }}>voice message...</span>
  return <audio controls src={url} className="mt-1 w-full max-w-xs" />
}
