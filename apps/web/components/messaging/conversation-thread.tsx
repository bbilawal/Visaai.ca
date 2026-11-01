'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConversationThread as Thread,
  DocumentRequest,
  DocumentRequestPriority,
  Message,
  MessageAttachment,
  MessageCategory,
  VoiceMessage,
} from '@visaai/types'
import {
  getThread,
  markRead,
  postMessage,
} from '@/lib/api/messaging-client'
import { listDocumentRequests, createDocumentRequest } from '@/lib/api/document-requests-client'
import { draftReply } from '@/lib/api/messaging-ai-client'
import { searchMessages, listOlderMessages } from '@/lib/api/messaging-client'
import { getSession } from '@/lib/supabase/client'
import { useMessagingStream } from '@/lib/messaging/use-messaging-stream'
import { AttachmentUploader } from './attachment-uploader'
import { VoiceRecorder } from './voice-recorder'
import { AttachmentView, VoiceView } from './attachment-view'
import { DocumentRequestCard } from './document-request-card'
import { ConsultantStateBadge, ConsultantStateControl } from './consultant-state-control'
import { InternalNotesPanel } from './internal-notes-panel'
import { EscalationPanel } from './escalation-panel'

// The API embeds attachment/voice rows per message but the base Message type
// doesn't include them. Read them via this local extension only — never modify
// @visaai/types Message.
type MessageWithMedia = Message & {
  message_attachments?: MessageAttachment[]
  voice_messages?: VoiceMessage[]
}

const CATEGORIES: MessageCategory[] = [
  'general',
  'documents',
  'eligibility',
  'application_status',
  'payment',
  'travel_history',
  'biometrics',
  'medical',
  'other',
]

const DOC_REQUEST_PRIORITIES: DocumentRequestPriority[] = ['low', 'normal', 'high', 'urgent']

interface ConversationThreadProps {
  applicationId: string
  currentUserId: string
  viewerRole?: 'user' | 'consultant' | 'admin'
  focusMessageId?: string
}

