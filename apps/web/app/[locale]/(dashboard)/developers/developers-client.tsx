'use client'

import { useCallback, useState } from 'react'
import type {
  Organization,
  PartnerApiKeySummary,
  PartnerApplication,
} from '@visaai/types'
import { createClient } from '@/lib/supabase/client'
import {
  createKey,
  createPartnerApplication,
  getPartner,
  listKeys,
  listPartnerApplications,
  listScopes,
  registerPartner,
  revokeKey,
  rotateKey,
  type PartnerRegistration,
  type ScopeDefinitionView,
} from '@/lib/api/partner-client'
import { useToast } from '@/components/providers/toast-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

async function sessionToken(): Promise<string> {
  const {
    data: { session },
  } = await createClient().auth.getSession()
  if (!session?.access_token) throw new Error('no session')
  return session.access_token
}

const STATUS_COPY: Record<PartnerRegistration['status'], string> = {
  pending:
    'Awaiting review. You can build against sandbox now; live credentials unlock on approval.',
  approved: 'Approved for live traffic.',
  suspended: 'Suspended. Live and sandbox requests are refused.',
  rejected: 'Not approved. Contact partner support.',
}

export function DevelopersClient({
  organizations,
  initialPartner,
  initialScopes,
  initialApplications,
}: {
  organizations: Organization[]
  initialPartner: PartnerRegistration | null
  initialScopes: ScopeDefinitionView[]
  initialApplications: PartnerApplication[]
}) {
  const { toast } = useToast()
  const [orgId, setOrgId] = useState(organizations[0]?.id ?? '')
  const [partner, setPartner] = useState<PartnerRegistration | null>(
    initialPartner,
  )
  const [applications, setApplications] =
    useState<PartnerApplication[]>(initialApplications)
  const [scopes, setScopes] = useState<ScopeDefinitionView[]>(initialScopes)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (targetOrgId?: string) => {
      const id = targetOrgId ?? orgId
      if (!id) return
      setLoading(true)
      try {
        const token = await sessionToken()
        const [registration, catalog] = await Promise.all([
          getPartner(token, id),
          listScopes(token),
        ])
        setPartner(registration)
        setScopes(catalog.data)
        setApplications(
          registration ? await listPartnerApplications(token, id) : [],
        )
      } catch {
        toast('Could not load partner details', 'error')
      } finally {
        setLoading(false)
      }
    },
    [orgId, toast],
  )

  // No mount effect: the server component supplied the first organization's
  // state. `load` runs only in response to a user action — switching
  // organizations, registering, or creating an application.
  async function switchOrg(next: string) {
    setOrgId(next)
    await load(next)
  }

  if (organizations.length === 0) {
    return (
      <EmptyState
        title="No organization yet"
        description="Partner access belongs to an organization. Create one first, then come back."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {organizations.length > 1 && (
        <Card>
          <CardContent className="p-6">
            <label
              htmlFor="org"
              className="text-[12px] font-medium text-rich-black"
            >
              Organization
            </label>
            <select
              id="org"
              value={orgId}
              onChange={(e) => void switchOrg(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-hairline-2 bg-canvas-white px-3 py-2 text-[13px]"
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}

      {!partner ? (
        <RegisterCard orgId={orgId} onRegistered={() => void load()} />
      ) : (
        <>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[13px] font-semibold text-rich-black">
                    {partner.legal_name}
                  </h2>
                  <p className="mt-1 text-[12px] text-midtone-gray">
                    {STATUS_COPY[partner.status]}
                  </p>
                  {partner.status_reason && (
                    <p className="mt-1 text-[12px] text-rose">
                      {partner.status_reason}
                    </p>
                  )}
                </div>
                {/* Status in words, not colour alone. */}
                <span className="shrink-0 rounded-full border border-hairline-2 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-midtone-gray">
                  {partner.status}
                </span>
              </div>
            </CardContent>
          </Card>

          <CreateApplicationCard
            orgId={orgId}
            scopes={scopes}
            partnerApproved={partner.status === 'approved'}
            onCreated={() => void load()}
          />

          {applications.length === 0 ? (
            <EmptyState
              title="No applications yet"
              description="An application holds your client credentials, scopes and webhooks. Create a sandbox one to start."
            />
          ) : (
            applications.map((application) => (
              <ApplicationCard
                key={application.id}
                orgId={orgId}
                application={application}
              />
            ))
          )}
        </>
      )}

      {loading && (
        <p className="text-[12px] text-midtone-gray">Loading…</p>
      )}
    </div>
  )
}

function RegisterCard({
  orgId,
  onRegistered,
}: {
  orgId: string
  onRegistered: () => void
}) {
  const { toast } = useToast()
  const [legalName, setLegalName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await registerPartner(await sessionToken(), {
        organizationId: orgId,
        legalName: legalName.trim(),
        contactEmail: contactEmail.trim(),
      })
      toast('Partner registration submitted', 'success')
      onRegistered()
    } catch {
      toast('Could not register. Organization admins only.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-[13px] font-semibold text-rich-black mb-1">
          Become a partner
        </h2>
        <p className="text-[12px] text-midtone-gray mb-4">
          Sandbox access is immediate. Live access to applicant data requires a
          review — we look at what you are building and which scopes you need.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="Legal entity name"
            maxLength={200}
            required
          />
          <Input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="Technical contact email"
            maxLength={320}
            required
          />
          <Button type="submit" disabled={busy}>
            {busy ? 'Submitting…' : 'Register'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function CreateApplicationCard({
  orgId,
  scopes,
  partnerApproved,
  onCreated,
}: {
  orgId: string
  scopes: ScopeDefinitionView[]
  partnerApproved: boolean
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [environment, setEnvironment] = useState<'sandbox' | 'live'>('sandbox')
  const [selected, setSelected] = useState<string[]>(['partner:read', 'usage:read'])
  const [secret, setSecret] = useState<{ clientId: string; secret: string } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const result = await createPartnerApplication(await sessionToken(), {
        organizationId: orgId,
        name: name.trim(),
        environment,
        scopes: selected,
      })
      setSecret({
        clientId: result.application.client_id,
        secret: result.client_secret,
      })
      setName('')
      toast('Application created', 'success')
      onCreated()
    } catch {
      toast('Could not create application', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-[13px] font-semibold text-rich-black mb-3">
          New application
        </h2>

        {secret && (
          // Shown once. There is no endpoint that can reveal it again.
          <div className="mb-4 rounded-md border border-amber bg-canvas-white p-3">
            <p className="text-[12px] font-medium text-rich-black">
              Copy your client secret now — it is not stored in a form we can
              show you again.
            </p>
            <p className="mt-2 break-all font-mono text-[11px] text-rich-black">
              client_id: {secret.clientId}
            </p>
            <p className="break-all font-mono text-[11px] text-rich-black">
              client_secret: {secret.secret}
            </p>
            <Button
              variant="secondary"
              className="mt-2"
              onClick={() => setSecret(null)}
            >
              I have copied it
            </Button>
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Application name"
            maxLength={120}
            required
          />

          <fieldset className="flex gap-4">
            <legend className="mb-1.5 text-[12px] font-medium text-rich-black">
              Environment
            </legend>
            {(['sandbox', 'live'] as const).map((env) => (
              <label key={env} className="flex items-center gap-2 text-[13px]">
                <input
                  type="radio"
                  name="environment"
                  value={env}
                  checked={environment === env}
                  onChange={() => setEnvironment(env)}
                  disabled={env === 'live' && !partnerApproved}
                />
                {env}
                {env === 'live' && !partnerApproved && (
                  <span className="text-[11px] text-midtone-gray">
                    (needs approval)
                  </span>
                )}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-[12px] font-medium text-rich-black">
              Scopes
            </legend>
            <div className="flex flex-col gap-1.5">
              {scopes.map((scope) => (
                <label
                  key={scope.scope}
                  className="flex items-start gap-2 text-[12px]"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.includes(scope.scope)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked
                          ? [...prev, scope.scope]
                          : prev.filter((s) => s !== scope.scope),
                      )
                    }
                  />
                  <span>
                    <span className="font-mono text-rich-black">
                      {scope.scope}
                    </span>
                    <span className="text-midtone-gray"> — {scope.description}</span>
                    {scope.requiresUserConsent && (
                      <span className="text-midtone-gray">
                        {' '}
                        Requires each user&apos;s consent.
                      </span>
                    )}
                    {environment === 'live' && scope.requiresApprovalForLive && (
                      <span className="text-amber"> Needs review before live use.</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create application'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function ApplicationCard({
  orgId,
  application,
}: {
  orgId: string
  application: PartnerApplication
}) {
  const { toast } = useToast()
  const [keys, setKeys] = useState<PartnerApiKeySummary[]>([])
  const [issued, setIssued] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const loadKeys = useCallback(async () => {
    try {
      setKeys(await listKeys(await sessionToken(), orgId, application.id))
    } catch {
      toast('Could not load keys', 'error')
    }
  }, [application.id, orgId, toast])

  // Loaded from the toggle handler, not an effect: the fetch is a consequence
  // of the user's click, and an effect that setStates on a boolean flip is the
  // pattern react-hooks/set-state-in-effect exists to flag.
  async function toggle() {
    const next = !open
    setOpen(next)
    if (next) await loadKeys()
  }

  async function mint() {
    try {
      const key = await createKey(await sessionToken(), application.id, {
        organizationId: orgId,
        name: `key-${new Date().toISOString().slice(0, 10)}`,
      })
      setIssued(key.key)
      await loadKeys()
    } catch {
      toast('Could not create key', 'error')
    }
  }

  async function rotate(keyId: string) {
    try {
      const key = await rotateKey(await sessionToken(), application.id, keyId, orgId)
      setIssued(key.key)
      toast('Rotated. The old key keeps working for 48 hours.', 'success')
      await loadKeys()
    } catch {
      toast('Could not rotate key', 'error')
    }
  }

  async function revoke(keyId: string) {
    try {
      await revokeKey(
        await sessionToken(),
        application.id,
        keyId,
        orgId,
        'revoked from the portal',
      )
      toast('Key revoked immediately', 'success')
      await loadKeys()
    } catch {
      toast('Could not revoke key', 'error')
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[13px] font-semibold text-rich-black">
              {application.name}
            </h3>
            <p className="mt-0.5 font-mono text-[11px] text-midtone-gray">
              {application.client_id}
            </p>
            <p className="mt-1 text-[12px] text-midtone-gray">
              {application.environment} · {application.status}
              {application.scopes.length > 0
                ? ` · ${application.scopes.join(', ')}`
                : ' · no scopes granted yet'}
            </p>
            {application.status === 'pending_review' && (
              <p className="mt-1 text-[12px] text-amber">
                Requested {application.requested_scopes.join(', ')} — awaiting
                review.
              </p>
            )}
          </div>
          <Button variant="secondary" onClick={() => void toggle()}>
            {open ? 'Hide keys' : 'Manage keys'}
          </Button>
        </div>

        {open && (
          <div className="mt-4 border-t border-hairline-2 pt-4">
            {issued && (
              <div className="mb-3 rounded-md border border-amber p-3">
                <p className="text-[12px] font-medium text-rich-black">
                  Copy this key now — it cannot be shown again.
                </p>
                <p className="mt-1 break-all font-mono text-[11px]">{issued}</p>
                <Button
                  variant="secondary"
                  className="mt-2"
                  onClick={() => setIssued(null)}
                >
                  I have copied it
                </Button>
              </div>
            )}

            {keys.length === 0 ? (
              <p className="text-[12px] text-midtone-gray">No keys yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {keys.map((key) => (
                  <li
                    key={key.id}
                    className="flex items-center justify-between gap-3 text-[12px]"
                  >
                    <span>
                      <span className="font-mono">
                        {key.prefix}…{key.last_four}
                      </span>
                      <span className="text-midtone-gray">
                        {' '}
                        {key.name} · {key.status}
                        {key.last_used_at
                          ? ` · last used ${new Date(key.last_used_at).toLocaleDateString()}`
                          : ' · never used'}
                      </span>
                    </span>
                    {key.status !== 'revoked' && (
                      <span className="flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => void rotate(key.id)}
                        >
                          Rotate
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void revoke(key.id)}
                        >
                          Revoke
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <Button className="mt-3" onClick={() => void mint()}>
              Create key
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
