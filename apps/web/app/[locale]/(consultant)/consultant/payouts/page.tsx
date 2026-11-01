import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import {
  getPayoutEarnings,
  getPayoutHistory,
  getPayoutStatus,
  type PayoutHistory,
  type PayoutStatus,
} from '@/lib/api/payouts'
import { PayoutActions } from './payout-actions'
import type { ConsultantEarnings } from '@visaai/types'

/**
 * Consultant payouts. Stripe's Account Link `return_url` points here, so this
 * route must exist for hosted onboarding to complete anywhere but a 404.
 *
 * Every figure is read from the server-side ledger — nothing about money is
 * computed in the browser.
 */
export default async function ConsultantPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarded?: string; refresh?: string }>
}) {
  const [params, t] = await Promise.all([
    searchParams,
    getTranslations('consultant.payouts'),
  ])

  // Each call 403s for a non-consultant and the dashboard-link route 400s before
  // onboarding. Settle them independently so one expected failure cannot blank
  // the whole page.
  const [statusR, earningsR, historyR] = await Promise.allSettled([
    getPayoutStatus(),
    getPayoutEarnings(),
    getPayoutHistory(),
  ])

  const status: PayoutStatus | null =
    statusR.status === 'fulfilled' ? statusR.value : null
  const earnings: ConsultantEarnings | null =
    earningsR.status === 'fulfilled' ? earningsR.value : null
  const history: PayoutHistory =
    historyR.status === 'fulfilled'
      ? historyR.value
      : { payouts: [], items: [] }

  if (!status) {
    // Reachable by a REAL consultant: the role comes from app_metadata (or an
    // active assignment), while payouts need a consultant_profiles row, which
    // is created separately. Someone can therefore hold cases and be unpayable.
    // Dead-ending them here is the bug — the profile form is the way out, and
    // it only appears in the applicant nav, so link it explicitly.
    return (
      <div style={{ display: 'grid', gap: 24 }}>
        <h1 className="type-h2">{t('title')}</h1>
        <div className="alert alert-warning">{t('noProfile')}</div>
        <div>
          <Link href="/become-a-consultant" className="btn btn-primary">
            {t('createProfile')}
          </Link>
        </div>
      </div>
    )
  }

  const money = (n: number, currency = 'usd') =>
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(n)

  const itemsByPayout = new Map<string, number>()
  for (const it of history.items) {
    itemsByPayout.set(it.payout_id, (itemsByPayout.get(it.payout_id) ?? 0) + 1)
  }

  const badge =
    status.kyc_status === 'verified'
      ? 'badge-emerald'
      : status.kyc_status === 'rejected'
        ? 'badge-rose'
        : status.kyc_status === 'pending'
          ? 'badge-amber'
          : 'badge-neutral'

  return (
    <div style={{ display: 'grid', gap: 32 }}>
      <section>
        <h1 className="type-h2" style={{ marginBottom: 8 }}>
          {t('title')}
        </h1>
        <p className="text-muted">{t('subtitle')}</p>
      </section>

      {params.onboarded === '1' && !status.payouts_enabled && (
        // Stripe bounces back the moment the form is submitted — verification
        // is asynchronous, so "submitted" must not be shown as "you'll be paid".
        <div className="alert alert-info">{t('submittedPending')}</div>
      )}

      <section className="card" style={{ display: 'grid', gap: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <strong>{t('statusHeading')}</strong>
          <span className={`badge ${badge}`}>
            {t(`kyc.${status.kyc_status}`)}
          </span>
          {status.payouts_enabled && (
            <span className="badge badge-emerald">{t('payoutsEnabled')}</span>
          )}
        </div>

        <p className="text-muted">
          {!status.onboarded
            ? t('describeNotStarted')
            : status.payouts_enabled
              ? t('describeEnabled')
              : t('describePending')}
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {!status.payouts_enabled && (
            <PayoutActions action="onboard" />
          )}
          {status.onboarded && (
            <PayoutActions
              action="dashboard"
              variant={status.payouts_enabled ? 'primary' : 'secondary'}
            />
          )}
        </div>
      </section>

      <section>
        <h2 className="type-h3" style={{ marginBottom: 16 }}>
          {t('earningsHeading')}
        </h2>
        {earnings ? (
          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <div className="card card-snug">
              <div className="text-muted">{t('pending')}</div>
              <div className="type-h3">
                {money(earnings.pending_usd, earnings.currency)}
              </div>
            </div>
            <div className="card card-snug">
              <div className="text-muted">{t('paidOut')}</div>
              <div className="type-h3">
                {money(earnings.paid_out_usd, earnings.currency)}
              </div>
            </div>
            <div className="card card-snug">
              <div className="text-muted">{t('lifetime')}</div>
              <div className="type-h3">
                {money(earnings.lifetime_usd, earnings.currency)}
              </div>
            </div>
            <div className="card card-snug">
              <div className="text-muted">{t('orders')}</div>
              <div className="type-h3">{earnings.orders_count}</div>
            </div>
          </div>
        ) : (
          <div className="alert alert-warning">{t('earningsUnavailable')}</div>
        )}
      </section>

      <section>
        <h2 className="type-h3" style={{ marginBottom: 16 }}>
          {t('historyHeading')}
        </h2>
        {history.payouts.length === 0 ? (
          <p className="text-muted">{t('noPayouts')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>{t('colDate')}</th>
                  <th style={{ textAlign: 'left' }}>{t('colAmount')}</th>
                  <th style={{ textAlign: 'left' }}>{t('colStatus')}</th>
                  <th style={{ textAlign: 'left' }}>{t('colOrders')}</th>
                </tr>
              </thead>
              <tbody>
                {history.payouts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.period_end ??
                        new Date(p.created_at).toISOString().slice(0, 10)}
                    </td>
                    <td>{money(p.amount_usd, p.currency)}</td>
                    <td>
                      <span className="badge badge-neutral">{p.status}</span>
                    </td>
                    <td>{itemsByPayout.get(p.id) ?? 0}</td>
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