export function ConversationThread({
  applicationId,
  currentUserId,
  viewerRole = 'user',
  focusMessageId,
}: ConversationThreadProps) {
  const [thread, setThread] = useState<Thread | null>(null)
  const [requests, setRequests] = useState<DocumentRequest[]>([])
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<MessageCategory>('general')
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Message[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [olderMessages, setOlderMessages] = useState<Message[]>([])
  const [olderHasMore, setOlderHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const seededOlderRef = useRef(false)

  // Doc-request create form state (staff only)
  const [showDocForm, setShowDocForm] = useState(false)
  const [docType, setDocType] = useState('')
  const [docLabel, setDocLabel] = useState('')
  const [docPriority, setDocPriority] = useState<DocumentRequestPriority>('normal')
  const [docDueDate, setDocDueDate] = useState('')
  const [docNotes, setDocNotes] = useState('')
  const [docCreating, setDocCreating] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)

  const isStaff = viewerRole !== 'user'

  const load = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) return
      const token = session.access_token
      const t = await getThread(token, applicationId)
      setThread(t)
      // Seed the "older history exists" flag once, on first load. SSE-triggered
      // reloads call load() again but must NOT reset it or drop loaded older pages.
      if (!seededOlderRef.current) {
        seededOlderRef.current = true
        setOlderHasMore(t.has_more)
      }
      // Fetch document requests in parallel (ignore errors — thread still renders)
      listDocumentRequests(token, applicationId)
        .then(setRequests)
        .catch(() => undefined)
      // Mark as read silently
      await markRead(token, applicationId).catch(() => undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation')
    }
  }, [applicationId])

  useEffect(() => {
    void load()
  }, [load])

  // Deep-link focus (from global search): scroll to + flash the target message
  // ONCE, after the thread first renders it. A one-shot ref guards against
  // re-firing on every SSE-driven thread reload (which would yank the user back
  // to the focused message while they chat). Reset only when focusMessageId changes.
  const hasFocusedRef = useRef(false)
  useEffect(() => {
    hasFocusedRef.current = false
  }, [focusMessageId])
  useEffect(() => {
    if (!focusMessageId || !thread || hasFocusedRef.current) return
    const el = document.getElementById(`msg-${focusMessageId}`)
    if (!el) return
    hasFocusedRef.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.style.transition = 'background-color 1.5s ease'
    el.style.backgroundColor = 'var(--color-atmosphere-wash)'
    const t = setTimeout(() => { el.style.backgroundColor = '' }, 1500)
    return () => clearTimeout(t)
  }, [focusMessageId, thread])

  // Reload on substantive events for this application (P1 + P2 event types).
  useMessagingStream((e) => {
    if (
      e.application_id === applicationId &&
      (e.type === 'message.created' ||
        e.type === 'conversation.status' ||
        e.type === 'attachment.created' ||
        e.type === 'voice.created' ||
        e.type === 'document_request.created' ||
        e.type === 'document_request.updated' ||
        e.type === 'message.read' ||
        e.type === 'message.delivered')
    ) {
      void load()
    }
  })

  const send = async () => {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) {
        setError('Not authenticated')
        return
      }
      await postMessage(session.access_token, applicationId, { body: text, category })
      setBody('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  // Staff-only: ask the AI to draft a reply and pre-fill the composer. The AI
  // never posts — the consultant edits and sends through the normal send() path.
  const aiDraft = async () => {
    if (drafting || sending) return
    setDrafting(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) {
        setError('Not authenticated')
        return
      }
      const instruction = body.trim() || undefined
      const { draft } = await draftReply(session.access_token, applicationId, instruction)
      setBody(draft)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI drafting is unavailable right now')
    } finally {
      setDrafting(false)
    }
  }

  const runSearch = async () => {
    const q = searchQ.trim()
    if (!q) { setSearchResults(null); return }
    setSearching(true)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) return
      setSearchResults(await searchMessages(session.access_token, applicationId, q))
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const submitDocRequest = async () => {
    if (!docType.trim() || !docLabel.trim()) {
      setDocError('Document type and label are required')
      return
    }
    setDocCreating(true)
    setDocError(null)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('Not signed in')
      await createDocumentRequest(session.access_token, applicationId, {
        documentType: docType.trim(),
        label: docLabel.trim(),
        priority: docPriority,
        dueDate: docDueDate || undefined,
        notes: docNotes || undefined,
      })
      setDocType('')
      setDocLabel('')
      setDocPriority('normal')
      setDocDueDate('')
      setDocNotes('')
      setShowDocForm(false)
      await load()
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to create request')
    } finally {
      setDocCreating(false)
    }
  }

  // Build a parent->children map for threaded rendering
  // All loaded messages: older pages prepended to the latest window, deduped by
  // id, ascending. Preserves scrolled-back history across SSE reloads (which only
  // refresh the latest window via `thread`).
  const allMessages = useMemo(() => {
    const byId = new Map<string, Message>()
    for (const m of olderMessages) byId.set(m.id, m)
    for (const m of thread?.messages ?? []) byId.set(m.id, m)
    return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
  }, [olderMessages, thread])

  const childrenOf = useMemo(() => {
    const loadedIds = new Set(allMessages.map((m) => m.id))
    const map = new Map<string | null, MessageWithMedia[]>()
    for (const m of allMessages) {
      // A reply whose parent is in an unloaded older page renders at root.
      const key = m.parent_message_id && loadedIds.has(m.parent_message_id) ? m.parent_message_id : null
      map.set(key, [...(map.get(key) ?? []), m as MessageWithMedia])
    }
    return map
  }, [allMessages])

  const loadOlder = async () => {
    const oldest = allMessages[0]
    if (!oldest || loadingOlder) return
    setLoadingOlder(true)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) return
      const page = await listOlderMessages(session.access_token, applicationId, oldest.created_at)
      setOlderMessages((prev) => {
        const byId = new Map<string, Message>()
        for (const m of page.messages) byId.set(m.id, m)
        for (const m of prev) byId.set(m.id, m)
        return [...byId.values()]
      })
      setOlderHasMore(page.has_more)
    } catch {
      // non-fatal: leave the list + button as-is
    } finally {
      setLoadingOlder(false)
    }
  }

  // Receipts: the latest timestamps any OTHER participant has read / received up
  // to. The sender's most recent message shows a single tri-state status.
  const othersReadAt =
    (thread?.participants ?? [])
      .filter((p) => p.user_id !== currentUserId && p.last_read_at)
      .map((p) => p.last_read_at as string)
      .sort()
      .at(-1) ?? null
  const othersDeliveredAt =
    (thread?.participants ?? [])
      .filter((p) => p.user_id !== currentUserId && p.delivered_at)
      .map((p) => p.delivered_at as string)
      .sort()
      .at(-1) ?? null
  const lastMine =
    [...allMessages]
      .filter((m) => m.sender_id === currentUserId)
      .at(-1) ?? null
  const lastMineReceipt: 'Sent' | 'Delivered' | 'Read' | null = !lastMine
    ? null
    : othersReadAt && lastMine.created_at <= othersReadAt
      ? 'Read'
      : othersDeliveredAt && lastMine.created_at <= othersDeliveredAt
        ? 'Delivered'
        : 'Sent'

  const renderTree = (parentId: string | null, depth: number): React.ReactNode[] =>
    (childrenOf.get(parentId) ?? []).flatMap((m) => [
      <MessageRow
        key={m.id}
        message={m}
        depth={depth}
        mine={m.sender_id === currentUserId}
        receipt={m.id === lastMine?.id ? lastMineReceipt ?? undefined : undefined}
      />,
      ...renderTree(m.id, depth + 1),
    ])

  if (!thread) {
    return (
      <div
        className="rounded-lg border p-4"
        style={{ borderColor: 'var(--color-hairline-2)', color: 'var(--color-pale-stone)' }}
        aria-busy={error ? undefined : 'true'}
        role={error ? 'alert' : undefined}
        aria-label={error ? undefined : 'Loading conversation'}
      >
        {error ?? 'Loading conversation...'}
      </div>
    )
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{
        borderColor: 'var(--color-hairline-2)',
        background: 'var(--color-paper-canvas)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2
          className="font-serif text-lg"
          style={{ color: 'var(--color-ink)' }}
        >
          Messages
        </h2>
        <div className="flex items-center gap-2">
          <ConsultantStateBadge state={thread.conversation.consultant_state} />
          {isStaff && (
            <ConsultantStateControl
              applicationId={applicationId}
              current={thread.conversation.consultant_state}
              onChanged={load}
            />
          )}
          <span
            className="text-xs uppercase tracking-wide"
            style={{ color: 'var(--color-pale-stone)' }}
          >
            {thread.conversation.status}
          </span>
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
            placeholder="Search messages…"
            className="rounded border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)', color: 'var(--color-ink)' }}
          />
          {searchResults !== null && (
            <button type="button" onClick={() => { setSearchQ(''); setSearchResults(null) }} className="text-xs" style={{ color: 'var(--color-pale-stone)' }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Search results */}
      {searchResults !== null && (
        <div className="rounded-lg border p-2" style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)' }}>
          <p className="mb-1 text-xs" style={{ color: 'var(--color-pale-stone)' }}>
            {searching ? 'Searching…' : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`}
          </p>
          {searchResults.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => document.getElementById(`msg-${m.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              className="block w-full truncate rounded px-2 py-1 text-left text-sm"
              style={{ color: 'var(--color-ink)' }}
            >
              <span className="mr-2 text-xs" style={{ color: 'var(--color-pale-stone)' }}>{new Date(m.created_at).toLocaleDateString()}</span>
              {m.body}
            </button>
          ))}
        </div>
      )}

      {/* Unread indicator */}
      {thread.unread_count > 0 && (
        <div
          className="rounded px-3 py-1 text-xs"
          style={{
            background: 'var(--color-atmosphere-wash)',
            color: 'var(--color-ink)',
          }}
          role="status"
          aria-live="polite"
        >
          {thread.unread_count} unread message{thread.unread_count === 1 ? '' : 's'}
        </div>
      )}

      {/* Document requests */}
      {requests.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-pale-stone)' }}>
            Document Requests
          </h3>
          {requests.map((req) => (
            <DocumentRequestCard
              key={req.id}
              request={req}
              applicationId={applicationId}
              isStaff={isStaff}
              onChanged={load}
            />
          ))}
        </div>
      )}

      {/* Staff: request document form */}
      {isStaff && (
        <div>
          {showDocForm ? (
            <div
              className="rounded-lg border p-3"
              style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)' }}
            >
              <h4 className="mb-2 text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
                Request Document
              </h4>
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  placeholder="Document type (e.g. bank_statement)"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="rounded border px-2 py-1 text-sm"
                  style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)', color: 'var(--color-ink)' }}
                />
                <input
                  type="text"
                  placeholder="Label shown to user"
                  value={docLabel}
                  onChange={(e) => setDocLabel(e.target.value)}
                  className="rounded border px-2 py-1 text-sm"
                  style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)', color: 'var(--color-ink)' }}
                />
                <div className="flex gap-2">
                  <select
                    value={docPriority}
                    onChange={(e) => setDocPriority(e.target.value as DocumentRequestPriority)}
                    className="rounded border px-2 py-1 text-sm"
                    style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)', color: 'var(--color-ink)' }}
                  >
                    {DOC_REQUEST_PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={docDueDate}
                    onChange={(e) => setDocDueDate(e.target.value)}
                    className="rounded border px-2 py-1 text-sm"
                    style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)', color: 'var(--color-ink)' }}
                  />
                </div>
                <textarea
                  placeholder="Notes (optional)"
                  value={docNotes}
                  onChange={(e) => setDocNotes(e.target.value)}
                  rows={2}
                  className="rounded border px-2 py-1 text-sm"
                  style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)', color: 'var(--color-ink)' }}
                />
                {docError && (
                  <p className="text-xs" style={{ color: 'var(--color-rose)' }}>{docError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void submitDocRequest()}
                    disabled={docCreating}
                    className="rounded px-3 py-1 text-sm disabled:opacity-40"
                    style={{ background: 'var(--color-ink)', color: 'var(--color-paper-canvas)' }}
                  >
                    {docCreating ? 'Requesting...' : 'Send Request'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDocForm(false)}
                    className="rounded border px-3 py-1 text-sm"
                    style={{ borderColor: 'var(--color-hairline-2)', color: 'var(--color-ink)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDocForm(true)}
              className="rounded border px-2 py-1 text-sm"
              style={{ borderColor: 'var(--color-hairline-2)', color: 'var(--color-ink)' }}
            >
              + Request Document
            </button>
          )}
        </div>
      )}

      {/* Message list */}
      <div
        className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto"
        role="log"
        aria-label="Message thread"
        aria-live="polite"
      >
        {olderHasMore && (
          <div className="mb-2 text-center">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="rounded border px-3 py-1 text-xs disabled:opacity-60"
              style={{ borderColor: 'var(--color-hairline-2)', color: 'var(--color-pale-stone)' }}
            >
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}
        {allMessages.length === 0 ? (
          <p
            className="text-sm"
            style={{ color: 'var(--color-pale-stone)' }}
          >
            No messages yet. Start the conversation below.
          </p>
        ) : (
          renderTree(null, 0)
        )}
      </div>

      {/* Error display */}
      {error && (
        <p
          className="text-sm"
          style={{ color: 'var(--color-rose)' }}
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Composer */}
      <div
        className="flex flex-col gap-2 border-t pt-3"
        style={{ borderColor: 'var(--color-hairline-2)' }}
      >
        <label className="sr-only" htmlFor="msg-category">
          Message category
        </label>
        <select
          id="msg-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as MessageCategory)}
          className="w-fit rounded border px-2 py-1 text-sm"
          style={{
            borderColor: 'var(--color-hairline-2)',
            background: 'var(--color-paper-canvas)',
            color: 'var(--color-ink)',
          }}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <label className="sr-only" htmlFor="msg-body">
            Message body
          </label>
          <textarea
            id="msg-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
            }}
            placeholder="Write a message... (Cmd/Ctrl+Enter to send)"
            rows={3}
            className="min-h-[44px] flex-1 rounded border px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--color-hairline-2)',
              background: 'var(--color-paper-canvas)',
              color: 'var(--color-ink)',
            }}
            aria-label="Message body"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !body.trim()}
            className="rounded px-4 py-2 text-sm"
            style={{
              background: 'var(--color-ink)',
              color: 'var(--color-paper-canvas)',
              opacity: sending || !body.trim() ? 0.4 : 1,
              cursor: sending || !body.trim() ? 'not-allowed' : 'pointer',
            }}
            aria-label="Send message"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>

        {/* Attachment + voice controls */}
        <div className="flex items-center gap-2">
          <AttachmentUploader applicationId={applicationId} onUploaded={load} />
          <VoiceRecorder applicationId={applicationId} onUploaded={load} />
          {isStaff && (
            <button
              type="button"
              onClick={() => void aiDraft()}
              disabled={drafting || sending}
              className="rounded border px-2 py-1 text-sm disabled:opacity-40"
              style={{ borderColor: 'var(--color-hairline-2)', color: 'var(--color-ink)' }}
            >
              {drafting ? 'Drafting…' : '✨ Draft reply (AI)'}
            </button>
          )}
        </div>
      </div>

      {/* Staff-only case-ops panels (RLS + isStaff guards are the real boundary) */}
      {isStaff && (
        <>
          <InternalNotesPanel applicationId={applicationId} />
          <EscalationPanel applicationId={applicationId} />
        </>
      )}
    </div>
  )
}

