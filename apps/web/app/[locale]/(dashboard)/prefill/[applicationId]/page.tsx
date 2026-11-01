import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import PrefillClient from './prefill-client'

export default async function PrefillPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params
  const locale = await getLocale()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect({ href: '/login', locale })

  return <PrefillClient applicationId={applicationId} />
}
