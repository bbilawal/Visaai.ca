import { getTranslations } from 'next-intl/server'
import { getBroadcasts } from '@/lib/api/admin-broadcasts'
import { BroadcastsClient } from './broadcasts-client'

/**
 * Admin Broadcast Announcements page (RSC).
 * Loads the most recent broadcast history and mounts the composer client
 * island (title/body/category/link + audience selector + in-page confirm).
 */
export default async function AdminBroadcastsPage() {
  const [page, t] = await Promise.all([
    getBroadcasts(),
    getTranslations('adminBroadcasts'),
  ])

  return (
    <div>
      <h1 style={{ marginBottom: 12 }}>{t('title')}</h1>
      <BroadcastsClient initialBroadcasts={page.rows} />
    </div>
  )
}
