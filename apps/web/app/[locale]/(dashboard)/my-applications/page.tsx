import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getApplicantApplications } from '@/lib/api/assignment'
import { CountryFlag } from '@/components/ui/country-flag'
import { assignedByLabel, deadlineInfo } from '@/lib/assignment-deadline'
import { ApplicationsAutoRefresh } from './applications-auto-refresh'

/**
 * Applicant portal. Renders the caller's own applications with derived
 * assignment status and the assigned consultant (computed server-side). No
 * logic here — purely a view over GET /applicant/applications.
 */
export default async function MyApplicationsPage() {
  const t = await getTranslations('myApplications')
  const ts = await getTranslations('status')
  const tas = await getTranslations('assignmentStatus')
  const apps = await getApplicantApplications()

  return (
    <div>
      {/* #38: re-pull when a consultant claims an application meanwhile. */}
      <ApplicationsAutoRefresh />
      <h1 className="text-[22px] font-semibold tracking-[-0.45px] text-deep-black mb-1">
        {t('title')}
      </h1>
      <p className="text-[13px] text-midtone-gray mb-6">
        {t('subtitle')}
      </p>

      {apps.length === 0 ? (
        <p className="text-[14px] text-midtone-gray">{t('none')}</p>
      ) : (
        <ul className="grid gap-3 list-none p-0">
          {apps.map((a) => (
            <li
              key={a.id}
              className="border border-subtle-ash rounded-[12px] p-4 bg-canvas-white"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <Link
                  href={`/my-applications/${a.id}`}
                  className="inline-flex items-center gap-2 text-[14px] font-medium text-rich-black underline underline-offset-2"
                >
                  {/* Decorative: the country code is the visible text. */}
                  {a.destination_country && (
                    <CountryFlag code={a.destination_country} size="sm" />
                  )}
                  <span>{a.destination_country ?? '—'} · {a.id.slice(0, 8)}</span>
                </Link>
                <span
                  className={
                    'text-[11px] px-2 py-0.5 rounded-full ' +
                    (a.assignment_status === 'ASSIGNED'
                      ? 'bg-ghost-gray text-deep-black'
                      : 'bg-ghost-gray text-midtone-gray')
                  }
                >
                  {tas(a.assignment_status)}
                </span>
              </div>
              <p className="text-[12px] text-midtone-gray mt-2">
                {t('appStatus')} {a.status ? (ts.has(a.status) ? ts(a.status) : a.status) : '—'}
              </p>
              <p className="text-[12px] text-midtone-gray mt-1">
                {t('consultant')}{' '}
                <span className="text-rich-black">
                  {a.assigned_consultant ? a.assigned_consultant.email ?? a.assigned_consultant.id : t('notAssigned')}
                </span>
              </p>
              {a.assigned_consultant && (
                <>
                  {/* Who created the assignment: self-claimed vs assigned by an admin. */}
                  <p className="text-[12px] text-midtone-gray mt-1">
                    Assigned by:{' '}
                    <span className="text-rich-black">
                      {assignedByLabel(
                        a.assigned_consultant.assigned_by_role,
                        a.assigned_consultant.assigned_by_email,
                      )}
                    </span>
                  </p>
                  {(() => {
                    const d = deadlineInfo(
                      a.assigned_consultant.due_at,
                      a.assigned_consultant.completed_at,
                    )
                    return d.state === 'none' ? null : (
                      <p className="text-[12px] text-midtone-gray mt-1">
                        Review:{' '}
                        <span
                          className={
                            d.state === 'overdue'
                              ? 'text-rose'
                              : d.state === 'completed'
                                ? 'text-emerald'
                                : 'text-rich-black'
                          }
                        >
                          {d.label}
                        </span>
                      </p>
                    )
                  })()}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
