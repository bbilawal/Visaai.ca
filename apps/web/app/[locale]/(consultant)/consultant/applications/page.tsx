import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getConsultantQueue } from '@/lib/api/assignment'
import { CountryFlag } from '@/components/ui/country-flag'
import { EmptyState } from '@/components/ui/empty-state'
import { deadlineInfo } from '@/lib/assignment-deadline'
import { TakeOwnershipButton } from './take-ownership-button'
import { MarkCompleteButton } from './mark-complete-button'
import { QueueLiveRefresh } from './queue-live-refresh'

const cell: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--color-hairline-2, rgba(0,0,0,.12))',
  verticalAlign: 'top',
  fontSize: '0.85rem',
}

const deadlineColor: Record<string, string> = {
  overdue: 'var(--color-rose, #b53030)',
  completed: 'var(--color-emerald, #1a6b40)',
  due: 'inherit',
  none: 'inherit',
}

/**
 * Consultant portal — same table layout as the admin applications page. Renders
 * the API response verbatim: `queue` = eligible UNASSIGNED applications visible
 * to every eligible consultant (claiming one removes it from the others'
 * queue); `mine` = applications actively assigned to me, with the review
 * deadline (SLA) and a "Mark complete" action. No filtering/RBAC here — the
 * backend scoped this to the caller's countries and assignments and already
 * swept past-due assignments back into the queue.
 */
export default async function ConsultantApplicationsPage() {
  const [{ queue, mine }, t, tas] = await Promise.all([
    getConsultantQueue(),
    getTranslations('consultant'),
    getTranslations('assignmentStatus'),
  ])

  // Both lists empty → never render two silent blank sections. The most common
  // cause is no country scope mapped yet (strict scope: empty = sees nothing),
  // so the message points the consultant at an admin. Live refresh stays mounted
  // so the page repopulates the moment an admin maps a country / assigns work.
  const isEmpty = queue.length === 0 && mine.length === 0

  if (isEmpty) {
    return (
      <div style={{ display: 'grid', gap: 32 }}>
        <QueueLiveRefresh />
        {/* WEB-011: the empty branch needs the page title too — it is the branch
            a consultant with no mapped country scope actually lands on. */}
        <h1 className="sr-only">{t('portal')}</h1>
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 32 }}>
      {/* live updates: refetch on assignment/creation/expiry events (SSE) */}
      <QueueLiveRefresh />

      {/* WEB-011: the page opened at <h2> with no document title. The two
          sections below are the visible structure, so the page title is
          sr-only rather than a heading the layout never had. */}
      <h1 className="sr-only">{t('portal')}</h1>

      {/* MINE FIRST. The consultant's own assigned work is what they came
          for; the available queue can run to dozens of rows, and rendering it
          first pushed their assignment off-screen inside the shell's inner
          scroll pane — it looked missing while the dashboard counted it. */}
      <section>
        <h2 className="type-h3" style={{ marginBottom: 12 }}>{t('myApplications')}</h2>
        {mine.length === 0 ? (
          <p className="mono text-muted" style={{ fontSize: '0.8rem' }}>
            {t('noAssigned')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...cell, textAlign: 'left' }} className="mono">Application</th>
                  <th style={{ ...cell, textAlign: 'left' }} className="mono">Country</th>
                  <th style={{ ...cell, textAlign: 'left' }} className="mono">Status</th>
                  <th style={{ ...cell, textAlign: 'left' }} className="mono">Deadline</th>
                  <th style={{ ...cell, textAlign: 'left' }} className="mono">Action</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((a) => {
                  const d = deadlineInfo(a.due_at, a.completed_at)
                  return (
                    <tr key={a.id}>
                      <td style={cell} className="mono">
                        <Link
                          href={`/consultant/application/${a.id}`}
                          className="underline underline-offset-2"
                        >
                          {a.id.slice(0, 8)}
                        </Link>
                        <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                          {a.created_at?.slice(0, 10) ?? '—'}
                        </div>
                      </td>
                      <td style={cell} className="mono">
                        <span className="inline-flex items-center gap-2">
                          {a.destination_country && (
                            <CountryFlag code={a.destination_country} size="sm" />
                          )}
                          <span>{a.destination_country ?? '—'}</span>
                        </span>
                      </td>
                      <td style={cell} className="mono">
                        {tas(a.assignment_status)}
                        <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                          {a.visa_type ?? t('visaTBD')} · {t('statusLabel', { status: a.status ?? '—' })}
                        </div>
                      </td>
                      <td className="mono" style={{ ...cell, color: deadlineColor[d.state] }}>
                        {d.label}
                      </td>
                      <td style={cell}>
                        {a.completed_at ? (
                          <span className="mono text-muted" style={{ fontSize: '0.72rem' }}>—</span>
                        ) : (
                          <MarkCompleteButton applicationId={a.id} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="type-h3" style={{ marginBottom: 4 }}>{t('availableQueue')}</h2>
        <p className="sans" style={{ marginBottom: 12 }}>{t('queueDesc')}</p>
        {queue.length === 0 ? (
          <p className="mono text-muted" style={{ fontSize: '0.8rem' }}>
            {t('nothingAvailable')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...cell, textAlign: 'left' }} className="mono">Application</th>
                  <th style={{ ...cell, textAlign: 'left' }} className="mono">Country</th>
                  <th style={{ ...cell, textAlign: 'left' }} className="mono">Status</th>
                  <th style={{ ...cell, textAlign: 'left' }} className="mono">Action</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((a) => (
                  <tr key={a.id}>
                    <td style={cell} className="mono">
                      {a.id.slice(0, 8)}
                      <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                        {a.created_at?.slice(0, 10) ?? '—'}
                      </div>
                    </td>
                    <td style={cell} className="mono">
                      <span className="inline-flex items-center gap-2">
                        {a.destination_country && (
                          <CountryFlag code={a.destination_country} size="sm" />
                        )}
                        <span>{a.destination_country ?? '—'}</span>
                      </span>
                    </td>
                    <td style={cell} className="mono">
                      {tas(a.assignment_status)}
                      <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                        {a.visa_type ?? t('visaTBD')} · {t('statusLabel', { status: a.status ?? '—' })}
                      </div>
                    </td>
                    <td style={cell}>
                      <TakeOwnershipButton applicationId={a.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
