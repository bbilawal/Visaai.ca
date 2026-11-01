'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { getSession } from '@/lib/supabase/client'
import { createBroadcast } from '@/lib/api/admin-broadcasts-client'
import type {
  BroadcastAudience,
  BroadcastInput,
  NotificationBroadcast,
  NotificationCategory,
} from '@visaai/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES: NotificationCategory[] = [
  'application',
  'billing',
  'assignment',
  'ai',
  'support',
  'system',
]

const AUDIENCE_KINDS = ['all', 'role', 'users'] as const
type AudienceKind = (typeof AUDIENCE_KINDS)[number]

const ROLES = ['admin', 'consultant', 'user'] as const
type AppRole = (typeof ROLES)[number]

/** Split a comma/newline separated blob into a clean list of user ids. */
function parseUserIds(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// ── Style constants (mirrors the templates admin editor) ────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '0.82rem',
  border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
  borderRadius: 4,
  fontFamily: 'inherit',
  background: 'var(--color-paper-canvas, #f6f3f1)',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: 80,
}

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
  borderRadius: 4,
  padding: '4px 12px',
  cursor: 'pointer',
  fontSize: '0.82rem',
  fontFamily: 'inherit',
}

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'var(--color-ink, #000)',
  color: 'var(--color-surface, #fff)',
  border: '1px solid var(--color-ink, #000)',
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 12,
}

const labelTextStyle: React.CSSProperties = { fontSize: '0.8rem' }

function statusColor(status: NotificationBroadcast['status']): string {
  if (status === 'sent') return 'var(--color-emerald, #1a6b40)'
  if (status === 'failed') return 'var(--color-rose, #b53030)'
  return 'var(--color-pale-stone, #4e4d4d)'
}

// ── BroadcastsClient ────────────────────────────────────────────────────────────

interface Props {
  initialBroadcasts: NotificationBroadcast[]
}

/**
 * Client island — admin broadcast composer + history.
 *
 * Composer: title, body, category, optional link, and an audience selector
 * (All users / Role → role select / Specific users → id list). A preview of the
 * rendered card, and a Send button behind an in-page confirm (NOT window.confirm)
 * whose confirm text shows the resolved audience summary — guarding accidental
 * all-user sends. History list of past broadcasts below.
 */
