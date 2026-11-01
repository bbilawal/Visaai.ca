'use client'
import { useState } from 'react'
import { presetToCron } from '@/lib/analytics/preset-cron'

export function ScheduleModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (v: { cron: string; format: 'pdf' | 'xlsx'; recipients: string[]; notifyUserIds: string[] }) => void
  onClose: () => void
}) {
  const [freq, setFreq] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [day, setDay] = useState(1)
  const [time, setTime] = useState('08:00')
  const [format, setFormat] = useState<'pdf' | 'xlsx'>('pdf')
  const [recipients, setRecipients] = useState('')
  return (
    <div role="dialog" aria-label="Schedule report" className="p-4 border rounded">
      <label>
        Frequency{' '}
        <select value={freq} onChange={(e) => setFreq(e.target.value as any)}>
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
          <option value="monthly">monthly</option>
        </select>
      </label>
      {freq !== 'daily' && (
        <label>
          Day <input type="number" value={day} onChange={(e) => setDay(+e.target.value)} />
        </label>
      )}
      <label>
        Time <input aria-label="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <label>
        Format{' '}
        <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
          <option value="pdf">pdf</option>
          <option value="xlsx">xlsx</option>
        </select>
      </label>
      <label>
        Recipients{' '}
        <input
          aria-label="recipients"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder="comma,separated"
        />
      </label>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        onClick={() =>
          onSubmit({
            cron: presetToCron({ freq, day, time }),
            format,
            recipients: recipients
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            notifyUserIds: [],
          })
        }
      >
        Save
      </button>
    </div>
  )
}
