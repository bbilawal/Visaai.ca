'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { NotificationPreferences } from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { getNotificationPreferences, updateNotificationPreferences } from '@/lib/api/notification-preferences-client'
import { enablePush, disablePush, pushSupported } from '@/lib/notifications/push-manager'
import { subscribePush, unsubscribePush } from '@/lib/api/push-client'

/** All six notification categories (opt-out: absent/true = ON; false = muted). */
const CATEGORIES = [
  'application',
  'billing',
  'assignment',
  'ai',
  'support',
  'system',
] as const

/** Hours 0..23 for the quiet-hours selects. */
const HOURS: number[] = Array.from({ length: 24 }, (_, i) => i)

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function NotificationSettings() {
  const t = useTranslations('notifications')
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supported = pushSupported()

  const token = async () => {
    const { data: { session } } = await getSession()
    if (!session) throw new Error('Not signed in')
    return session.access_token
  }

  const load = useCallback(async () => {
    try { setPrefs(await getNotificationPreferences(await token())) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load preferences') }
  }, [])

  useEffect(() => { void load() }, [load])

  // ── patch helper ─────────────────────────────────────────────────────────────

  const patch = async (update: Parameters<typeof updateNotificationPreferences>[1]) => {
    setBusy(true); setError(null)
    try { setPrefs(await updateNotificationPreferences(await token(), update)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to update') }
    finally { setBusy(false) }
  }

  // ── email / push ─────────────────────────────────────────────────────────────

  const setEmail = (email_enabled: boolean) => void patch({ email_enabled })

  const setSms = (sms_enabled: boolean) => void patch({ sms_enabled })

  const togglePush = async (next: boolean) => {
    setBusy(true); setError(null)
    try {
      const t = await token()
      if (next) {
        const sub = await enablePush()
        if (!sub) { setError('Push permission denied or unsupported'); return }
        await subscribePush(t, sub, navigator.userAgent)
      } else {
        const endpoint = await disablePush()
        if (endpoint) await unsubscribePush(t, endpoint)
      }
      setPrefs(await updateNotificationPreferences(t, { push_enabled: next }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update push')
    } finally { setBusy(false) }
  }

  // ── categories ───────────────────────────────────────────────────────────────

  const toggleCategory = (cat: string, checked: boolean) =>
    void patch({ categories: { ...(prefs?.categories ?? {}), [cat]: checked } })

  // ── quiet hours ───────────────────────────────────────────────────────────────

  const setQuietStart = (val: string) =>
    void patch({ quiet_hours_start: val === '' ? null : Number(val) })

  const setQuietEnd = (val: string) =>
    void patch({ quiet_hours_end: val === '' ? null : Number(val) })

  const setTimezone = (tz: string) =>
    void patch({ timezone: tz || null })

  // ── language ─────────────────────────────────────────────────────────────────

  const setLanguage = (lang: string) =>
    void patch({ language: lang || null })

  // ── render ────────────────────────────────────────────────────────────────────

  if (!prefs) return <p className="text-sm" style={{ color: 'var(--color-pale-stone)' }}>Loading notification settings…</p>

  const browserTz = typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC'

  return (
    <div className="rounded-lg border p-4 space-y-5" style={{ borderColor: 'var(--color-hairline-2)', background: 'var(--color-paper-canvas)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{t('title')}</h3>

      {/* ── Email / push toggles (original) ─────────────────────────────────── */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-ink)' }}>
          <input type="checkbox" checked={prefs.email_enabled} disabled={busy} onChange={(e) => setEmail(e.target.checked)} />
          Email me when I have unread messages
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: supported ? 'var(--color-ink)' : 'var(--color-pale-stone)' }}>
          <input type="checkbox" checked={prefs.push_enabled} disabled={busy || !supported} onChange={(e) => void togglePush(e.target.checked)} />
          Browser push notifications{!supported && ' (not supported in this browser)'}
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-ink)' }}>
          <input type="checkbox" checked={prefs.sms_enabled} disabled={busy} onChange={(e) => setSms(e.target.checked)} aria-label={t('sms')} />
          {t('sms')}
        </label>
        <p className="text-xs" style={{ color: 'var(--color-pale-stone)' }}>{t('smsHint')}</p>
      </div>

      {/* ── Categories ──────────────────────────────────────────────────────── */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-pale-stone)' }}>
          {t('categories')}
        </h4>
        <div className="space-y-1.5">
          {CATEGORIES.map((cat) => {
            const catKey = `cat${cat.charAt(0).toUpperCase()}${cat.slice(1)}` as
              | 'catApplication' | 'catBilling' | 'catAssignment' | 'catAi' | 'catSupport' | 'catSystem'
            const checked = prefs.categories?.[cat] !== false
            return (
              <label key={cat} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-ink)' }}>
                <input
                  type="checkbox"
                  data-testid={`cat-${cat}`}
                  checked={checked}
                  disabled={busy}
                  onChange={(e) => toggleCategory(cat, e.target.checked)}
                />
                {t(catKey)}
              </label>
            )
          })}
        </div>
      </section>

      {/* ── Quiet hours ─────────────────────────────────────────────────────── */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-pale-stone)' }}>
          {t('quietHours')}
        </h4>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-ink)' }}>
            {t('quietStart')}
            <select
              data-testid="quiet-start"
              disabled={busy}
              value={prefs.quiet_hours_start ?? ''}
              onChange={(e) => setQuietStart(e.target.value)}
              className="rounded border px-2 py-1 text-sm"
              style={{ borderColor: 'var(--color-hairline-2)' }}
            >
              <option value="">{t('off')}</option>
              {HOURS.map((h) => (
                <option key={h} value={h}>{pad(h)}:00</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-ink)' }}>
            {t('quietEnd')}
            <select
              data-testid="quiet-end"
              disabled={busy}
              value={prefs.quiet_hours_end ?? ''}
              onChange={(e) => setQuietEnd(e.target.value)}
              className="rounded border px-2 py-1 text-sm"
              style={{ borderColor: 'var(--color-hairline-2)' }}
            >
              <option value="">{t('off')}</option>
              {HOURS.map((h) => (
                <option key={h} value={h}>{pad(h)}:00</option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 flex flex-col gap-1 text-xs" style={{ color: 'var(--color-ink)' }}>
          {t('timezone')}
          <input
            type="text"
            data-testid="timezone"
            disabled={busy}
            defaultValue={prefs.timezone ?? browserTz}
            onBlur={(e) => setTimezone(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
            style={{ borderColor: 'var(--color-hairline-2)' }}
          />
        </label>
      </section>

      {/* ── Language ────────────────────────────────────────────────────────── */}
      <section>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--color-ink)' }}>
          <span className="font-semibold uppercase tracking-wide" style={{ color: 'var(--color-pale-stone)' }}>
            {t('language')}
          </span>
          <select
            data-testid="pref-language"
            disabled={busy}
            value={prefs.language ?? ''}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
            style={{ borderColor: 'var(--color-hairline-2)' }}
          >
            <option value="">Auto</option>
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
            <option value="de">Deutsch</option>
            <option value="it">Italiano</option>
            <option value="pt">Português</option>
            <option value="nl">Nederlands</option>
            <option value="ar">العربية</option>
            <option value="tr">Türkçe</option>
            <option value="hi">हिन्दी</option>
            <option value="ur">اردو</option>
            <option value="zh">简体中文</option>
            <option value="zh-TW">繁體中文</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
          </select>
        </label>
      </section>

      {error && <p className="text-xs" style={{ color: 'var(--color-rose)' }}>{error}</p>}
    </div>
  )
}
