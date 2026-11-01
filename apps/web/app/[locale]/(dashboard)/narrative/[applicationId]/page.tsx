import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { offeredGenTypesForRoute } from '@visaai/types'
import NarrativeClient from './narrative-client'

export default async function NarrativePage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params
  const locale = await getLocale()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect({ href: '/login', locale })

  // Which letters this route uses — none for Canada's eTA (dry run
  // 2026-10-16: an eTA was offered an LOE that said "visitor visa"). RLS scopes
  // the read; a missing row keeps the default set, and the API refuses a
  // letter the route does not use either way.
  const { data: app } = await supabase
    .from('applications')
    .select('destination_country, visa_types(visaai_id)')
    .eq('id', applicationId)
    .maybeSingle()
  const row = app as {
    destination_country?: string | null
    visa_types?: { visaai_id?: string | null } | { visaai_id?: string | null }[] | null
  } | null
  const vt = Array.isArray(row?.visa_types) ? row?.visa_types[0] : row?.visa_types
  const offered = offeredGenTypesForRoute({
    country: row?.destination_country ?? null,
    visaaiId: vt?.visaai_id ?? null,
  })

  return <NarrativeClient applicationId={applicationId} offeredTypes={offered} />
}
