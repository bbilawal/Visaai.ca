'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { getSession } from '@/lib/supabase/client'
import { downloadRevenueCsv } from '@/lib/api/admin-billing-client'
import type { ReportDimension } from '@/lib/api/admin-billing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const DIMS: ReportDimension[] = ['country', 'visa', 'plan', 'feature']

export function RevenueControls({
  from,
  to,
  by,
  labels,
}: {
  from: string
  to: string
  by: ReportDimension
  labels: Record<string, string>
}) {
  const router = useRouter()
  const [f, setF] = useState(from)
  const [t, setT] = useState(to)
  const [d, setD] = useState<ReportDimension>(by)
  const [busy, setBusy] = useState(false)

  function apply(next: Partial<{ f: string; t: string; d: ReportDimension }>) {
    const nf = next.f ?? f
    const nt = next.t ?? t
    const nd = next.d ?? d
    router.push(`/admin/billing?from=${nf}&to=${nt}&by=${nd}`)
  }

  async function exportCsv() {
    setBusy(true)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) return
      const blob = await downloadRevenueCsv(session.access_token, f, t, d)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `revenue-${f}_${t}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label>
        <div className="c-2">{labels.from}</div>
        <Input type="date" value={f} onChange={(e) => setF(e.target.value)} onBlur={() => apply({})} />
      </label>
      <label>
        <div className="c-2">{labels.to}</div>
        <Input type="date" value={t} onChange={(e) => setT(e.target.value)} onBlur={() => apply({})} />
      </label>
      <label>
        <div className="c-2">{labels.dimension}</div>
        <select
          aria-label={labels.dimension}
          value={d}
          onChange={(e) => {
            const nd = e.target.value as ReportDimension
            setD(nd)
            apply({ d: nd })
          }}
        >
          {DIMS.map((dim) => (
            <option key={dim} value={dim}>
              {labels[dim] ?? dim}
            </option>
          ))}
        </select>
      </label>
      <Button type="button" onClick={exportCsv} disabled={busy}>
        {labels.exportCsv}
      </Button>
    </div>
  )
}
