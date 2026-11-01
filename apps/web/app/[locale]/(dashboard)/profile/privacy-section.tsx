'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'

/**
 * PRIV-004: data-subject rights, on the web.
 *
 * `GET /me/privacy/export` and `POST /me/privacy/delete` already existed and
 * `apps/mobile` already called them — but nothing in `apps/web` did. The
 * published privacy policy says "You can request export or deletion of your
 * data at any time", and for a web-only user that was not true: the capability
 * existed with no way to reach it.
 *
 * Deletion asks the user to type DELETE, which is the same confirmation the API
 * requires (`{"confirmation":"DELETE"}`). That is deliberate duplication — the
 * server must never rely on the client having asked.
 */
async function token(): Promise<string | null> {
  const {
    data: { session },
  } = await createClient().auth.getSession()
  return session?.access_token ?? null
}

const API = process.env.NEXT_PUBLIC_API_URL ?? ''

export function PrivacySection() {
  const { toast } = useToast()
  const [exporting, setExporting] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      const t = await token()
      if (!t) throw new Error('Your session has expired. Please sign in again.')
      const res = await fetch(`${API}/me/privacy/export`, {
        headers: { Authorization: `Bearer ${t}` },
      })
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const data = await res.json()

      // Hand the user the file directly rather than rendering it: the bundle
      // contains their documents and message history and has no business
      // sitting in the DOM.
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download = `visaai-data-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('Your data export has downloaded.', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const t = await token()
      if (!t) throw new Error('Your session has expired. Please sign in again.')
      const res = await fetch(`${API}/me/privacy/delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      })
      if (!res.ok) throw new Error(`Deletion failed (${res.status})`)
      await createClient().auth.signOut()
      // A HARD navigation on purpose. `router.push` keeps the React tree, its
      // caches and any provider state alive — all of it referencing a user that
      // no longer exists. A full document load is the only way to guarantee
      // nothing about the deleted account survives in the tab.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/'
    } catch (e) {
      toast((e as Error).message, 'error')
      setDeleting(false)
    }
  }

  return (
    <Card>
      <CardContent>
        <h2 className="type-h3 mb-2">Your data</h2>
        <p className="text-muted mb-4 text-[13px]">
          Download everything we hold about you, or permanently delete your account.
        </p>

        <Button onClick={handleExport} disabled={exporting} variant="secondary">
          {exporting ? 'Preparing your export…' : 'Download my data'}
        </Button>

        <div className="mt-6">
          {!showDelete ? (
            <Button onClick={() => setShowDelete(true)} variant="ghost">
              Delete my account
            </Button>
          ) : (
            <div>
              <Alert variant="error">
                This permanently deletes your account, applications and uploaded
                documents. It cannot be undone.
              </Alert>
              <label className="mt-3 block text-[13px]" htmlFor="delete-confirm">
                Type <strong>DELETE</strong> to confirm
              </label>
              <Input
                id="delete-confirm"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={handleDelete}
                  disabled={confirmation !== 'DELETE' || deleting}
                  variant="danger"
                >
                  {deleting ? 'Deleting…' : 'Permanently delete'}
                </Button>
                <Button
                  onClick={() => {
                    setShowDelete(false)
                    setConfirmation('')
                  }}
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
