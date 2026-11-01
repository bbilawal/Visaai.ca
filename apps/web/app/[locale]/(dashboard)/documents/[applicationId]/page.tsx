import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { plannedStay } from '@visaai/types'
import DocumentsClient from './documents-client'

export default async function DocumentsPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params
  const locale = await getLocale()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect({ href: '/login', locale })

  // A failed read must not render as "no documents required". In an immigration
  // product an empty checklist is a statement — the applicant reads it as
  // "nothing left to upload" — so an outage that looks like one is worse than
  // an error page.
  const { data: checklist, error: checklistError } = await supabase
    .from('checklist_items')
    .select('*')
    .eq('application_id', applicationId)
    .order('added_reason')
  if (checklistError) {
    throw new Error(
      `Could not load your document checklist: ${checklistError.message}`,
    )
  }

  const { data: application } = await supabase
    .from('applications')
    .select('destination_country')
    .eq('id', applicationId)
    .maybeSingle()

  // Checklist notes quote the stay length from intake time; the current dates
  // win (see lib/stay-mentions.ts).
  const { data: profile } = await supabase
    .from('application_profiles')
    .select('profile_json')
    .eq('application_id', applicationId)
    .maybeSingle()
  const stayDays = plannedStay(
    (profile?.profile_json as Record<string, unknown> | null) ?? null,
  ).days

  return (
    <DocumentsClient
      applicationId={applicationId}
      initialChecklist={checklist ?? []}
      country={application?.destination_country ?? null}
      stayDays={stayDays}
    />
  )
}
