const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /**
     * The API's own explanation, when it sent one.
     *
     * `message` stays the terse `METHOD /path -> status` line every existing
     * caller and test matches on; this carries the server's reason alongside it.
     * Guards that refuse an action for a specific reason — "cannot remove the
     * last platform admin" — were being flattened into a bare "failed" in the
     * UI, which tells an admin nothing about what to do instead.
     */
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** NestJS error bodies are `{ message, error, statusCode }`; `message` may be a list. */
function readDetail(body: string): string | undefined {
  if (!body) return undefined
  try {
    const parsed: unknown = JSON.parse(body)
    const m = (parsed as { message?: unknown } | null)?.message
    if (typeof m === 'string') return m
    if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join('; ') || undefined
  } catch {
    // Not JSON — a proxy error page, say. The status alone is the signal.
  }
  return undefined
}

/** Authenticated fetch to the NestJS API. Caller supplies the Supabase access token. */
export async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    throw new ApiError(
      res.status,
      `${init?.method ?? 'GET'} ${path} -> ${res.status}`,
      readDetail(await res.text().catch(() => '')),
    )
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
