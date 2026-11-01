'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

/**
 * Admin comp for the one-time form fee: unlocks portal auto-fill without a
 * charge. The server records it as a $0 'waiver' payment plus an audit row
 * (reason required); repeating it is a no-op.
 */
export function PrefillWaiverControl({ applicationId }: { applicationId: string }) {
  const t = useTranslations('admin')
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function waive() {
    setBusy(true)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('Not authenticated')
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
      const res = await fetch(`${apiUrl}/admin/applications/${applicationId}/prefill-waiver`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const out = (await res.json()) as { alreadyUnlocked: boolean }
      setDone(true)
      toast(out.alreadyUnlocked ? t('waiverAlready') : t('waiverDone'), 'success')
    } catch (err) {
      toast(t('waiverFailed', { detail: err instanceof Error ? err.message : '' }), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant="tight" className="mb-6">
      <h3 className="type-h4">{t('waiverHeading')}</h3>
      <p className="mono" style={{ fontSize: '0.8rem', margin: '6px 0 10px' }}>{t('waiverDesc')}</p>
      <Input
        aria-label={t('waiverReason')}
        placeholder={t('waiverReason')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={busy || done}
      />
      <Button
        className="mt-3"
        size="sm"
        onClick={() => void waive()}
        disabled={busy || done || reason.trim().length < 3}
      >
        {done ? t('waiverDoneShort') : t('waiverButton')}
      </Button>
    </Card>
  )
}
