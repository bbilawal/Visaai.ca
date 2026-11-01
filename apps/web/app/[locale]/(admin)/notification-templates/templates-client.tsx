'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { getSession } from '@/lib/supabase/client'
import {
  createTemplate,
  updateTemplate,
  deactivateTemplate,
  previewTemplate,
} from '@/lib/api/admin-templates-client'
import type { NotificationTemplate, NotificationTemplateInput } from '@visaai/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  'consultant.assigned',
  'payment.received',
  'ai.assessment_complete',
  'application.status_changed',
] as const

type EventType = (typeof EVENT_TYPES)[number]

/** Suggested {{variable}} names for each event type. */
const EVENT_VARS: Record<EventType, string[]> = {
  'consultant.assigned': ['consultantName', 'applicationId'],
  'payment.received': ['tier', 'amountLabel', 'paymentId'],
  'ai.assessment_complete': ['score', 'applicationId'],
  'application.status_changed': ['status', 'applicationId'],
}

/** Sample values used when calling preview so placeholders resolve to readable text. */
function buildSampleVars(eventType: EventType): Record<string, string> {
  const vars = EVENT_VARS[eventType] ?? []
  const out: Record<string, string> = {}
  for (const v of vars) out[v] = v // variable-name → itself as sample value
  return out
}

// ── Style constants ───────────────────────────────────────────────────────────

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

const badgeStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-block',
  fontSize: '0.7rem',
  padding: '1px 6px',
  borderRadius: 3,
  background: active
    ? 'var(--color-emerald, #1a6b40)1a'
    : 'var(--color-rose, #b53030)1a',
  color: active
    ? 'var(--color-emerald, #1a6b40)'
    : 'var(--color-rose, #b53030)',
  border: `1px solid ${active ? 'var(--color-emerald, #1a6b40)55' : 'var(--color-rose, #b53030)55'}`,
})

// ── TemplatesClient ───────────────────────────────────────────────────────────

interface Props {
  initialTemplates: NotificationTemplate[]
}

/**
 * Client island — admin notification template editor.
 *
 * Left panel: list of all templates (event_type, locale, version, active badge).
 * Right panel: editor form (event_type select, locale, subject, title, body,
 *   variable hints, preview output, save).
 */
