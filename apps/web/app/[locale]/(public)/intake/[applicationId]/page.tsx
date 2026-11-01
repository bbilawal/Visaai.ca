import { createClient } from '@/lib/supabase/server'
import IntakeChatClient from './intake-chat-client'

/**
 * Public intake page. No auth redirect — guests (anonymous identities) and
 * permanent users both reach it. The read runs under the caller's session via
 * RLS, so a guest only ever sees their own application; with no session yet it
 * simply resolves to null.
 *
 * The checklist is NOT read here any more. It is built and shown on the
 * documents surface, which is where it is actually used — see
 * IntakeService.rebuildChecklist.
 */
export default async function IntakePage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params
  const supabase = await createClient()

  const { data: application } = await supabase
    .from('applications')
    .select('visa_type_id')
    .eq('id', applicationId)
    .maybeSingle()

  return (
    <IntakeChatClient
      applicationId={applicationId}
      visaTypeId={application?.visa_type_id ?? null}
    />
  )
}
