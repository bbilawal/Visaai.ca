import { getTranslations } from 'next-intl/server'
import {
  getSubscriptionMetrics,
  getOutstanding,
  getRevenueReport,
  getRefunds,
  getDisputes,
  type ReportDimension,
} from '@/lib/api/admin-billing'
import { centsToUsd } from '@/lib/money'
import { Card } from '@/components/ui/card'
import { RevenueControls } from './revenue-controls'
import { RefundForm } from './refund-form'

const DIMS: ReportDimension[] = ['country', 'visa', 'plan', 'feature']

function coerceDim(v: string | string[] | undefined): ReportDimension {
  const s = Array.isArray(v) ? v[0] : v
  return DIMS.includes(s as ReportDimension) ? (s as ReportDimension) : 'country'
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="c-2">{label}</div>
      <div className="type-h2" style={{ marginTop: 4 }}>{value}</div>
      {sub && <div className="c-2" style={{ marginTop: 4 }}>{sub}</div>}
    </Card>
  )
}

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; by?: string }>
}) {
  const sp = await searchParams
  const to = sp.to || isoDate(new Date())
  const from = sp.from || isoDate(new Date(Date.now() - 30 * 864e5))
  const by = coerceDim(sp.by)
  const t = await getTranslations('adminBilling')

  const [metrics, outstanding, report, refunds, disputes] = await Promise.allSettled([
    getSubscriptionMetrics(),
    getOutstanding(),
    getRevenueReport(from, to, by),
    getRefunds(),
    getDisputes(),
  ])

  const m = metrics.status === 'fulfilled' ? metrics.value : null
  const o = outstanding.status === 'fulfilled' ? outstanding.value : null
  const r = report.status === 'fulfilled' ? report.value : null
  const refundRows = refunds.status === 'fulfilled' ? refunds.value : []
  const disputeRows = disputes.status === 'fulfilled' ? disputes.value : []

  const controlLabels: Record<string, string> = {
    from: t('from'), to: t('to'), dimension: t('dimension'), exportCsv: t('exportCsv'),
    country: t('country'), visa: t('visa'), plan: t('plan'), feature: t('feature'),
  }
  const refundLabels: Record<string, string> = {
    refundTitle: t('refundTitle'), paymentId: t('paymentId'), amountOptional: t('amountOptional'),
    reason: t('reason'), issueRefund: t('issueRefund'), refundOk: t('refundOk'), error: t('error'),
  }

  return (
    <div style={{ display: 'grid', gap: 32 }}>
      <h1 className="type-h2">{t('title')}</h1>

      <section style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Tile
          label={t('mrr')}
          value={m ? centsToUsd(m.mrrCents) : '—'}
          sub={m ? t('byPlan', { base: m.byPlan.base, pro: m.byPlan.pro, premium: m.byPlan.premium }) : undefined}
        />
        <Tile label={t('arr')} value={m ? centsToUsd(m.arrCents) : '—'} />
        <Tile label={t('activeSubs')} value={m ? String(m.active) : '—'} />
        <Tile label={t('outstanding')} value={o ? centsToUsd(o.amountCents) : '—'} sub={o ? `${o.count}` : undefined} />
      </section>

      <section style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Tile label={t('collected')} value={r ? centsToUsd(r.summary.collectedCents) : '—'} />
        <Tile label={t('refunded')} value={r ? centsToUsd(r.summary.refundedCents) : '—'} />
        <Tile label={t('net')} value={r ? centsToUsd(r.summary.netCents) : '—'} />
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <RevenueControls from={from} to={to} by={by} labels={controlLabels} />
        <h2 className="type-h3">{t('revenueBy', { dim: t(by) })}</h2>
        <Table
          headers={[t('key'), t('net')]}
          rows={(r?.breakdown ?? []).map((b) => [b.key, centsToUsd(b.netCents)])}
          empty={t('none')}
        />
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <h2 className="type-h3">{t('refunds')}</h2>
        <Table
          headers={[t('date'), t('amount'), t('status'), t('reason')]}
          rows={refundRows.map((x) => [fmtDate(x.created_at), centsToUsd(x.amount_cents), x.status, x.reason ?? ''])}
          empty={t('none')}
        />
        <h2 className="type-h3">{t('disputes')}</h2>
        <Table
          headers={[t('date'), t('amount'), t('status'), t('reason')]}
          rows={disputeRows.map((x) => [fmtDate(x.created_at), x.amount_cents != null ? centsToUsd(x.amount_cents) : '—', x.status, x.reason ?? ''])}
          empty={t('none')}
        />
      </section>

      <section>
        <RefundForm labels={refundLabels} />
      </section>
    </div>
  )
}

function fmtDate(iso: string): string {
  return iso ? iso.slice(0, 10) : ''
}

function Table({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <div className="c-2">{empty}</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="c-2" style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--hairline-2)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: '6px 8px', borderBottom: '1px solid var(--hairline-2)' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
