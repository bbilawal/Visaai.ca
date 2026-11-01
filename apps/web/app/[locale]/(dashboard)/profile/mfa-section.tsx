'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import {
  createClient,
  mfaChallengeAndVerify,
  mfaEnroll,
  mfaListFactors,
  mfaUnenroll,
} from '@/lib/supabase/client'
import { recordMfaEvent } from '@/lib/api/iam-client'
import { useToast } from '@/components/providers/toast-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'

type VerifiedFactor = { id: string; friendly_name?: string }
type Enrolling = { factorId: string; qr: string; secret: string }

async function token(): Promise<string | null> {
  const {
    data: { session },
  } = await createClient().auth.getSession()
  return session?.access_token ?? null
}

export function MfaSection() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [factors, setFactors] = useState<VerifiedFactor[]>([])
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const { data } = await mfaListFactors()
    const totp = (data?.totp ?? []).filter((f) => f.status === 'verified')
    setFactors(totp.map((f) => ({ id: f.id, friendly_name: f.friendly_name })))
    setLoading(false)
  }

  useEffect(() => {
    // Fetch enrolled factors on mount; state updates happen post-await (async),
    // not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [])

  const enabled = factors.length > 0

  async function handleEnable() {
    setBusy(true)
    const { data, error } = await mfaEnroll()
    setBusy(false)
    if (error || !data) {
      toast('Could not start enrollment', 'error')
      return
    }
    setEnrolling({
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
    })
    setCode('')
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!enrolling || code.trim().length < 6) return
    setBusy(true)
    const { error } = await mfaChallengeAndVerify(enrolling.factorId, code.trim())
    if (error) {
      setBusy(false)
      toast('Invalid code — try again', 'error')
      return
    }
    const t = await token()
    if (t) await recordMfaEvent(t, 'mfa_enabled').catch(() => undefined)
    setEnrolling(null)
    setCode('')
    await refresh()
    setBusy(false)
    toast('Two-factor authentication enabled', 'success')
  }

  async function handleDisable(factorId: string) {
    setBusy(true)
    const { error } = await mfaUnenroll(factorId)
    if (error) {
      setBusy(false)
      toast('Could not disable 2FA', 'error')
      return
    }
    const t = await token()
    if (t) await recordMfaEvent(t, 'mfa_disabled').catch(() => undefined)
    await refresh()
    setBusy(false)
    toast('Two-factor authentication disabled', 'success')
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-[13px] font-semibold text-rich-black mb-1">
          Two-factor authentication
        </h2>
        <p className="text-[12px] text-midtone-gray mb-4">
          Add an authenticator app (TOTP) for a second layer of sign-in security.
        </p>

        {loading ? (
          <p className="text-[12px] text-midtone-gray">Loading…</p>
        ) : enrolling ? (
          <form onSubmit={handleVerify} className="flex flex-col gap-3">
            <Alert variant="info">
              Scan this QR code in your authenticator app, then enter the 6-digit
              code to confirm.
            </Alert>
            {enrolling && (
              <>
                <Image
                  src={enrolling.qr}
                  alt="TOTP QR code"
                  width={180}
                  height={180}
                  unoptimized
                  className="rounded-md border border-hairline-2 bg-white p-2"
                />
                <p className="break-all text-[11px] text-midtone-gray">
                  Or enter this secret manually: <code>{enrolling.secret}</code>
                </p>
              </>
            )}
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="mfa-code"
                  className="text-[12px] font-medium text-rich-black"
                >
                  6-digit code
                </label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={6}
                  className="w-[120px]"
                />
              </div>
              <Button type="submit" loading={busy} disabled={code.trim().length < 6}>
                Verify
              </Button>
              <button
                type="button"
                className="text-[12px] text-midtone-gray hover:underline"
                onClick={() => setEnrolling(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : enabled ? (
          <div className="flex flex-col gap-3">
            <Alert variant="success">Two-factor authentication is on.</Alert>
            {factors.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-md border border-hairline-2 px-3 py-2"
              >
                <span className="text-[13px] text-rich-black">
                  {f.friendly_name || 'Authenticator app'}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className="text-[12px] text-rose hover:underline disabled:opacity-50"
                  onClick={() => handleDisable(f.id)}
                >
                  Disable
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Button onClick={handleEnable} loading={busy}>
            Enable 2FA
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