export function BroadcastsClient({ initialBroadcasts }: Props) {
  const t = useTranslations('adminBroadcasts')
  const router = useRouter()

  // ── Composer state ──────────────────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<NotificationCategory>('system')
  const [link, setLink] = useState('')

  // ── Audience state ──────────────────────────────────────────────────────────
  const [audienceKind, setAudienceKind] = useState<AudienceKind>('all')
  const [role, setRole] = useState<AppRole>('user')
  const [userIdsText, setUserIdsText] = useState('')

  // ── Send / confirm state ────────────────────────────────────────────────────
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState('')

  // ── Derived ─────────────────────────────────────────────────────────────────

  function resolveAudience(): BroadcastAudience {
    if (audienceKind === 'role') return { kind: 'role', role }
    if (audienceKind === 'users') return { kind: 'users', userIds: parseUserIds(userIdsText) }
    return { kind: 'all' }
  }

  /** Human-readable summary of the resolved audience (shown in the confirm). */
  function audienceSummary(a: BroadcastAudience): string {
    if (a.kind === 'role') return `${t('roleLabel')}: ${a.role}`
    if (a.kind === 'users') return `${a.userIds.length} ${t('users')}`
    return t('all')
  }

  const canSend = title.trim().length > 0 && body.trim().length > 0

  // ── Handlers ────────────────────────────────────────────────────────────────

  function resetForm() {
    setTitle('')
    setBody('')
    setCategory('system')
    setLink('')
    setAudienceKind('all')
    setRole('user')
    setUserIdsText('')
  }

  function handleSendClick() {
    if (!canSend) {
      setSendMsg(t('required'))
      return
    }
    setSendMsg('')
    setConfirming(true)
  }

  async function handleConfirmedSend() {
    setSending(true)
    setSendMsg('')
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error('no session')
      const input: BroadcastInput = {
        title: title.trim(),
        body: body.trim(),
        category,
        audience: resolveAudience(),
      }
      const trimmedLink = link.trim()
      if (trimmedLink) input.link = trimmedLink
      await createBroadcast(session.access_token, input)
      setConfirming(false)
      resetForm()
      setSendMsg(t('sent'))
      router.refresh()
    } catch {
      setSendMsg(t('sendFailed'))
    } finally {
      setSending(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const resolved = resolveAudience()

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* ── Composer (left) ── */}
      <div style={{ flex: '1 1 420px', minWidth: 320 }}>
        <div
          style={{
            padding: 16,
            border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
            borderRadius: 6,
            background: 'var(--color-paper-canvas, #f6f3f1)',
          }}
        >
          <h2 className="mono" style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 16 }}>
            {t('compose')}
          </h2>

          {/* Title */}
          <label style={labelStyle}>
            <span className="mono" style={labelTextStyle}>
              {t('titleLabel')}
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mono"
              style={inputStyle}
              aria-label={t('titleLabel')}
              data-testid="broadcast-title"
            />
          </label>

          {/* Body */}
          <label style={labelStyle}>
            <span className="mono" style={labelTextStyle}>
              {t('body')}
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mono"
              style={textareaStyle}
              aria-label={t('body')}
              data-testid="broadcast-body"
            />
          </label>

          {/* Category */}
          <label style={labelStyle}>
            <span className="mono" style={labelTextStyle}>
              {t('category')}
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as NotificationCategory)}
              className="mono"
              style={inputStyle}
              aria-label={t('category')}
              data-testid="broadcast-category"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          {/* Link */}
          <label style={labelStyle}>
            <span className="mono" style={labelTextStyle}>
              {t('link')}
            </span>
            <input
              type="text"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="/notifications"
              className="mono"
              style={inputStyle}
              aria-label={t('link')}
              data-testid="broadcast-link"
            />
          </label>

          {/* Audience kind */}
          <label style={labelStyle}>
            <span className="mono" style={labelTextStyle}>
              {t('audience')}
            </span>
            <select
              value={audienceKind}
              onChange={(e) => setAudienceKind(e.target.value as AudienceKind)}
              className="mono"
              style={inputStyle}
              aria-label={t('audience')}
              data-testid="audience-kind"
            >
              <option value="all">{t('all')}</option>
              <option value="role">{t('role')}</option>
              <option value="users">{t('users')}</option>
            </select>
          </label>

          {/* Role select (only when kind = role) */}
          {audienceKind === 'role' && (
            <label style={labelStyle}>
              <span className="mono" style={labelTextStyle}>
                {t('roleLabel')}
              </span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as AppRole)}
                className="mono"
                style={inputStyle}
                aria-label={t('roleLabel')}
                data-testid="audience-role"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* User ids textarea (only when kind = users) */}
          {audienceKind === 'users' && (
            <label style={labelStyle}>
              <span className="mono" style={labelTextStyle}>
                {t('userIds')}
              </span>
              <textarea
                value={userIdsText}
                onChange={(e) => setUserIdsText(e.target.value)}
                placeholder={t('userIdsPlaceholder')}
                className="mono"
                style={textareaStyle}
                aria-label={t('userIds')}
                data-testid="audience-userids"
              />
            </label>
          )}

          {/* Preview */}
          <div
            style={{
              padding: 12,
              border: '1px solid var(--color-atmosphere-wash, #cfdaf5)',
              borderRadius: 4,
              background: 'var(--color-atmosphere-wash, #cfdaf5)33',
              marginBottom: 16,
            }}
            data-testid="broadcast-preview"
          >
            <p className="mono" style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: 4 }}>
              {t('preview')}
            </p>
            <p className="mono" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
              {title || t('titleLabel')}
            </p>
            <p
              className="mono"
              style={{ fontSize: '0.82rem', color: 'var(--color-pale-stone, #4e4d4d)' }}
            >
              {body || t('body')}
            </p>
          </div>

          {/* Send / confirm */}
          {!confirming ? (
            <button
              type="button"
              className="mono"
              onClick={handleSendClick}
              disabled={sending}
              style={primaryBtnStyle}
              data-testid="send-btn"
            >
              {t('send')}
            </button>
          ) : (
            <div
              style={{
                padding: 12,
                border: '1px solid var(--color-ink, #000)',
                borderRadius: 4,
                background: 'var(--color-paper-canvas, #f6f3f1)',
              }}
              data-testid="confirm-panel"
            >
              <p className="mono" style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 8 }}>
                {t('confirmSend')}
              </p>
              <p
                className="mono"
                style={{ fontSize: '0.8rem', marginBottom: 12 }}
                data-testid="confirm-summary"
              >
                {audienceSummary(resolved)}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="mono"
                  onClick={() => void handleConfirmedSend()}
                  disabled={sending}
                  style={primaryBtnStyle}
                  data-testid="confirm-send-btn"
                >
                  {sending ? t('sending') : t('send')}
                </button>
                <button
                  type="button"
                  className="mono"
                  onClick={() => setConfirming(false)}
                  disabled={sending}
                  style={btnStyle}
                  data-testid="cancel-send-btn"
                >
                  {t('cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Send message */}
          {sendMsg && (
            <p
              className="mono"
              style={{
                fontSize: '0.78rem',
                color:
                  sendMsg === t('sent')
                    ? 'var(--color-emerald, #1a6b40)'
                    : 'var(--color-rose, #b53030)',
                marginTop: 12,
              }}
            >
              {sendMsg}
            </p>
          )}
        </div>
      </div>

      {/* ── History (right) ── */}
      <div style={{ flex: '1 1 360px', minWidth: 300 }}>
        <p className="mono" style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>
          {t('history')}
        </p>
        {initialBroadcasts.length === 0 ? (
          <p
            className="mono"
            style={{ fontSize: '0.82rem', color: 'var(--color-pale-stone, #4e4d4d)' }}
          >
            {t('empty')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {initialBroadcasts.map((b) => (
              <div
                key={b.id}
                style={{
                  padding: '8px 10px',
                  border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
                  borderRadius: 4,
                  background: 'var(--color-paper-canvas, #f6f3f1)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span className="mono" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                    {b.title}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: '0.72rem', fontWeight: 600, color: statusColor(b.status) }}
                  >
                    {t('status')}: {b.status}
                  </span>
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--color-pale-stone, #4e4d4d)',
                    marginTop: 2,
                  }}
                >
                  {audienceSummary(b.audience)} · {t('recipients')}: {b.recipient_count} ·{' '}
                  {new Date(b.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
