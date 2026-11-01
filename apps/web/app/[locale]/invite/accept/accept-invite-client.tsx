'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'
import { acceptInvitation } from '@/lib/api/iam-client'
import { useToast } from '@/components/providers/toast-provider'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'

export function AcceptInviteClient({ token }: { token: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) {
    return <Alert variant="error">This invitation link is missing its token.</Alert>
  }

  async function handleAccept() {
    setPending(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await createClient().auth.getSession()
      if (!session) throw new Error('no session')
      const { organization_id } = await acceptInvitation(
        session.access_token,
        token,
      )
      toast('Invitation accepted', 'success')
      router.push(`/organizations/${organization_id}`)
    } catch {
      setError(
        'Could not accept this invitation. It may be expired, already used, or issued to a different email.',
      )
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert variant="error">{error}</Alert>}
      <Button onClick={handleAccept} loading={pending} block>
        Accept invitation
      </Button>
    </div>
  )
}
