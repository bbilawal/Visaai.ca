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

  // The form fee depends on the visa type (the eTA is cheaper), so the page
  // needs it to show the price the API will actually charge.
  const { data: application } = await supabase
    .from('applications')
    .select('visa_types(visaai_id)')
    .eq('id', applicationId)
    .maybeSingle()
  const vt = (application as { visa_types?: { visaai_id?: string | null } | { visaai_id?: string | null }[] | null } | null)?.visa_types
  const visaaiId = (Array.isArray(vt) ? vt[0] : vt)?.visaai_id ?? null

  return <PrefillClient applicationId={applicationId} visaaiId={visaaiId} />
}
