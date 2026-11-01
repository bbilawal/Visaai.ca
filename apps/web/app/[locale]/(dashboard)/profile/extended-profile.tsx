'use client'

import { useState } from 'react'
import type { LoginHistoryEntry, UserProfile } from '@visaai/types'
import { createClient } from '@/lib/supabase/client'
import { updateProfile } from '@/lib/api/iam-client'
import { useToast } from '@/components/providers/toast-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

type Field = {
  key: keyof Omit<UserProfile, 'user_id' | 'created_at' | 'updated_at' | 'privacy'>
  label: string
  autoComplete?: string
}

const FIELDS: Field[] = [
  { key: 'first_name', label: 'First name', autoComplete: 'given-name' },
  { key: 'last_name', label: 'Last name', autoComplete: 'family-name' },
  { key: 'phone', label: 'Phone', autoComplete: 'tel' },
  { key: 'address_line1', label: 'Address line 1', autoComplete: 'address-line1' },
  { key: 'address_line2', label: 'Address line 2', autoComplete: 'address-line2' },
  { key: 'city', label: 'City', autoComplete: 'address-level2' },
  { key: 'region', label: 'Region / State', autoComplete: 'address-level1' },
  { key: 'postal_code', label: 'Postal code', autoComplete: 'postal-code' },
  { key: 'country', label: 'Country (ISO-2)', autoComplete: 'country' },
  { key: 'timezone', label: 'Time zone (IANA)' },
]

export function ExtendedProfile({
  initialProfile,
  loginHistory,
}: {
  initialProfile: UserProfile | null
  loginHistory: LoginHistoryEntry[]
}) {
  const { toast } = useToast()
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const f of FIELDS) {
      v[f.key] = (initialProfile?.[f.key] as string | null | undefined) ?? ''
    }
    return v
  })
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const {
        data: { session },
      } = await createClient().auth.getSession()
      if (!session) throw new Error('no session')
      const patch: Record<string, string | null> = {}
      for (const f of FIELDS) {
        const val = values[f.key].trim()
        patch[f.key] = val === '' ? null : val
      }
      // timezone is non-null in the schema; default if cleared.
      if (!patch.timezone) patch.timezone = 'UTC'
      await updateProfile(session.access_token, patch)
      toast('Profile saved', 'success')
    } catch {
      toast('Could not save profile', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="p-6">
          <h2 className="text-[13px] font-semibold text-rich-black mb-4">
            Personal details
          </h2>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            {FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <label
                  htmlFor={`pf-${f.key}`}
                  className="text-[12px] font-medium text-rich-black"
                >
                  {f.label}
                </label>
                <Input
                  id={`pf-${f.key}`}
                  value={values[f.key]}
                  autoComplete={f.autoComplete}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                />
              </div>
            ))}
            <div className="col-span-2">
              <Button type="submit" loading={saving}>
                Save details
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h2 className="text-[13px] font-semibold text-rich-black mb-3">
            Recent sign-in activity
          </h2>
          {loginHistory.length === 0 ? (
            <p className="text-[12px] text-midtone-gray">No recent activity.</p>
          ) : (
            <div className="flex flex-col divide-y divide-hairline-2">
              {loginHistory.slice(0, 10).map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-3 py-2 text-[12px]"
                >
                  <span className={e.success ? 'text-emerald' : 'text-rose'}>
                    {e.success ? 'Success' : 'Failed'}
                  </span>
                  <span className="text-midtone-gray">{e.ip ?? '—'}</span>
                  <span className="text-midtone-gray">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
