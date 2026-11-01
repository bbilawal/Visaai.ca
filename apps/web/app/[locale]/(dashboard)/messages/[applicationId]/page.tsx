import { createClient } from '@/lib/supabase/server'
import { ConversationThread } from '@/components/messaging/conversation-thread'

interface Props {
  params: Promise<{ applicationId: string }>
  searchParams: Promise<{ focus?: string }>
}

/**
 * User-facing messages page. Server component: authenticates the user via the
 * server Supabase client and renders the <ConversationThread> client component
 * which manages the REST + SSE interaction with the NestJS API.
 * An optional ?focus=<messageId> (from global search) scrolls to that message.
 *
 * Route: /{locale}/messages/{applicationId}
 * Auth-gated by the (dashboard) layout (redirects to /login if not authenticated).
 */
export default async function MessagesPage({ params, searchParams }: Props) {
  const { applicationId } = await params
  const { focus } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="mx-auto max-w-3xl py-6">
      <ConversationThread
        applicationId={applicationId}
        currentUserId={user?.id ?? ''}
        focusMessageId={focus}
      />
    </div>
  )
}
