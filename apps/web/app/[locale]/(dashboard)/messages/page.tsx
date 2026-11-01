import { GlobalMessageSearch } from '@/components/messaging/global-message-search'

/**
 * Messages home: global / cross-conversation search. Auth is enforced by the
 * (dashboard) layout. Results deep-link into /messages/[applicationId].
 */
export default function MessagesHomePage() {
  return (
    <div className="mx-auto max-w-3xl py-6">
      <h1 className="mb-4 text-xl font-medium">Messages</h1>
      <GlobalMessageSearch />
    </div>
  )
}
