import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getUserDetail, getRoleCatalog, type RoleCatalogEntry } from '@/lib/api/admin'
import { UserDetailClient } from '../user-detail-client'

// ── Types ─────────────────────────────────────────────────────────────────────

type PageParams = Promise<{ locale: string; id: string }>

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--color-emerald, #1a6b40)',
  suspended: '#8a5f00',
  deleted: 'var(--color-rose, #b53030)',
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const color = STATUS_COLOR[status] ?? 'inherit'
  return (
    <span
      className="mono"
      style={{
        fontSize: '0.75rem',
        padding: '2px 8px',
        borderRadius: 3,
        background: `${color}1a`,
        color,
        border: `1px solid ${color}55`,
      }}
    >
      {label}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AdminUserDetailPage({ params }: { params: PageParams }) {
  // Next 16: params is a Promise — must be awaited
  const { id } = await params

  const [detail, roleCatalog, t, supabase] = await Promise.all([
    getUserDetail(id),
    // Secondary data — never let a catalog fetch failure take down the page.
    getRoleCatalog().catch(() => [] as RoleCatalogEntry[]),
    getTranslations('adminUsers'),
    createClient(),
  ])

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? ''

  const statusLabel =
    detail.status === 'active'
      ? t('statusActive')
      : detail.status === 'suspended'
        ? t('statusSuspended')
        : t('statusDeleted')

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString() : '—'

  return (
    <div style={{ maxWidth: 760 }}>
      {/* ── Identity panel ─────────────────────────────────────────────────── */}
      <section
        aria-label={t('identity')}
        style={{
          background: 'var(--color-paper-canvas, #f6f3f1)',
          border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 className="type-h3" style={{ margin: 0 }}>
            {detail.fullName ?? detail.email}
          </h2>
          <StatusBadge status={detail.status} label={statusLabel} />
        </div>

        <dl
          className="mono"
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            gap: '6px 16px',
            fontSize: '0.82rem',
          }}
        >
          <dt style={{ color: 'var(--color-pale-stone, #4e4d4d)' }}>Email</dt>
          <dd style={{ margin: 0 }}>{detail.email}</dd>

          {detail.nationality && (
            <>
              <dt style={{ color: 'var(--color-pale-stone, #4e4d4d)' }}>Nationality</dt>
              <dd style={{ margin: 0 }}>{detail.nationality}</dd>
            </>
          )}

          <dt style={{ color: 'var(--color-pale-stone, #4e4d4d)' }}>{t('lastSignIn')}</dt>
          <dd style={{ margin: 0 }}>{fmt(detail.lastSignInAt)}</dd>

          <dt style={{ color: 'var(--color-pale-stone, #4e4d4d)' }}>{t('createdAt')}</dt>
          <dd style={{ margin: 0 }}>{fmt(detail.createdAt)}</dd>

          <dt style={{ color: 'var(--color-pale-stone, #4e4d4d)' }}>{t('emailConfirmed')}</dt>
          <dd style={{ margin: 0 }}>{fmt(detail.emailConfirmedAt)}</dd>

          <dt style={{ color: 'var(--color-pale-stone, #4e4d4d)' }}>{t('applicationsCount')}</dt>
          <dd style={{ margin: 0 }}>{detail.applicationsCount}</dd>
        </dl>
      </section>

      {/* ── Client island: lifecycle actions + roles editor ─────────────────── */}
      <UserDetailClient
        detail={detail}
        roleCatalog={roleCatalog}
        currentUserId={currentUserId}
      />

      {/* ── Recent auth audit ──────────────────────────────────────────────── */}
      <section aria-label={t('recentActivity')} style={{ marginTop: 24 }}>
        <h3 className="mono" style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 10 }}>
          {t('recentActivity')}
        </h3>
        {detail.recentAuth.length === 0 ? (
          <p className="mono text-muted" style={{ fontSize: '0.82rem' }}>
            —
          </p>
        ) : (
          <table
            className="mono"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}
          >
            <thead>
              <tr
                style={{
                  textAlign: 'left',
                  borderBottom: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
                }}
              >
                <th style={{ padding: '6px 8px' }}>Event</th>
                <th style={{ padding: '6px 8px' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {detail.recentAuth.map((row) => (
                <tr
                  key={row.id}
                  style={{ borderBottom: '1px solid var(--color-hairline-2, rgba(0,0,0,.06))' }}
                >
                  <td style={{ padding: '6px 8px' }}>{row.eventType}</td>
                  <td style={{ padding: '6px 8px' }}>{fmt(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
