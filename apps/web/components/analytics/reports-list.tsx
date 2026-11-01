'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createReport, runReport, scheduleReport, deleteReport, type SavedReport } from '@/lib/api/analytics-client'
import { ScheduleModal } from './schedule-modal'
import { ReportForm } from './report-form'
import { Card } from '@/components/ui/card'

async function token(): Promise<string> {
  const {
    data: { session },
  } = await createClient().auth.getSession()
  return session?.access_token ?? ''
}

export function ReportsList({
  initial,
  catalog,
}: {
  initial: SavedReport[]
  catalog: { key: string; supportedFilters: string[] }[]
}) {
  const [reports, setReports] = useState(initial)
  const [scheduling, setScheduling] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <div className="grid gap-3">
      <button type="button" onClick={() => setCreating((c) => !c)} className="self-start underline text-sm">
        New report
      </button>
      {creating && (
        <ReportForm
          catalog={catalog}
          onCreate={async (body) => {
            const created = await createReport(await token(), body)
            setReports((rs) => [created, ...rs])
            setCreating(false)
          }}
        />
      )}
      {reports.map((r) => (
        <Card key={r.id}>
          <div className="flex items-center justify-between">
            <span>
              {r.name} <span className="text-muted text-sm">({r.metricKey}/{r.metric})</span>
            </span>
            <div className="flex gap-2 text-sm">
              <button type="button" onClick={async () => runReport(await token(), r.id)}>
                Run
              </button>
              <button type="button" onClick={() => setScheduling(r.id)}>
                Schedule
              </button>
              <button
                type="button"
                onClick={async () => {
                  await deleteReport(await token(), r.id)
                  setReports((rs) => rs.filter((x) => x.id !== r.id))
                }}
              >
                Delete
              </button>
            </div>
          </div>
          {scheduling === r.id && (
            <ScheduleModal
              onClose={() => setScheduling(null)}
              onSubmit={async (v) => {
                await scheduleReport(await token(), r.id, v)
                setScheduling(null)
              }}
            />
          )}
        </Card>
      ))}
    </div>
  )
}
