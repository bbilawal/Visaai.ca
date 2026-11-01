import type { AdminApplicationsQuery } from '@/lib/api/assignment'
import type { ApplicationsSearchValues } from './applications-search'

/**
 * Shared (server + client) helpers that translate between the URL searchParams,
 * the search-bar's form values, and the API query object. Kept free of any
 * runtime imports / 'use client' so the server page can import it directly.
 *
 * The URL carries deadline values as the raw `datetime-local` strings the inputs
 * round-trip (local wall-clock, no timezone); we only convert them to ISO at the
 * API boundary (toApplicationsQuery), so a shared/refreshed link repopulates the
 * inputs verbatim.
 */

/** First value of a Next.js searchParams entry (string | string[] | undefined). */
function first(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? ''
  return v ?? ''
}

/** Raw awaited searchParams shape (Next.js 15+ — params are promises). */
export type RawSearchParams = Record<string, string | string[] | undefined>

/** searchParams → the search-bar's controlled form values. */
export function parseApplicationsSearch(
  sp: RawSearchParams,
): ApplicationsSearchValues {
  const status = first(sp.assignmentStatus)
  return {
    q: first(sp.q),
    assignee: first(sp.assignee),
    assignmentStatus:
      status === 'ASSIGNED' || status === 'UNASSIGNED' ? status : '',
    deadlineFrom: first(sp.deadlineFrom),
    deadlineTo: first(sp.deadlineTo),
  }
}

/**
 * Convert a local-wall-clock "YYYY-MM-DDTHH:mm" datetime-local value to an ISO
 * string for the API. Returns undefined for an empty/unparseable value so the
 * filter is omitted rather than sent as a bad date.
 */
function localToIso(local: string): string | undefined {
  if (!local) return undefined
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** Form values → the API query (empties omitted; deadlines normalised to ISO). */
export function toApplicationsQuery(
  values: ApplicationsSearchValues,
): AdminApplicationsQuery {
  return {
    q: values.q || undefined,
    assignee: values.assignee || undefined,
    assignmentStatus: values.assignmentStatus || undefined,
    deadlineFrom: localToIso(values.deadlineFrom),
    deadlineTo: localToIso(values.deadlineTo),
  }
}