interface MessageRowProps {
  message: MessageWithMedia
  depth: number
  mine: boolean
  receipt?: 'Sent' | 'Delivered' | 'Read'
}

function MessageRow({ message, depth, mine, receipt }: MessageRowProps) {
  return (
    <div
      id={`msg-${message.id}`}
      style={{
        marginLeft: depth * 16,
        background: mine ? 'var(--color-atmosphere-wash)' : 'var(--color-paper-canvas)',
        borderColor: 'var(--color-hairline-2)',
      }}
      className="rounded-md border px-3 py-2"
    >
      <div
        className="mb-1 flex flex-wrap items-center gap-2 text-xs"
        style={{ color: 'var(--color-pale-stone)' }}
      >
        <span className="font-medium uppercase">{message.sender_role}</span>
        <span
          className="rounded px-1"
          style={{ background: 'var(--color-hairline-2)' }}
        >
          {message.category.replace(/_/g, ' ')}
        </span>
        <time dateTime={message.created_at}>
          {new Date(message.created_at).toLocaleString()}
        </time>
      </div>
      <p
        className="whitespace-pre-wrap text-sm"
        style={{ color: 'var(--color-ink)' }}
      >
        {message.body}
      </p>
      {/* Embedded attachments */}
      {message.message_attachments && message.message_attachments.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {message.message_attachments.map((att) => (
            <AttachmentView key={att.id} attachment={att} />
          ))}
        </div>
      )}
      {/* Embedded voice messages */}
      {message.voice_messages && message.voice_messages.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {message.voice_messages.map((v) => (
            <VoiceView key={v.id} voice={v} />
          ))}
        </div>
      )}
      {receipt && (
        <div className="mt-0.5 text-right text-xs" style={{ color: 'var(--color-pale-stone)' }}>
          {receipt}
        </div>
      )}
    </div>
  )
}
