'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { getSession } from '@/lib/supabase/client'
import { retryDelivery } from '@/lib/api/admin-notif-ops-client'
import { Card } from '@/components/ui/card'
import type {
  NotificationOpsMetrics,
  NotificationOpsRange,
  FailedDeliveryPage,
} from '@visaai/types'

// ── constants ──────────────────────────────────────────────────────────────────

const RANGES: NotificationOpsRange[] = ['24h', '7d', '30d']

const RANGE_KEY: Record<NotificationOpsRange, string> = {
  '24h': 'range24h',
  '7d': 'range7d',
  '30d': 'range30d',
}

const cell: React.CSSProperties = { padding: '6px 8px', textAlign: 'left' }

const btnBase: React.CSSProperties = {
  border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
  borderRadius: 4,
  padding: '2px 10px',
  cursor: 'pointer',
  fontSize: '0.8rem',
  background: 'none',
}

// ── sub-components ─────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <div className="mono text-muted" style={{ fontSize: '0.72rem' }}>
        {label}
      </div>
      <div className="type-h2" style={{ marginTop: 4 }}>
        {value}
      </div>
    </Card>
  )
}

function KVTable({ rows }: { rows: [string, number][] }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }} className="mono">
      <tbody>
        {rows.map(([k, v]) => (
          <tr
            key={k}
            style={{ borderBottom: '1px solid var(--color-hairline-2, rgba(0,0,0,.08))' }}
          >
            <td style={cell}>{k}</td>
            <td style={{ ...cell, textAlign: 'right' }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── main component ─────────────────────────────────────────────────────────────

/**
 * Notification Operations screen. Receives SSR-fetched metrics + failed-delivery
 * page; handles range switching via URL, and per-row retry via the NestJS API.
 */
export function NotifOpsScreen({
  metrics,
  failedPage,
  range,
}: {
  metrics: NotificationOpsMetrics
  failedPage: FailedDeliveryPage
  range: NotificationOpsRange
}) {
  const t = useTranslations('adminNotifOps')
  const router = useRouter()
  const pathname = usePathname()

  type RetryStatus = 'loading' | 'ok' | 'error'
  const [retryState, setRetryState] = useState<Record<string, RetryStatus>>({})

  // ── range selector ──────────────────────────────────────────────────────────

  function handleRangeChange(r: NotificationOpsRange) {
    router.replace(`${pathname}?range=${r}`)
  }

  // ── retry ───────────────────────────────────────────────────────────────────

  async function handleRetry(id: string) {
    setRetryState((s) => ({ ...s, [id]: 'loading' }))
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error('no session')
      await retryDelivery(session.access_token, id)
      setRetryState((s) => ({ ...s, [id]: 'ok' }))
      router.refresh()
    } catch {
      setRetryState((s) => ({ ...s, [id]: 'error' }))
    }
  }

  // ── derived ─────────────────────────────────────────────────────────────────

  const failedPlusDead =
    (metrics.byStatus.failed ?? 0) + (metrics.byStatus.dead ?? 0)

  const channelRows = Object.entries(metrics.byChannel).sort(
    ([, a], [, b]) => b - a,
  ) as [string, number][]

  const eventRows = Object.entries(metrics.byEvent).sort(
    ([, a], [, b]) => b - a,
  ) as [string, number][]

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'grid', gap: 28 }}>

      {/* Range selector */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="mono text-muted" style={{ fontSize: '0.82rem' }}>
          {t('rangeLabel')}:
        </span>
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className="mono"
            onClick={() => handleRangeChange(r)}
            aria-pressed={range === r}
            style={{
              ...btnBase,
              background:
                range === r ? 'var(--color-ink, #000)' : 'none',
              color: range === r ? 'var(--color-surface, #fff)' : 'inherit',
              borderColor:
                range === r
                  ? 'var(--color-ink, #000)'
                  : 'var(--color-hairline-2, rgba(0,0,0,.15))',
            }}
          >
            {t(RANGE_KEY[r])}
          </button>
        ))}
      </div>

      {/* Metric cards */}
      <section aria-label={t('title')}>
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          }}
        >
          <Stat label={t('total')} value={metrics.total} />
          <Stat label={t('sent')} value={metrics.byStatus.sent ?? 0} />
          <Stat label={t('failed')} value={failedPlusDead} />
          <Stat label={t('skipped')} value={metrics.byStatus.skipped ?? 0} />
          <Stat label={t('queued')} value={metrics.byStatus.queued ?? 0} />
        </div>
      </section>

      {/* Channel + event breakdown */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <h2 className="mono" style={{ fontSize: '0.82rem', marginBottom: 8 }}>
            {t('channels')}
          </h2>
          {channelRows.length === 0 ? (
            <p className="mono text-muted" style={{ fontSize: '0.8rem' }}>
              0
            </p>
          ) : (
            <KVTable rows={channelRows} />
          )}
        </Card>

        <Card>
          <h2 className="mono" style={{ fontSize: '0.82rem', marginBottom: 8 }}>
            {t('events')}
          </h2>
          {eventRows.length === 0 ? (
            <p className="mono text-muted" style={{ fontSize: '0.8rem' }}>
              0
            </p>
          ) : (
            <KVTable rows={eventRows} />
          )}
        </Card>
      </div>

      {/* Queue panel */}
      <Card>
        <h2 className="mono" style={{ fontSize: '0.82rem', marginBottom: 12 }}>
          {t('queuePanel')}
        </h2>
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
          }}
        >
          {(
            [
              ['queueWaiting', metrics.queue.waiting],
              ['queueActive', metrics.queue.active],
              ['queueCompleted', metrics.queue.completed],
              ['queueFailed', metrics.queue.failed],
              ['queueDelayed', metrics.queue.delayed],
            ] as [string, number][]
          ).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="mono text-muted" style={{ fontSize: '0.72rem' }}>
                {t(key)}
              </span>
              <span className="type-h3">{val}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Failed delivery table */}
      <section>
        <h2 className="mono" style={{ fontSize: '0.9rem', marginBottom: 10 }}>
          {t('failedTitle')}
          {failedPage.total > 0 && (
            <span
              className="text-muted"
              style={{ fontSize: '0.75rem', marginLeft: 8 }}
            >
              ({failedPage.total})
            </span>
          )}
        </h2>

        {failedPage.rows.length === 0 ? (
          <p className="mono text-muted" style={{ fontSize: '0.82rem' }}>
            {t('noFailed')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{ width: '100%', borderCollapse: 'collapse' }}
              className="mono"
            >
              <thead>
                <tr
                  style={{
                    textAlign: 'left',
                    borderBottom:
                      '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
                  }}
                >
                  <th style={cell}>{t('colEvent')}</th>
                  <th style={cell}>{t('colChannel')}</th>
                  <th style={cell}>{t('colAttempts')}</th>
                  <th style={cell}>{t('colError')}</th>
                  <th style={cell}>{t('colTime')}</th>
                  <th style={cell}></th>
                </tr>
              </thead>
              <tbody>
                {failedPage.rows.map((row) => {
                  const rs = retryState[row.id]
                  return (
                    <tr
                      key={row.id}
                      style={{
                        borderBottom:
                          '1px solid var(--color-hairline-2, rgba(0,0,0,.08))',
                      }}
                    >
                      <td style={cell}>{row.eventType}</td>
                      <td style={cell}>{row.channel}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>
                        {row.attempts}
                      </td>
                      <td
                        style={{
                          ...cell,
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: 'var(--color-rose, #b53030)',
                          fontSize: '0.75rem',
                        }}
                        title={row.error ?? undefined}
                      >
                        {row.error ?? '—'}
                      </td>
                      <td style={{ ...cell, fontSize: '0.75rem' }}>
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td style={cell}>
                        <button
                          type="button"
                          className="mono"
                          disabled={rs === 'loading'}
                          onClick={() => void handleRetry(row.id)}
                          style={{
                            ...btnBase,
                            opacity: rs === 'loading' ? 0.6 : 1,
                            color:
                              rs === 'error'
                                ? 'var(--color-rose, #b53030)'
                                : rs === 'ok'
                                  ? 'var(--color-emerald, #1a6b40)'
                                  : 'inherit',
                          }}
                          aria-label={`${t('retry')} ${row.eventType}`}
                        >
                          {rs === 'loading'
                            ? '…'
                            : rs === 'ok'
                              ? '✓'
                              : rs === 'error'
                                ? '✗'
                                : t('retry')}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
