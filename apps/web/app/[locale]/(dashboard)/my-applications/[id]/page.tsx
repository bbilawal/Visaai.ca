import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { AssignmentTimelineViewer } from '@/components/assignment/assignment-timeline-viewer'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Applicant application detail. Read-only assignment timeline, limited fields
 * (no internal actor detail) — just what the applicant should see about who is
 * handling their case and when.
 */
export default async function MyApplicationDetailPage({ params }: Props) {
  const { id } = await params
  const t = await getTranslations('myApplications')
  return (
    <div>
      <Link
        href="/my-applications"
        className="text-[12px] text-midtone-gray hover:text-rich-black"
      >
        <span className="inline-block rtl:-scale-x-100" aria-hidden>←</span> {t('title')}
      </Link>
      <h1 className="text-[20px] font-semibold tracking-[-0.45px] text-deep-black mt-2 mb-1">
        {t('detailTitle')} · {id.slice(0, 8)}
      </h1>
      <p className="text-[13px] text-midtone-gray mb-6">{t('assignmentHistory')}</p>
      <AssignmentTimelineViewer applicationId={id} limited />

      <div style={{ marginTop: 24 }}>
        <Link
          href={`/messages/${id}`}
          className="text-[13px] text-midtone-gray hover:text-rich-black underline underline-offset-2"
        >
          Messages &rarr;
        </Link>
      </div>
    </div>
  )
}
