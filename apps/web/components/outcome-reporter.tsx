'use client'

import { useEffect, useState } from 'react'
import { getSession } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/providers/toast-provider'

type Outcome = 'approved' | 'refused' | 'withdrawn' | 'pending'

const REFUSAL_REASONS: { code: string; label: string }[] = [
  { code: 'insufficient_funds', label: 'Insufficient funds' },
  { code: 'weak_home_ties', label: 'Weak home-country ties' },
  { code: 'travel_history', label: 'Travel history' },
  { code: 'purpose_unclear', label: 'Purpose of visit unclear' },
  { code: 'inconsistent_info', label: 'Inconsistent information' },
  { code: 'incomplete_docs', label: 'Incomplete documents' },
  { code: 'other', label: 'Other' },
]

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

/**
 * Self-reported decision capture (Strategy Action 15). This is the data that,
 * over time, calibrates the heuristic VRI score into an outcome-aware model.
 * Optional and private.
 */
export function OutcomeReporter({ applicationId }: { applicationId: string }) {
  const { toast } = useToast()
  const [existing, setExisting] = useState<{ outcome: Outcome } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: { session } } = await getSession()
      if (!session) return
      try {
        const res = await fetch(`${apiUrl}/outcomes/${applicationId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok && !cancelled) {
          const data = await res.json()
          if (data?.outcome) setExisting({ outcome: data.outcome })
        }
      } catch {
        // best-effort; component stays interactive
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [applicationId])

  async function submit() {
    if (!outcome) return
    setSaving(true)
    try {
      const { data: { session } } = await getSession()
      if (!session) return
      const res = await fetch(`${apiUrl}/outcomes/${applicationId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          outcome,
          refusalReasons: outcome === 'refused' ? reasons : undefined,
        }),
      })
      if (!res.ok) throw new Error('Could not save')
      setExisting({ outcome })
      toast('Thanks. Your decision helps improve readiness scoring.', 'success')
    } catch {
      toast('Could not save your decision. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  function toggleReason(code: string) {
    setReasons((prev) => (prev.includes(code) ? prev.filter((r) => r !== code) : [...prev, code]))
  }

  if (!loaded) return null

  if (existing) {
    return (
      <Card variant="tight" className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="type-h3">Decision recorded</p>
          <Badge variant={existing.outcome === 'approved' ? 'emerald' : existing.outcome === 'refused' ? 'rose' : 'neutral'}>
            {existing.outcome}
          </Badge>
        </div>
        <p className="sans" style={{ fontSize: '0.85rem', marginTop: 6, color: 'var(--color-midtone-gray)' }}>
          Thank you. This stays private and helps improve readiness scoring for everyone.
        </p>
      </Card>
    )
  }

  return (
    <Card variant="tight" className="mt-6">
      <p className="type-h3">Heard back on this application?</p>
      <p className="sans" style={{ fontSize: '0.85rem', marginTop: 4, color: 'var(--color-midtone-gray)' }}>
        Optional and private. Sharing your decision helps make readiness scoring more accurate.
      </p>
      <div className="flex flex-wrap gap-2 mt-3">
        {(['approved', 'refused', 'withdrawn'] as Outcome[]).map((o) => (
          <Button
            key={o}
            size="sm"
            variant={outcome === o ? 'primary' : 'outline'}
            onClick={() => setOutcome(o)}
          >
            {o.charAt(0).toUpperCase() + o.slice(1)}
          </Button>
        ))}
      </div>

      {outcome === 'refused' && (
        <div className="mt-4">
          <p className="field-label">If shared, what reasons were given? (optional)</p>
          <div className="flex flex-col gap-2 mt-1">
            {REFUSAL_REASONS.map((r) => (
              <label key={r.code} className="flex items-center gap-2 text-[13px] text-rich-black">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={reasons.includes(r.code)}
                  onChange={() => toggleReason(r.code)}
                />
                {r.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {outcome && (
        <div className="mt-4">
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Save decision'}
          </Button>
        </div>
      )}
    </Card>
  )
}
