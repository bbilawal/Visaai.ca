'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from '@/i18n/navigation'

export interface ApplicationsSearchValues {
  q: string
  assignee: string
  assignmentStatus: '' | 'ASSIGNED' | 'UNASSIGNED'
  deadlineFrom: string
  deadlineTo: string
}

/**
 * Server-side search bar for the admin applications/assignments lists. Writes
 * the current filter state into the URL query string (debounced ~300ms) via the
 * next-intl router so the server component re-fetches with the new params and
 * the locale prefix is preserved. Initial values come from the server-read
 * searchParams, so the inputs survive a refresh / shared link.
 *
 * UI only: every filter is enforced server-side; this just shapes the request.
 */
export function ApplicationsSearch({
  initial,
}: {
  initial: ApplicationsSearchValues
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [values, setValues] = useState<ApplicationsSearchValues>(initial)
  // Skip the first effect run so we don't immediately replace the URL on mount.
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const handle = setTimeout(() => {
      const params = new URLSearchParams()
      const set = (key: string, value: string) => {
        const v = value.trim()
        if (v) params.set(key, v)
      }
      set('q', values.q)
      set('assignee', values.assignee)
      set('assignmentStatus', values.assignmentStatus)
      set('deadlineFrom', values.deadlineFrom)
      set('deadlineTo', values.deadlineTo)
      const qs = params.toString()
      // next-intl router keeps the active locale prefix automatically.
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`)
    }, 300)
    return () => clearTimeout(handle)
  }, [values, router, pathname])

  function update<K extends keyof ApplicationsSearchValues>(
    key: K,
    value: ApplicationsSearchValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const hasFilters =
    values.q ||
    values.assignee ||
    values.assignmentStatus ||
    values.deadlineFrom ||
    values.deadlineTo

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
        flexWrap: 'wrap',
        marginBottom: 16,
        padding: 12,
        border: '1px solid var(--color-hairline-2, rgba(0,0,0,.12))',
        borderRadius: 'var(--radius-md, 8px)',
      }}
    >
      <Field label="Application ID">
        <input
          type="text"
          value={values.q}
          onChange={(e) => update('q', e.target.value)}
          placeholder="id…"
          className="input mono"
          style={{ fontSize: '0.78rem', width: 140 }}
          aria-label="Search by application ID"
        />
      </Field>

      <Field label="Assignee email">
        <input
          type="text"
          value={values.assignee}
          onChange={(e) => update('assignee', e.target.value)}
          placeholder="email…"
          className="input mono"
          style={{ fontSize: '0.78rem', width: 180 }}
          aria-label="Search by assignee email"
        />
      </Field>

      <Field label="Assignment">
        <select
          value={values.assignmentStatus}
          onChange={(e) =>
            update(
              'assignmentStatus',
              e.target.value as ApplicationsSearchValues['assignmentStatus'],
            )
          }
          className="select mono"
          style={{ fontSize: '0.78rem' }}
          aria-label="Filter by assignment status"
        >
          <option value="">All</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="UNASSIGNED">Not Assigned</option>
        </select>
      </Field>

      <Field label="Deadline from">
        <input
          type="datetime-local"
          value={values.deadlineFrom}
          onChange={(e) => update('deadlineFrom', e.target.value)}
          className="input mono"
          style={{ fontSize: '0.78rem' }}
          aria-label="Deadline from"
        />
      </Field>

      <Field label="Deadline to">
        <input
          type="datetime-local"
          value={values.deadlineTo}
          onChange={(e) => update('deadlineTo', e.target.value)}
          className="input mono"
          style={{ fontSize: '0.78rem' }}
          aria-label="Deadline to"
        />
      </Field>

      {hasFilters && (
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() =>
            setValues({
              q: '',
              assignee: '',
              assignmentStatus: '',
              deadlineFrom: '',
              deadlineTo: '',
            })
          }
        >
          Clear
        </button>
      )}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <span
        className="mono text-muted"
        style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}
