import { getTranslations } from 'next-intl/server'
import type { Route } from 'next'
import { Link } from '@/i18n/navigation'
import type { AdminApplicationView } from '@visaai/types'
import { getAdminApplications } from '@/lib/api/assignment'
import { getConsultants } from '@/lib/api/admin'
import { CountryFlag } from '@/components/ui/country-flag'
import { deadlineInfo } from '@/lib/assignment-deadline'
import { AdminAssignmentControls } from '../applications/admin-assignment-controls'
import { ApplicationsSearch } from '../applications/applications-search'
import {
  parseApplicationsSearch,
  toApplicationsQuery,
} from '../applications/search-params'

const cell: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--color-hairline-2, rgba(0,0,0,.12))',
  verticalAlign: 'top',
  fontSize: '0.85rem',
}

/**
 * Admin assignment workspace — assignment-focused triage view (distinct from
 * /applications, which is the full lifecycle list). Leads with applications that
 * NEED a consultant (UNASSIGNED), then the already-assigned ones for reassign/
 * deadline ops. All actions go through the same AdminAssignmentControls (backend
 * owns every rule). The consultant picker is the existing /admin/users list.
 */
export default async function AdminAssignmentsPage({
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

  const unassigned = apps.filter((a) => a.assignment_status === 'UNASSIGNED')
  const assigned = apps.filter((a) => a.assignment_status === 'ASSIGNED')

  return (
    <div style={{ display: 'grid', gap: 32 }}>
      <div>
        <h1 className="type-h3" style={{ marginBottom: 8 }}>{t('assignHeading')}</h1>
        <p className="sans">{t('assignDesc')}</p>
      </div>

      <ApplicationsSearch initial={searchValues} />

      {consultants.length === 0 && (
        <p className="mono text-muted" style={{ fontSize: '0.8rem' }}>
          No consultants exist yet — set a user&apos;s role to &quot;consultant&quot; in User management first.
        </p>
      )}

      <Section
        title={`Needs assignment (${unassigned.length})`}
        empty="Every application has a consultant. 🎉"
        apps={unassigned}
        consultants={consultants}
        tas={tas}
        showDeadline={false}
      />

      <Section
        title={`Assigned (${assigned.length})`}
        empty="No applications assigned yet."
        apps={assigned}
        consultants={consultants}
        tas={tas}
        showDeadline
      />
    </div>
  )
}

function Section({
  title,
  empty,
  apps,
  consultants,
  tas,
  showDeadline,
}: {
  title: string
  empty: string
  apps: AdminApplicationView[]
  consultants: { id: string; email: string }[]
  tas: (key: string) => string
  showDeadline: boolean
}) {
  return (
    <section>
      <h2 className="mono" style={{ fontSize: '0.9rem', marginBottom: 8 }}>{title}</h2>
      {apps.length === 0 ? (
        <p className="mono text-muted" style={{ fontSize: '0.8rem' }}>{empty}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...cell, textAlign: 'left' }} className="mono">Application</th>
                <th style={{ ...cell, textAlign: 'left' }} className="mono">Country</th>
                <th style={{ ...cell, textAlign: 'left' }} className="mono">Status</th>
                <th style={{ ...cell, textAlign: 'left' }} className="mono">Assigned</th>
                {showDeadline && <th style={{ ...cell, textAlign: 'left' }} className="mono">Deadline</th>}
                <th style={{ ...cell, textAlign: 'left' }} className="mono">Action</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => {
                const d = deadlineInfo(a.assigned_consultant?.due_at, a.assigned_consultant?.completed_at)
                return (
                  <tr key={a.id}>
                    <td style={cell} className="mono">
                      <Link href={`/applications/${a.id}` as Route} className="underline underline-offset-2">
                        {a.id.slice(0, 8)}
                      </Link>
                      <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                        {a.created_at?.slice(0, 10) ?? '—'}
                      </div>
                    </td>
                    <td style={cell} className="mono">
                      <span className="inline-flex items-center gap-2">
                        {a.destination_country && <CountryFlag code={a.destination_country} size="sm" />}
                        <span>{a.destination_country ?? '—'}</span>
                      </span>
                    </td>
                    <td style={cell} className="mono">
                      {tas(a.assignment_status)}
                      <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                        {a.status ?? '—'}
                      </div>
                    </td>
                    <td style={cell} className="mono">{a.assigned_consultant?.email ?? '—'}</td>
                    {showDeadline && (
                      <td className="mono" style={{ ...cell, color: d.state === 'overdue' ? 'var(--color-rose, #b53030)' : d.state === 'completed' ? 'var(--color-emerald, #1a6b40)' : 'inherit' }}>
                        {d.label}
                      </td>
                    )}
                    <td style={cell}>
                      <AdminAssignmentControls
                        applicationId={a.id}
                        assignmentStatus={a.assignment_status}
                        currentConsultantId={a.assigned_consultant?.id ?? null}
                        consultants={consultants}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
