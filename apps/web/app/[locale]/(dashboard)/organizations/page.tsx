import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { listMyOrgs } from '@/lib/api/iam'
import type { Organization } from '@visaai/types'
import { OrganizationsClient } from './organizations-client'

export default async function OrganizationsPage() {
  const locale = await getLocale()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect({ href: '/login', locale })

  let orgs: Organization[] = []
  try {
    orgs = await listMyOrgs()
  } catch {
    orgs = []
  }

  return (
    <div className="max-w-[760px]">
      <h1 className="text-[28px] font-semibold tracking-[-0.5px] text-deep-black mb-1">
        Organizations
      </h1>
      <p className="text-[13px] text-midtone-gray mb-6">
        Create an organization to invite consultants and teammates, and manage
        their roles.
      </p>
      <OrganizationsClient initialOrgs={orgs} />
    </div>
  )
}
