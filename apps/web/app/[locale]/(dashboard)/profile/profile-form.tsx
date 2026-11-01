'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient, resetPasswordForEmail } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

interface ProfileFormProps {
  userId: string
  email: string
  role: string
  initialFullName: string
  initialNationality: string
}

export function ProfileForm({ userId, email, role, initialFullName, initialNationality }: ProfileFormProps) {
  const t = useTranslations('profile')
  const { toast } = useToast()
  const [fullName, setFullName] = useState(initialFullName)
  const [nationality, setNationality] = useState(initialNationality)
  const [saving, setSaving] = useState(false)
  const [pwPending, setPwPending] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    // Write only the user-editable fields. `email` is authoritative in
    // auth.users (synced by the signup trigger) — never let the client
    // overwrite users.email, even though RLS would permit the own-row write.
    const { error } = await createClient()
      .from('users')
      .update({ full_name: fullName, nationality })
      .eq('id', userId)
    setSaving(false)
    if (error) {
      toast(t('errSave'), 'error')
      return
    }
    toast(t('savedToast'), 'success')
  }

  async function handleChangePassword() {
    setPwPending(true)
    const { error } = await resetPasswordForEmail(email)
    setPwPending(false)
    toast(
      error ? t('errResetSend') : t('resetSent'),
      error ? 'error' : 'success',
    )
  }

  return (
    <Card>
      <CardContent className="p-0">
        {/* Account details section */}
        <div className="px-6 py-6">
          <h2 className="text-[13px] font-semibold text-rich-black mb-4">{t('accountDetails')}</h2>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="profile-name" className="text-[12px] font-medium text-rich-black">{t('fullName')}</label>
              <Input
                id="profile-name"
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                autoComplete="name"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="profile-nationality" className="text-[12px] font-medium text-rich-black">{t('nationality')}</label>
              <Input
                id="profile-nationality"
                type="text"
                placeholder={t('nationalityPlaceholder')}
                value={nationality}
                onChange={e => setNationality(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="profile-email" className="text-[12px] font-medium text-rich-black">{t('email')}</label>
              <Input id="profile-email" type="email" value={email} disabled readOnly />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="profile-role" className="text-[12px] font-medium text-rich-black">{t('role')}</label>
              <Input id="profile-role" type="text" value={role} disabled readOnly />
            </div>
            <div className="pt-2">
              <Button type="submit" loading={saving} className="w-fit">
                {saving ? t('saving') : t('saveChanges')}
              </Button>
            </div>
          </form>
        </div>

        {/* Divider */}
        <div className="border-t border-hairline-2" />

        {/* Password section */}
        <div className="px-6 py-6">
          <h2 className="text-[13px] font-semibold text-rich-black mb-1">{t('password')}</h2>
          <p className="text-[12px] text-midtone-gray mb-4">
            {t('passwordHint')}
          </p>
          <Button type="button" variant="outline" size="sm" loading={pwPending} onClick={handleChangePassword}>
            {pwPending ? t('sending') : t('changePassword')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
