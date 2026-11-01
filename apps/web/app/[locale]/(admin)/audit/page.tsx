import { getTranslations } from 'next-intl/server'
import { getAuditLogs } from '@/lib/api/admin'

interface AuditRow {
  id?: string
  created_at?: string
  event_type?: string
  application_id?: string
  actor?: unknown
  field_key?: string | null
}

export default async function AdminAuditPage() {
  const [logs, t] = await Promise.all([
    getAuditLogs() as Promise<AuditRow[]>,
    getTranslations('admin'),
  ])
  return (
    <div>
      <h1 className="type-h3" style={{ marginBottom: 12 }}>{t('auditHeading')}</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }} className="mono">
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))' }}>
            <th style={{ padding: '8px 6px' }}>{t('colTimestamp')}</th>
            <th style={{ padding: '8px 6px' }}>{t('colEvent')}</th>
            <th style={{ padding: '8px 6px' }}>{t('colApplication')}</th>
            <th style={{ padding: '8px 6px' }}>{t('colField')}</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l, i) => (
            <tr key={l.id ?? i} style={{ borderBottom: '1px solid var(--color-hairline-2, rgba(0,0,0,.08))' }}>
              <td style={{ padding: '8px 6px', fontSize: '0.75rem' }}>{l.created_at ?? '—'}</td>
              <td style={{ padding: '8px 6px' }}>{l.event_type ?? '—'}</td>
              <td style={{ padding: '8px 6px', fontSize: '0.75rem' }}>{l.application_id?.slice(0, 8) ?? '—'}</td>
              <td style={{ padding: '8px 6px' }}>{l.field_key ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {logs.length === 0 && <p className="sans" style={{ marginTop: 12 }}>{t('noAuditEvents')}</p>}
    </div>
  )
}
