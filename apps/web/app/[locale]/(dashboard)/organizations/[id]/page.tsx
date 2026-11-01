import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getOrg,
  listOrgInvitations,
  listOrgMembers,
} from '@/lib/api/iam'
import type {
  Organization,
  OrganizationInvitation,
  OrganizationMember,
} from '@visaai/types'
import { OrgDetailClient } from './org-detail-client'

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const locale = await getLocale()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect({ href: '/login', locale })

  let org: Organization
  try {
    org = await getOrg(id)
  } catch {
    notFound()
  }

  let members: OrganizationMember[] = []
  try {
    members = await listOrgMembers(id)
  } catch {
    members = []
  }

  // Invitations are org_admin-only; a plain member gets 403 → hide the section.
  let invitations: OrganizationInvitation[] | null = null
  try {
    invitations = await listOrgInvitations(id)
  } catch {
    invitations = null
  }

  // AUTH-002: `role`, not `app_role`. With the wrong key this was always
  // 'user', so a platform admin could only manage an org by also being an
  // active org_admin member. Failed closed, but silently withheld the
  // capability admins are supposed to have.
  const appRole =
    (user.app_metadata?.role as string | undefined) ?? 'user'
  const canManage =
    appRole === 'admin' ||
    members.some(
      (m) =>
        m.user_id === user.id &&
        m.role === 'org_admin' &&
        m.status === 'active',
    )

  return (
    <OrgDetailClient
      org={org}
      members={members}
      invitations={invitations}
      currentUserId={user.id}
      canManage={canManage}
    />
  )
}
