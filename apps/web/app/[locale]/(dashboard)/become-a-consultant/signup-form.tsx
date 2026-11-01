'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import {
  createConsultantProfile,
  getMyConsultantProfile,
  updateConsultantProfile,
  upsertConsultantAvailability,
  upsertConsultantSkills,
  type ProfileBundle,
  type ProfileFields,
} from '@/lib/api/consultant-signup-client'

/** Comma-separated input -> trimmed, de-duplicated, non-empty list. */
function toList(s: string): string[] {
  return [...new Set(s.split(',').map((v) => v.trim()).filter(Boolean))]
}

/**
 * Create or edit the caller's own marketplace profile.
 *
 * Loads client-side rather than server-side because the API 404s when no
 * profile exists, and "you haven't started yet" is the common first state — not
 * an error worth failing the page render over.
 */
export function ConsultantSignupForm() {
  const t = useTranslations('consultantSignup')
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [existing, setExisting] = useState<ProfileBundle | null>(null)

  const [headline, setHeadline] = useState('')
  const [bio, setBio] = useState('')
  const [specialization, setSpecialization] = useState('')
  const [yearsExperience, setYearsExperience] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [licenseAuthority, setLicenseAuthority] = useState('')
  const [licenseCountry, setLicenseCountry] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [visaTypes, setVisaTypes] = useState('')
  const [languages, setLanguages] = useState('')
  const [acceptingNew, setAcceptingNew] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const {
          data: { session },
        } = await getSession()
        if (!session) throw new Error(t('sessionExpired'))
        const bundle = await getMyConsultantProfile(session.access_token)
        if (cancelled) return
        setExisting(bundle)
        const p = bundle.profile
        setHeadline(p.headline ?? '')
        setBio(p.bio ?? '')
        setSpecialization((p.specialization ?? []).join(', '))
        setYearsExperience(p.years_experience?.toString() ?? '')
        setLicenseNumber(p.license_number ?? '')
        setLicenseAuthority(p.license_authority ?? '')
        setLicenseCountry(p.license_country ?? '')
        setHourlyRate(p.hourly_rate_usd?.toString() ?? '')
        setVisaTypes((bundle.skills?.visa_types ?? []).join(', '))
        setLanguages((bundle.skills?.languages ?? []).join(', '))
        setAcceptingNew(bundle.availability?.accepting_new ?? true)
      } catch {
        // 404 = no profile yet, which is the expected starting state.
        if (!cancelled) setExisting(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [t])

  async function save(submit: boolean) {
    if (saving) return
    setSaving(true)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error(t('sessionExpired'))
      const token = session.access_token

      const fields: ProfileFields = {
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        specialization: toList(specialization),
        years_experience: yearsExperience ? Number(yearsExperience) : null,
        license_number: licenseNumber.trim() || null,
        license_authority: licenseAuthority.trim() || null,
        // The API requires exactly 2 chars or null — never an empty string.
        license_country: licenseCountry.trim()
          ? licenseCountry.trim().toUpperCase().slice(0, 2)
          : null,
        hourly_rate_usd: hourlyRate ? Number(hourlyRate) : null,
        active_status: submit ? 'pending_review' : 'draft',
      }

      if (existing) await updateConsultantProfile(token, fields)
      else await createConsultantProfile(token, fields)

      // Skills reject a body with neither key present, so only send when set.
      const vt = toList(visaTypes)
      const langs = toList(languages)
      if (vt.length || langs.length) {
        await upsertConsultantSkills(token, {
          ...(vt.length ? { visa_types: vt } : {}),
          ...(langs.length ? { languages: langs } : {}),
        })
      }
      await upsertConsultantAvailability(token, { accepting_new: acceptingNew })

      toast(submit ? t('submitted') : t('savedDraft'), 'success')
      // Re-read so the status badge reflects what the server actually stored.
      const bundle = await getMyConsultantProfile(token)
      setExisting(bundle)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('saveFailed')
      toast(msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-muted">{t('loading')}</p>

  const status = existing?.profile.active_status
  const field = { display: 'grid', gap: 6 } as const

  return (
    <div style={{ display: 'grid', gap: 24, maxWidth: 640 }}>
      {status && (
        <div
          className={`alert ${status === 'active' ? 'alert-success' : 'alert-info'}`}
        >
          {status === 'active'
            ? t('statusActive')
            : status === 'pending_review'
              ? t('statusPending')
              : t('statusDraft')}
        </div>
      )}

      <label style={field}>
        <span>{t('headline')}</span>
        <input
          className="input"
          value={headline}
          maxLength={200}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder={t('headlinePlaceholder')}
        />
      </label>

      <label style={field}>
        <span>{t('bio')}</span>
        <textarea
          className="input"
          rows={5}
          value={bio}
          maxLength={5000}
          onChange={(e) => setBio(e.target.value)}
        />
      </label>

      <label style={field}>
        <span>{t('specialization')}</span>
        <input
          className="input"
          value={specialization}
          onChange={(e) => setSpecialization(e.target.value)}
          placeholder={t('commaSeparated')}
        />
      </label>

      <label style={field}>
        <span>{t('visaTypes')}</span>
        <input
          className="input"
          value={visaTypes}
          onChange={(e) => setVisaTypes(e.target.value)}
          placeholder={t('commaSeparated')}
        />
      </label>

      <label style={field}>
        <span>{t('languages')}</span>
        <input
          className="input"
          value={languages}
          onChange={(e) => setLanguages(e.target.value)}
          placeholder={t('commaSeparated')}
        />
      </label>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <label style={field}>
          <span>{t('yearsExperience')}</span>
          <input
            className="input"
            type="number"
            min={0}
            max={80}
            value={yearsExperience}
            onChange={(e) => setYearsExperience(e.target.value)}
          />
        </label>

        <label style={field}>
          <span>{t('hourlyRate')}</span>
          <input
            className="input"
            type="number"
            min={0}
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
          />
        </label>

        <label style={field}>
          <span>{t('licenseCountry')}</span>
          <input
            className="input"
            value={licenseCountry}
            maxLength={2}
            onChange={(e) => setLicenseCountry(e.target.value)}
            placeholder="CA"
          />
        </label>
      </div>

      <label style={field}>
        <span>{t('licenseNumber')}</span>
        <input
          className="input"
          value={licenseNumber}
          maxLength={120}
          onChange={(e) => setLicenseNumber(e.target.value)}
        />
      </label>

      <label style={field}>
        <span>{t('licenseAuthority')}</span>
        <input
          className="input"
          value={licenseAuthority}
          maxLength={120}
          onChange={(e) => setLicenseAuthority(e.target.value)}
          placeholder={t('licenseAuthorityPlaceholder')}
        />
      </label>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={acceptingNew}
          onChange={(e) => setAcceptingNew(e.target.checked)}
        />
        <span>{t('acceptingNew')}</span>
      </label>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          className="btn btn-secondary"
          onClick={() => void save(false)}
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? t('saving') : t('saveDraft')}
        </button>
        <button
          className="btn btn-primary"
          onClick={() => void save(true)}
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? t('saving') : t('submitForReview')}
        </button>
      </div>

      <p className="text-muted">{t('reviewNote')}</p>
    </div>
  )
}
