'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import {
  listConsultantsForReview,
  setConsultantStatus,
  type ReviewStatus,
  type ReviewableConsultant,
} from '@/lib/api/marketplace-admin-client'

const TABS: ReviewStatus[] = ['pending_review', 'active', 'suspended', 'draft']

/**
 * Approve, suspend, or send back consultant marketplace profiles.
 *
 * Without this the self-onboarding flow dead-ended: a consultant can only reach
 * `pending_review` themselves, and `active` is admin-only, so every submitted
 * profile waited on a manual database edit before it could be found or booked.
 */
export function ConsultantReviewQueue() {
  const t = useTranslations('consultantReview')
  const { toast } = useToast()

  const [tab, setTab] = useState<ReviewStatus>('pending_review')
  // `null` IS the loading state. Deriving it avoids setting state synchronously
  // inside the effect, which cascades renders.
  const [rows, setRows] = useState<ReviewableConsultant[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const loading = rows === null

  // Bumped by an action to force a refetch of the current tab.
  const [reloadKey, setReloadKey] = useState(0)

  // Fetch defined INSIDE the effect (the pattern billing/page.tsx uses): a
  // useCallback referenced here reads as setState-in-effect to the linter.
  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const {
          data: { session },
        } = await getSession()
        if (!session) throw new Error(t('sessionExpired'))
        const data = await listConsultantsForReview(session.access_token, tab)
        if (!cancelled) setRows(data)
      } catch (err) {
        if (cancelled) return
        toast(err instanceof Error ? err.message : t('loadFailed'), 'error')
        setRows([])
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [tab, reloadKey, t, toast])

  async function act(
    id: string,
    status: 'active' | 'suspended' | 'draft',
  ) {
    if (busyId) return
    setBusyId(id)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error(t('sessionExpired'))
      await setConsultantStatus(session.access_token, id, status)
      toast(t('updated'), 'success')
      // Re-read rather than mutating locally: the row usually leaves this tab.
      setRows(null)
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast(err instanceof Error ? err.message : t('updateFailed'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${s === tab ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setRows(null)
              setTab(s)
            }}
            aria-pressed={s === tab}
          >
            {t(`status.${s}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted">{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">{t('none')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{t('colName')}</th>
                <th style={{ textAlign: 'left' }}>{t('colLicense')}</th>
                <th style={{ textAlign: 'left' }}>{t('colExperience')}</th>
                <th style={{ textAlign: 'left' }}>{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.full_name ?? t('unnamed')}</strong>
                    {c.headline && (
                      <div className="text-muted">{c.headline}</div>
                    )}
                  </td>
                  <td>
                    {c.license_number
                      ? `${c.license_number}${c.license_authority ? ` · ${c.license_authority}` : ''}${c.license_country ? ` · ${c.license_country}` : ''}`
                      : t('noLicense')}
                  </td>
                  <td>
                    {c.years_experience != null
                      ? t('years', { years: c.years_experience })
                      : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {c.active_status !== 'active' && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => void act(c.id, 'active')}
                          disabled={busyId === c.id}
                        >
                          {t('approve')}
                        </button>
                      )}
                      {c.active_status === 'pending_review' && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => void act(c.id, 'draft')}
                          disabled={busyId === c.id}
                        >
                          {t('sendBack')}
                        </button>
                      )}
                      {c.active_status === 'active' && (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => void act(c.id, 'suspended')}
                          disabled={busyId === c.id}
                        >
                          {t('suspend')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
