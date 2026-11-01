import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { CA_ETA_VISAAI_ID, routeHasPortalFill } from '@visaai/types'
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
    .select('destination_country, user_id, visa_types(visaai_id)')
    .eq('id', applicationId)
    .maybeSingle()
  // The eTA is one single-page form with no IRCC account, so the TRV tips
  // (sign-in, Save and continue per page) do not apply to it.
  const vt = (application as { visa_types?: { visaai_id?: string | null } | { visaai_id?: string | null }[] | null } | null)?.visa_types
  const visaaiId = (Array.isArray(vt) ? vt[0] : vt)?.visaai_id ?? null
  const isEta = visaaiId === CA_ETA_VISAAI_ID
  // Express Entry and spousal sponsorship are permanent-residence files the
  // assistant has no mapping for yet: offering Launch there would open a
  // panel with nothing to fill (both used to fill tr-rt's visitor-visa
  // answers instead).
  const routeAssistedFill = routeHasPortalFill(visaaiId)

  return (
    <SubmissionClient
      // A fresh client per application: no launch card, status or error from
      // one application can carry over to the next.
      key={applicationId}
      applicationId={applicationId}
      destinationCountry={application?.destination_country ?? null}
      // Only the owner can launch; the API 403s anyone else. A consultant who
      // opens this page gets a read-only view instead of a Launch that fails.
      canLaunch={Boolean(user && application?.user_id === user.id)}
      ownerId={application?.user_id ?? undefined}
      isEta={isEta}
      routeAssistedFill={routeAssistedFill}
      // Decides the form fee shown ($10 for the eTA, $29 otherwise).
      visaaiId={visaaiId}
    />
  )
}
