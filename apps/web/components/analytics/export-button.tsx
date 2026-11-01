'use client'
import { exportUrl } from '@/lib/api/analytics-client'

export function ExportButton({ metricKey, query }: { metricKey: string; query: any }) {
  const formats: Array<'csv' | 'xlsx' | 'pdf'> = ['csv', 'xlsx', 'pdf']
  return (
    <div className="flex gap-2 text-sm">
      {formats.map((f) => (
        <a key={f} href={exportUrl(metricKey, query, f)} download className="underline">
          {f.toUpperCase()}
        </a>
      ))}
    </div>
  )
}
