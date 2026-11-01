import { getTranslations } from 'next-intl/server'
import type { Route } from 'next'
import { Link } from '@/i18n/navigation'
import { AssignmentTimelineViewer } from '@/components/assignment/assignment-timeline-viewer'
import { PrefillWaiverControl } from './prefill-waiver-control'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Admin application detail. Read-only assignment lifecycle timeline for one
 * application (full actor detail). Assignment actions live on the list page.
 */
export default async function AdminApplicationDetailPage({ params }: Props) {
  const { id } = await params
  const t = await getTranslations('admin')
  return (
    <div>
      <Link href={'/applications' as Route} className="mono" style={{ fontSize: '0.78rem' }}>
        {t('backAllApplications')}
      </Link>
      <h2 className="type-h3" style={{ margin: '8px 0 4px' }}>{t('detailHeading', { id: id.slice(0, 8) })}</h2>
      <p className="sans" style={{ marginBottom: 20 }}>{t('detailDesc')}</p>
      <PrefillWaiverControl applicationId={id} />
      <AssignmentTimelineViewer applicationId={id} />
    </div>
  )
}
