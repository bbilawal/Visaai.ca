'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import type {
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  OrgMemberRole,
} from '@visaai/types'
import { createClient } from '@/lib/supabase/client'
import {
  inviteMember,
  removeMember,
  revokeInvitation,
  updateMember,
  updateOrg,
} from '@/lib/api/iam-client'
import { useToast } from '@/components/providers/toast-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

const MEMBER_ROLES: OrgMemberRole[] = ['org_admin', 'member', 'consultant']

async function sessionToken(): Promise<string> {
  const {
    data: { session },
  } = await createClient().auth.getSession()
  if (!session) throw new Error('no session')
  return session.access_token
}

export function OrgDetailClient({
  org,
  members,
  invitations,
  currentUserId,
  canManage,
}: {
  org: Organization
  members: OrganizationMember[]
  invitations: OrganizationInvitation[] | null
  currentUserId: string
  canManage: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [name, setName] = useState(org.name)
  const [savingName, setSavingName] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrgMemberRole>('member')
  const [inviting, setInviting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function withToken<T>(
    fn: (t: string) => Promise<T>,
    okMsg: string,
  ): Promise<boolean> {
    try {
      const token = await sessionToken()
      await fn(token)
      toast(okMsg, 'success')
      router.refresh()
      return true
    } catch {
      toast('Action failed', 'error')
      return false
    }
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || name.trim() === org.name) return
    setSavingName(true)
    await withToken(
      (t) => updateOrg(t, org.id, { name: name.trim() }),
      'Organization updated',
    )
    setSavingName(false)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true)
    const ok = await withToken(
      (t) => inviteMember(t, org.id, inviteEmail.trim(), inviteRole),
      'Invitation sent',
    )
    if (ok) setInviteEmail('')
    setInviting(false)
  }

  return (
    <div className="max-w-[820px]">
      <h1 className="text-[28px] font-semibold tracking-[-0.5px] text-deep-black mb-1">
        {org.name}
      </h1>
      <p className="text-[13px] text-midtone-gray mb-6">
        Slug: <code>{org.slug}</code> · Plan: {org.plan}
      </p>

      {/* Settings */}
      {canManage && (
        <Card className="mb-6">
          <CardContent className="p-6">
            <h2 className="text-[13px] font-semibold text-rich-black mb-3">
              Settings
            </h2>
            <form onSubmit={handleSaveName} className="flex items-end gap-3">
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
                  maxLength={120}
                />
              </div>
              <Button
                type="submit"
                loading={savingName}
                disabled={!name.trim() || name.trim() === org.name}
              >
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Members */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <h2 className="text-[13px] font-semibold text-rich-black mb-4">
            Team members ({members.length})
          </h2>
          <div className="flex flex-col divide-y divide-hairline-2">
            {members.map((m) => {
              const isOwner = m.user_id === org.owner_user_id
              const rowBusy = busy === m.user_id
              return (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <span className="flex-1 truncate text-[13px] text-rich-black">
                    {m.user_id === currentUserId ? 'You' : m.user_id}
                    {isOwner && (
                      <span className="ms-2 text-[11px] text-midtone-gray">
                        (owner)
                      </span>
                    )}
                  </span>
                  {canManage && !isOwner ? (
                    <>
                      <select
                        aria-label="Member role"
                        className="rounded-md border border-hairline-2 bg-paper-canvas px-2 py-1 text-[12px]"
                        value={m.role}
                        disabled={rowBusy}
                        onChange={async (e) => {
                          setBusy(m.user_id)
                          await withToken(
                            (t) =>
                              updateMember(t, org.id, m.user_id, {
                                role: e.target.value as OrgMemberRole,
                              }),
                            'Role updated',
                          )
                          setBusy(null)
                        }}
                      >
                        {MEMBER_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={rowBusy}
                        className="text-[12px] text-rose hover:underline disabled:opacity-50"
                        onClick={async () => {
                          setBusy(m.user_id)
                          await withToken(
                            (t) => removeMember(t, org.id, m.user_id),
                            'Member removed',
                          )
                          setBusy(null)
                        }}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="text-[12px] text-midtone-gray">
                      {m.role} · {m.status}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Invitations (org_admin only) */}
      {canManage && invitations !== null && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-[13px] font-semibold text-rich-black mb-4">
              Invitations
            </h2>
            <form
              onSubmit={handleInvite}
              className="mb-4 flex flex-wrap items-end gap-3"
            >
              <div className="flex flex-1 flex-col gap-1.5">
                <label
                  htmlFor="invite-email"
                  className="text-[12px] font-medium text-rich-black"
                >
                  Email
                </label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                />
              </div>
              <select
                aria-label="Invite role"
                className="rounded-md border border-hairline-2 bg-paper-canvas px-2 py-2 text-[12px]"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as OrgMemberRole)}
              >
                {MEMBER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <Button type="submit" loading={inviting} disabled={!inviteEmail.trim()}>
                Invite
              </Button>
            </form>

            {invitations.filter((i) => i.status === 'pending').length === 0 ? (
              <p className="text-[12px] text-midtone-gray">
                No pending invitations.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-hairline-2">
                {invitations
                  .filter((i) => i.status === 'pending')
                  .map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center gap-3 py-2.5"
                    >
                      <span className="flex-1 truncate text-[13px] text-rich-black">
                        {inv.email}
                      </span>
                      <span className="text-[12px] text-midtone-gray">
                        {inv.role}
                      </span>
                      <button
                        type="button"
                        className="text-[12px] text-rose hover:underline"
                        onClick={() =>
                          withToken(
                            (t) => revokeInvitation(t, org.id, inv.id),
                            'Invitation revoked',
                          )
                        }
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
