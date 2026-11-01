import type {
  PartnerApiKeyIssued,
  PartnerApiKeySummary,
  PartnerApiProduct,
  PartnerApplication,
  PartnerEnvironment,
} from '@visaai/types'
import { apiFetch } from './client'

/**
 * Partner Portal API client.
 *
 * Targets `/partner-portal`, the surface a signed-in org member calls with
 * their normal session — NOT `/v1`, which partners call with partner
 * credentials. Keeping them apart is what stops a partner credential from
 * managing its own scopes.
 *
 * The backend re-checks everything (JwtGuard + PermissionsGuard + an
 * org-membership check inside the service). This file is convenience, not a
 * security boundary.
 */

export interface PartnerRegistration {
  id: string
  organization_id: string
  legal_name: string
  contact_email: string
  website: string | null
  status: 'pending' | 'approved' | 'suspended' | 'rejected'
  tier: 'standard' | 'scale' | 'enterprise'
  status_reason: string | null
  created_at: string
}

export interface ScopeDefinitionView {
  scope: string
  description: string
  requiresUserConsent: boolean
  selfServiceSandbox: boolean
  requiresApprovalForLive: boolean
  dataClassification: 'public' | 'internal' | 'personal' | 'sensitive_personal'
}

export const getPartner = (token: string, organizationId: string) =>
  apiFetch<PartnerRegistration | null>(
    `/partner-portal?organizationId=${organizationId}`,
    token,
  )

export const registerPartner = (
  token: string,
  input: {
    organizationId: string
    legalName: string
    contactEmail: string
    website?: string
  },
) =>
  apiFetch<PartnerRegistration>('/partner-portal', token, {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const listScopes = (token: string) =>
  apiFetch<{ data: ScopeDefinitionView[] }>('/partner-portal/scopes', token)

export const listCatalog = (token: string) =>
  apiFetch<{ data: PartnerApiProduct[] }>('/partner-portal/catalog', token)

export const listPartnerApplications = (token: string, organizationId: string) =>
  apiFetch<PartnerApplication[]>(
    `/partner-portal/applications?organizationId=${organizationId}`,
    token,
  )

export const createPartnerApplication = (
  token: string,
  input: {
    organizationId: string
    name: string
    description?: string
    environment: PartnerEnvironment
    scopes: string[]
    grantTypes?: ('client_credentials' | 'authorization_code')[]
    redirectUris?: string[]
    ipAllowlist?: string[]
  },
) =>
  apiFetch<{ application: PartnerApplication; client_secret: string }>(
    '/partner-portal/applications',
    token,
    { method: 'POST', body: JSON.stringify(input) },
  )

export const listKeys = (
  token: string,
  organizationId: string,
  applicationId: string,
) =>
  apiFetch<PartnerApiKeySummary[]>(
    `/partner-portal/applications/${applicationId}/keys?organizationId=${organizationId}`,
    token,
  )

export const createKey = (
  token: string,
  applicationId: string,
  input: { organizationId: string; name: string; scopes?: string[] },
) =>
  apiFetch<PartnerApiKeyIssued>(
    `/partner-portal/applications/${applicationId}/keys`,
    token,
    { method: 'POST', body: JSON.stringify(input) },
  )

export const rotateKey = (
  token: string,
  applicationId: string,
  keyId: string,
  organizationId: string,
) =>
  apiFetch<PartnerApiKeyIssued>(
    `/partner-portal/applications/${applicationId}/keys/${keyId}/rotate`,
    token,
    { method: 'POST', body: JSON.stringify({ organizationId }) },
  )

export const revokeKey = (
  token: string,
  applicationId: string,
  keyId: string,
  organizationId: string,
  reason: string,
) =>
  apiFetch<{ revoked: true }>(
    `/partner-portal/applications/${applicationId}/keys/${keyId}`,
    token,
    { method: 'DELETE', body: JSON.stringify({ organizationId, reason }) },
  )

export interface UserConsentView {
  application_id: string
  application_name: string
  partner_name: string
  environment: PartnerEnvironment
  scopes: { scope: string; description: string }[]
  granted_at: string
}

export const listMyConsents = (token: string) =>
  apiFetch<UserConsentView[]>('/partner-portal/my-consents', token)

export const revokeMyConsent = (token: string, applicationId: string) =>
  apiFetch<{ revoked: boolean }>(
    `/partner-portal/my-consents/${applicationId}`,
    token,
    { method: 'DELETE' },
  )
