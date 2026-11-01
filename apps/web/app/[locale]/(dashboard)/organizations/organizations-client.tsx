'use client'

import { useState } from 'react'
import { Link, useRouter } from '@/i18n/navigation'
import type { Organization } from '@visaai/types'
import { createClient } from '@/lib/supabase/client'
import { createOrg } from '@/lib/api/iam-client'
import { useToast } from '@/components/providers/toast-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

async function sessionToken(): Promise<string | null> {
  const {
    data: { session },
  } = await createClient().auth.getSession()
  return session?.access_token ?? null
}

export function OrganizationsClient({
  initialOrgs,
}: {
  initialOrgs: Organization[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [orgs] = useState<Organization[]>(initialOrgs)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      const token = await sessionToken()
      if (!token) throw new Error('no session')
      const org = await createOrg(token, name.trim())
      toast('Organization created', 'success')
      router.push(`/organizations/${org.id}`)
    } catch {
      toast('Could not create organization', 'error')
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="p-6">
          <h2 className="text-[13px] font-semibold text-rich-black mb-3">
            Create an organization
          </h2>
          <form onSubmit={handleCreate} className="flex items-end gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <label
                htmlFor="org-name"
                className="text-[12px] font-medium text-rich-black"
              >
                Name
              </label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Immigration"
                maxLength={120}
              />
            </div>
            <Button type="submit" loading={creating} disabled={!name.trim()}>
              Create
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold text-rich-black">
          Your organizations
        </h2>
        {orgs.length === 0 ? (
          <EmptyState
            title="No organizations yet"
            description="Create one above to start inviting your team."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {orgs.map((org) => (
              <Link
                key={org.id}
                href={`/organizations/${org.id}`}
                className="flex items-center justify-between rounded-md border border-hairline-2 bg-paper-canvas px-4 py-3 transition-colors hover:bg-atmosphere-wash/40"
              >
                <span className="text-[14px] font-medium text-rich-black">
                  {org.name}
                </span>
                <span className="text-[12px] text-midtone-gray">
                  {org.plan}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
