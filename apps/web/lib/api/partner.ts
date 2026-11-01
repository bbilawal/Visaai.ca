import type { PartnerApplication } from '@visaai/types'
import { serverApi } from './server'
import type { PartnerRegistration, ScopeDefinitionView } from './partner-client'

/**
 * Server-side partner reads (pages only — pulls next/headers via serverApi).
 * Client components use ./partner-client.
 *
 * The initial page load happens here rather than in a client effect: the data
 * is needed to render, and fetching-on-mount means a flash of empty state plus
 * a lint rule telling you not to setState in an effect.
 */
export const getPartnerForOrg = (organizationId: string) =>
  serverApi<PartnerRegistration | null>(
    `/partner-portal?organizationId=${organizationId}`,
  )

export const getPartnerScopes = () =>
  serverApi<{ data: ScopeDefinitionView[] }>('/partner-portal/scopes')

export const getPartnerApplications = (organizationId: string) =>
  serverApi<PartnerApplication[]>(
    `/partner-portal/applications?organizationId=${organizationId}`,
  )
