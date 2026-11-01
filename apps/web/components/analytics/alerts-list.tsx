'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createAlert, deleteAlert, testAlert, type AlertRule } from '@/lib/api/alerts-client'
import { AlertStateBadge } from './alert-state-badge'
import { AlertForm } from './alert-form'
import { Card } from '@/components/ui/card'

async function token(): Promise<string> {
  const {
    data: { session },
  } = await createClient().auth.getSession()
  return session?.access_token ?? ''
}

export function AlertsList({
  initial,
  catalog,
}: {
  initial: AlertRule[]
  catalog: { key: string; supportedFilters: string[] }[]
}) {
  const [rules, setRules] = useState(initial)
  const [creating, setCreating] = useState(false)
  return (
    <div className="grid gap-3">
      <button type="button" className="self-start underline text-sm" onClick={() => setCreating((c) => !c)}>
        New alert
      </button>
      {creating && (
        <AlertForm
          catalog={catalog}
          onSubmit={async (body) => {
            const r = await createAlert(await token(), body)
            setRules((rs) => [r, ...rs])
            setCreating(false)
          }}
        />
      )}
      {rules.map((r) => (
        <Card key={r.id}>
          <div className="flex items-center justify-between">
            <span>
              {r.name} <span className="text-muted text-sm">({r.metricKey}/{r.metric})</span>
            </span>
            <div className="flex items-center gap-2 text-sm">
              <AlertStateBadge state={r.state} />
              <button type="button" onClick={async () => testAlert(await token(), r.id)}>
                Test
              </button>
              <button
                type="button"
                onClick={async () => {
                  await deleteAlert(await token(), r.id)
                  setRules((rs) => rs.filter((x) => x.id !== r.id))
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
