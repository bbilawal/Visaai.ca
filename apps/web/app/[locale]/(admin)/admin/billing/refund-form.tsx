'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { getSession } from '@/lib/supabase/client'
import { initiateRefund } from '@/lib/api/admin-billing-client'
import { ApiError } from '@/lib/api/client'
import { usdToCents } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'

export function RefundForm({ labels }: { labels: Record<string, string> }) {
  const router = useRouter()
  const [paymentId, setPaymentId] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!paymentId.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error('no session')
      const cents = amount.trim() ? (usdToCents(amount) ?? undefined) : undefined
      await initiateRefund(session.access_token, paymentId.trim(), cents, reason || undefined)
      setMsg({ ok: true, text: labels.refundOk })
      setPaymentId('')
      setAmount('')
      setReason('')
      router.refresh()
    } catch (err) {
      // A refund moves real money — never report the failure as a bare string.
      // ApiError carries the status the API replied with; anything else is a
      // network/parse fault and is logged intact for the console.
      console.error('[admin-billing] refund failed', err)
      const detail = err instanceof ApiError ? ` (${err.status})` : ''
      setMsg({ ok: false, text: `${labels.error}${detail}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
      <h3 className="h-4">{labels.refundTitle}</h3>
      {msg && <Alert variant={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
      <label>
        <div className="c-2">{labels.paymentId}</div>
        <Input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} required />
      </label>
      <label>
        <div className="c-2">{labels.amountOptional}</div>
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        <div className="c-2">{labels.reason}</div>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <Button type="submit" disabled={busy || !paymentId.trim()}>
        {labels.issueRefund}
      </Button>
    </form>
  )
}
