import { getTranslations } from 'next-intl/server'
import type { Route } from 'next'
import { Link } from '@/i18n/navigation'
import { getAdminApplications } from '@/lib/api/assignment'
import { getConsultants } from '@/lib/api/admin'
import { CountryFlag } from '@/components/ui/country-flag'
import { assignedByLabel, deadlineInfo } from '@/lib/assignment-deadline'
import { AdminAssignmentControls } from './admin-assignment-controls'
import { ApplicationsSearch } from './applications-search'
import { parseApplicationsSearch, toApplicationsQuery } from './search-params'

const cell: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--color-hairline-2, rgba(0,0,0,.12))',
  verticalAlign: 'top',
  fontSize: '0.85rem',
}

/**
 * Admin applications portal. Renders every application with its DERIVED
 * assignment status, assigned consultant, and date (all computed server-side).
 * The consultant option list is the existing /admin/users response; assignment
 * actions delegate to the backend (which owns all rules).
 */
export default async function AdminApplicationsPage({
  searchParams,
}: {
  // Next.js 15+: searchParams is a promise that must be awaited.
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const searchValues = parseApplicationsSearch(sp)
  const [apps, consultantUsers, t, tas] = await Promise.all([
    getAdminApplications(toApplicationsQuery(searchValues)),
    getConsultants(),
    getTranslations('admin'),
    getTranslations('assignmentStatus'),
  ])
  const consultants = consultantUsers.map((u) => ({ id: u.id, email: u.email }))

  return (
    <div>
      <h1 className="type-h3" style={{ marginBottom: 8 }}>{t('appsHeading')}</h1>
      <p className="sans" style={{ marginBottom: 16 }}>
        {t('appsDesc')}
      </p>

      <ApplicationsSearch initial={searchValues} />

      {apps.length === 0 ? (
        <p className="mono text-muted">{t('noApplications')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...cell, textAlign: 'left' }} className="mono">{t('colApplication')}</th>
                <th style={{ ...cell, textAlign: 'left' }} className="mono">{t('colCountry')}</th>
                <th style={{ ...cell, textAlign: 'left' }} className="mono">{t('colStatus')}</th>
                <th style={{ ...cell, textAlign: 'left' }} className="mono">{t('colAssigned')}</th>
                <th style={{ ...cell, textAlign: 'left' }} className="mono">Assigned by</th>
                <th style={{ ...cell, textAlign: 'left' }} className="mono">Deadline</th>
                <th style={{ ...cell, textAlign: 'left' }} className="mono">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td style={cell} className="mono">
                    <Link
                      href={`/applications/${a.id}` as Route}
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
                      {/* Decorative: the country code is the visible text. */}
                      {a.destination_country && (
                        <CountryFlag code={a.destination_country} size="sm" />
                      )}
                      <span>{a.destination_country ?? '—'}</span>
                    </span>
                  </td>
                  <td style={cell} className="mono">
                    {tas(a.assignment_status)}
                    <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                      {t('appPrefix', { status: a.status ?? '—' })}
                    </div>
                  </td>
                  <td style={cell} className="mono">
                    {a.assigned_consultant?.email ?? '—'}
                  </td>
                  <td style={cell} className="mono">
                    {a.assigned_consultant
                      ? assignedByLabel(
                          a.assigned_consultant.assigned_by_role,
                          a.assigned_consultant.assigned_by_email,
                        )
                      : '—'}
                  </td>
                  <td style={cell} className="mono">
                    {(() => {
                      const d = deadlineInfo(
                        a.assigned_consultant?.due_at,
                        a.assigned_consultant?.completed_at,
                      )
                      return (
                        <span
                          style={{
                            color:
                              d.state === 'overdue'
                                ? 'var(--color-rose, #b53030)'
                                : d.state === 'completed'
                                  ? 'var(--color-emerald, #1a6b40)'
                                  : 'inherit',
                          }}
                        >
                          {d.label}
                        </span>
                      )
                    })()}
                  </td>
                  <td style={cell}>
                    <AdminAssignmentControls
                      applicationId={a.id}
                      assignmentStatus={a.assignment_status}
                      currentConsultantId={a.assigned_consultant?.id ?? null}
                      consultants={consultants}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
