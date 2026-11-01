import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { AcceptInviteClient } from './accept-invite-client'

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const locale = await getLocale()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Must be signed in with the invited email to accept.
  if (!user || user.is_anonymous) redirect({ href: '/login', locale })

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[480px] flex-col justify-center px-6">
      <h1 className="mb-1 text-[24px] font-semibold tracking-[-0.5px] text-deep-black">
        Accept invitation
      </h1>
      <p className="mb-6 text-[13px] text-midtone-gray">
        You must be signed in with the invited email address.
      </p>
      <AcceptInviteClient token={token ?? ''} />
    </div>
  )
}
