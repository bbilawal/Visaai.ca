import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { listMyOrgs } from '@/lib/api/iam'
import {
  getPartnerApplications,
  getPartnerForOrg,
  getPartnerScopes,
} from '@/lib/api/partner'
import type { Organization, PartnerApplication } from '@visaai/types'
import type {
  PartnerRegistration,
  ScopeDefinitionView,
} from '@/lib/api/partner-client'
import { DevelopersClient } from './developers-client'

/**
 * Partner Portal.
 *
 * The server component resolves the caller's organizations and the first
 * organization's partner state, so the page renders complete rather than
 * flashing an empty shell. Everything after that — switching organizations,
 * registering, minting keys — is a user action handled client-side.
 */
export default async function DevelopersPage() {
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

  // First organization's partner state is fetched here so the page renders
  // complete. Switching organizations refetches client-side, which is a user
  // action rather than a mount effect.
  const first = orgs[0]?.id
  let partner: PartnerRegistration | null = null
  let scopes: ScopeDefinitionView[] = []
  let applications: PartnerApplication[] = []
  if (first) {
    try {
      const [registration, catalog] = await Promise.all([
        getPartnerForOrg(first),
        getPartnerScopes(),
      ])
      partner = registration
      scopes = catalog.data
      applications = registration ? await getPartnerApplications(first) : []
    } catch {
      // A partner-less or permission-less org renders the registration form.
    }
  }

  return (
    <div className="max-w-[860px]">
      <h1 className="text-[28px] font-semibold tracking-[-0.5px] text-deep-black mb-1">
        Developers
      </h1>
      <p className="text-[13px] text-midtone-gray mb-6">
        Register your organization as a VisaAI partner, manage API credentials
        and webhooks, and see which users have authorized your applications.
      </p>
      <DevelopersClient
        organizations={orgs}
        initialPartner={partner}
        initialScopes={scopes}
        initialApplications={applications}
      />
    </div>
  )
}
