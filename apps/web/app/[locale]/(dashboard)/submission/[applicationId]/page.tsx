import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import SubmissionClient from './submission-client'

export default async function SubmissionPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params
  const locale = await getLocale()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect({ href: '/login', locale })

  // The extension can only fill a portal it has a mapping for. Read the
  // destination here so the client can ask the API whether THIS one is
  // supported, rather than offering an install to everyone.
  const { data: application } = await supabase
    .from('applications')
    .select('destination_country, user_id')
    .eq('id', applicationId)
    .maybeSingle()

  return (
    <SubmissionClient
      applicationId={applicationId}
      destinationCountry={application?.destination_country ?? null}
      // Only the owner can launch; the API 403s anyone else. A consultant who
      // opens this page gets a read-only view instead of a Launch that fails.
      canLaunch={Boolean(user && application?.user_id === user.id)}
    />
  )
}