export function TemplatesClient({ initialTemplates }: Props) {
  const t = useTranslations('adminTemplates')
  const router = useRouter()

  // ── Editor state ──────────────────────────────────────────────────────────

  const [editingId, setEditingId] = useState<string | null>(null)
  const [eventType, setEventType] = useState<EventType>(EVENT_TYPES[0])
  const [locale, setLocale] = useState('en')
  const [subject, setSubject] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  // ── Preview state ─────────────────────────────────────────────────────────

  const [previewResult, setPreviewResult] = useState<{ title: string; body: string } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')

  // ── Save state ────────────────────────────────────────────────────────────

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [deactivating, setDeactivating] = useState<string | null>(null)

  // ── Helpers ───────────────────────────────────────────────────────────────

  function resetEditor() {
    setEditingId(null)
    setEventType(EVENT_TYPES[0])
    setLocale('en')
    setSubject('')
    setTitle('')
    setBody('')
    setPreviewResult(null)
    setPreviewError('')
    setSaveMsg('')
  }

  function loadTemplate(tpl: NotificationTemplate) {
    setEditingId(tpl.id)
    setEventType(tpl.event_type as EventType)
    setLocale(tpl.locale)
    setSubject(tpl.subject ?? '')
    setTitle(tpl.title)
    setBody(tpl.body)
    setPreviewResult(null)
    setPreviewError('')
    setSaveMsg('')
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  async function handlePreview() {
    if (!title && !body) return
    setPreviewing(true)
    setPreviewError('')
    setPreviewResult(null)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error('no session')
      const result = await previewTemplate(session.access_token, {
        title,
        body,
        sampleVars: buildSampleVars(eventType),
      })
      setPreviewResult(result)
    } catch {
      setPreviewError('Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!title || !body) {
      setSaveMsg('Title and body are required')
      return
    }
    setSaving(true)
    setSaveMsg('')
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error('no session')
      const input: NotificationTemplateInput = {
        event_type: eventType,
        locale: locale || 'en',
        subject: subject || null,
        title,
        body,
        variables: EVENT_VARS[eventType] ?? [],
      }
      if (editingId) {
        await updateTemplate(session.access_token, editingId, input)
      } else {
        await createTemplate(session.access_token, input)
      }
      setSaveMsg('saved')
      router.refresh()
    } catch {
      setSaveMsg('failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Deactivate ────────────────────────────────────────────────────────────

  async function handleDeactivate(id: string) {
    setDeactivating(id)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error('no session')
      await deactivateTemplate(session.access_token, id)
      router.refresh()
    } catch {
      // silently ignore — refresh will show current state
    } finally {
      setDeactivating(null)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  /** All templates matching the currently-selected (event_type, locale) for version history. */
  const historyRows = initialTemplates.filter(
    (tpl) => tpl.event_type === eventType && tpl.locale === locale,
  )

  const availableVars = EVENT_VARS[eventType] ?? []

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* ── Template list (left) ── */}
      <div style={{ flex: '0 0 320px', minWidth: 280 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <span className="mono" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            {t('title')}
          </span>
          <button type="button" className="mono" onClick={resetEditor} style={btnStyle}>
            {t('new')}
          </button>
        </div>

        {initialTemplates.length === 0 ? (
          <p className="mono" style={{ fontSize: '0.82rem', color: 'var(--color-pale-stone, #4e4d4d)' }}>
            {t('noTemplates')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {initialTemplates.map((tpl) => (
              <div
                key={tpl.id}
                style={{
                  padding: '8px 10px',
                  border: `1px solid ${editingId === tpl.id ? 'var(--color-ink, #000)' : 'var(--color-hairline-2, rgba(0,0,0,.15))'}`,
                  borderRadius: 4,
                  background: 'var(--color-paper-canvas, #f6f3f1)',
                  cursor: 'pointer',
                }}
                onClick={() => loadTemplate(tpl)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') loadTemplate(tpl)
                }}
                aria-label={`Edit template ${tpl.event_type} ${tpl.locale} v${tpl.version}`}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span className="mono" style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                    {tpl.event_type}
                  </span>
                  <span style={badgeStyle(tpl.is_active)}>
                    {tpl.is_active ? t('active') : t('inactive')}
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
                  {t('locale')}: {tpl.locale} · v{tpl.version}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Editor (right) ── */}
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
            {editingId ? t('editing') : t('new')}
          </h2>

          {/* Event type */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <span className="mono" style={{ fontSize: '0.8rem' }}>
              {t('event')}
            </span>
            <select
              value={eventType}
              onChange={(e) => {
                setEventType(e.target.value as EventType)
                setPreviewResult(null)
              }}
              className="mono"
              style={inputStyle}
              aria-label={t('event')}
            >
              {EVENT_TYPES.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </label>

          {/* Locale */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <span className="mono" style={{ fontSize: '0.8rem' }}>
              {t('locale')}
            </span>
            <input
              type="text"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              placeholder="en"
              className="mono"
              style={inputStyle}
              aria-label={t('locale')}
            />
          </label>

          {/* Subject */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <span className="mono" style={{ fontSize: '0.8rem' }}>
              {t('subject')}
            </span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('subjectPlaceholder')}
              className="mono"
              style={inputStyle}
              aria-label={t('subject')}
            />
          </label>

          {/* Title */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <span className="mono" style={{ fontSize: '0.8rem' }}>
              {t('titleLabel')}
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('titlePlaceholder')}
              className="mono"
              style={inputStyle}
              aria-label={t('titleLabel')}
              data-testid="template-title"
            />
          </label>

          {/* Body */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            <span className="mono" style={{ fontSize: '0.8rem' }}>
              {t('body')}
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('bodyPlaceholder')}
              className="mono"
              style={textareaStyle}
              aria-label={t('body')}
              data-testid="template-body"
            />
          </label>

          {/* Variable hints */}
          {availableVars.length > 0 && (
            <p
              className="mono"
              style={{
                fontSize: '0.72rem',
                color: 'var(--color-pale-stone, #4e4d4d)',
                marginBottom: 12,
              }}
            >
              {t('variables')}: {availableVars.map((v) => `{{${v}}}`).join(', ')}
            </p>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <button
              type="button"
              className="mono"
              onClick={() => void handlePreview()}
              disabled={previewing || (!title && !body)}
              style={btnStyle}
              data-testid="preview-btn"
            >
              {previewing ? t('loading') : t('preview')}
            </button>

            <button
              type="button"
              className="mono"
              onClick={() => void handleSave()}
              disabled={saving}
              style={primaryBtnStyle}
              data-testid="save-btn"
            >
              {saving ? t('loading') : t('save')}
            </button>

            {editingId && (
              <button
                type="button"
                className="mono"
                onClick={resetEditor}
                style={btnStyle}
              >
                {t('new')}
              </button>
            )}
          </div>

          {/* Save message */}
          {saveMsg && (
            <p
              className="mono"
              style={{
                fontSize: '0.78rem',
                color:
                  saveMsg === 'saved'
                    ? 'var(--color-emerald, #1a6b40)'
                    : saveMsg.startsWith('Title')
                      ? 'var(--color-rose, #b53030)'
                      : 'var(--color-rose, #b53030)',
                marginBottom: 12,
              }}
            >
              {saveMsg}
            </p>
          )}

          {/* Preview result */}
          {previewError && (
            <p
              className="mono"
              style={{
                fontSize: '0.78rem',
                color: 'var(--color-rose, #b53030)',
                marginBottom: 12,
              }}
            >
              {previewError}
            </p>
          )}
          {previewResult && (
            <div
              style={{
                padding: 12,
                border: '1px solid var(--color-atmosphere-wash, #cfdaf5)',
                borderRadius: 4,
                background: 'var(--color-atmosphere-wash, #cfdaf5)33',
                marginBottom: 16,
              }}
              data-testid="preview-result"
            >
              <p className="mono" style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
                {t('preview')}
              </p>
              <p className="mono" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                {previewResult.title}
              </p>
              <p
                className="mono"
                style={{ fontSize: '0.82rem', color: 'var(--color-pale-stone, #4e4d4d)' }}
              >
                {previewResult.body}
              </p>
            </div>
          )}

          {/* Version history for selected (event_type, locale) */}
          {historyRows.length > 0 && (
            <div>
              <p className="mono" style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>
                {t('history')} — {eventType} / {locale}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {historyRows
                  .slice()
                  .sort((a, b) => b.version - a.version)
                  .map((tpl) => (
                    <div
                      key={tpl.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 8px',
                        border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
                        borderRadius: 4,
                        fontSize: '0.75rem',
                      }}
                      className="mono"
                    >
                      <span>
                        v{tpl.version}{' '}
                        <span style={badgeStyle(tpl.is_active)}>
                          {tpl.is_active ? t('active') : t('inactive')}
                        </span>
                      </span>
                      <span style={{ color: 'var(--color-pale-stone, #4e4d4d)' }}>
                        {new Date(tpl.created_at).toLocaleDateString()}
                      </span>
                      {tpl.is_active && (
                        <button
                          type="button"
                          className="mono"
                          disabled={deactivating === tpl.id}
                          onClick={() => void handleDeactivate(tpl.id)}
                          style={{
                            ...btnStyle,
                            fontSize: '0.72rem',
                            padding: '1px 8px',
                            color: 'var(--color-rose, #b53030)',
                            borderColor: 'var(--color-rose, #b53030)55',
                          }}
                        >
                          {t('deactivate')}
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
