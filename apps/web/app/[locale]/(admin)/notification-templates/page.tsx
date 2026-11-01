import { getTranslations } from 'next-intl/server'
import { getTemplates } from '@/lib/api/admin-templates'
import { TemplatesClient } from './templates-client'

/**
 * Admin Notification Templates page (RSC).
 * Lists all templates grouped by (event_type, locale) and mounts the
 * client editor island for create / update / preview / history.
 */
export default async function AdminNotificationTemplatesPage() {
  const [templates, t] = await Promise.all([
    getTemplates(),
    getTranslations('adminTemplates'),
  ])

  return (
    <div>
      <h1 style={{ marginBottom: 12 }}>{t('title')}</h1>
      <TemplatesClient initialTemplates={templates} />
    </div>
  )
}
