'use client'

import { useState } from 'react'
import { getSession } from '@/lib/supabase/client'
import { createCoupon, type CreateCouponInput } from '@/lib/api/admin-billing-client'
import { ApiError } from '@/lib/api/client'
import { usdToCents } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'

const APPLIES: CreateCouponInput['appliesTo'][] = [
  'processing_fee',
  'addon',
  'subscription',
  'any',
]

export function CouponForm({ labels }: { labels: Record<string, string> }) {
  const [code, setCode] = useState('')
  const [kind, setKind] = useState<'percent' | 'amount'>('percent')
  const [percentOff, setPercentOff] = useState('')
  const [amountOff, setAmountOff] = useState('')
  const [appliesTo, setAppliesTo] = useState<CreateCouponInput['appliesTo']>('processing_fee')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error('no session')
      const input: CreateCouponInput = {
        code: code.trim(),
        kind,
        appliesTo,
        ...(kind === 'percent'
          ? { percentOff: Number(percentOff) }
          : { amountOffCents: usdToCents(amountOff) ?? 0 }),
        ...(maxRedemptions.trim() ? { maxRedemptions: Number(maxRedemptions) } : {}),
        ...(validUntil.trim() ? { validUntil } : {}),
      }
      await createCoupon(session.access_token, input)
      setMsg({ ok: true, text: labels.couponOk })
      setCode('')
      setPercentOff('')
      setAmountOff('')
    } catch (err) {
      // Coupons carry a server-side margin floor, so a rejection here is
      // meaningful (below-floor / duplicate code) rather than a generic fault.
      console.error('[admin-coupons] create failed', err)
      const detail = err instanceof ApiError ? ` (${err.status})` : ''
      setMsg({ ok: false, text: `${labels.error}${detail}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
      {msg && <Alert variant={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
      <label>
        <div className="c-2">{labels.code}</div>
        <Input value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      <label>
        <div className="c-2">{labels.kind}</div>
        <select aria-label={labels.kind} value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'amount')}>
          <option value="percent">{labels.percent}</option>
          <option value="amount">{labels.amountKind}</option>
        </select>
      </label>
      {kind === 'percent' ? (
        <label>
          <div className="c-2">{labels.percentOff}</div>
          <Input value={percentOff} onChange={(e) => setPercentOff(e.target.value)} inputMode="numeric" />
        </label>
      ) : (
        <label>
          <div className="c-2">{labels.amountOff}</div>
          <Input value={amountOff} onChange={(e) => setAmountOff(e.target.value)} inputMode="decimal" />
        </label>
      )}
      <label>
        <div className="c-2">{labels.appliesTo}</div>
        <select aria-label={labels.appliesTo} value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as CreateCouponInput['appliesTo'])}>
          {APPLIES.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>
      <label>
        <div className="c-2">{labels.maxRedemptions}</div>
        <Input value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} inputMode="numeric" />
      </label>
      <label>
        <div className="c-2">{labels.validUntil}</div>
        <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
      </label>
      <Button type="submit" disabled={busy || !code.trim()}>
        {labels.createCoupon}
      </Button>
    </form>
  )
}
