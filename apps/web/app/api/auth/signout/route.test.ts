// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jar = new Map<string, string>()
const signOut = vi.fn()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    delete: (name: string) => jar.delete(name),
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut } }),
}))

import { POST } from './route'

describe('POST /api/auth/signout', () => {
  beforeEach(() => {
    jar.clear()
    jar.set('sb-abc-auth-token.0', 'a')
    jar.set('sb-abc-auth-token.1', 'b')
    jar.set('NEXT_LOCALE', 'en')
    signOut.mockReset()
  })

  it('redirects the form POST to /login with 303, not a re-POST', async () => {
    signOut.mockResolvedValue({ error: null })
    const res = await POST()
    expect(res.status).toBe(303)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  it('drops the session cookies even when the logout call fails', async () => {
    signOut.mockRejectedValue(new Error('network'))
    await POST()
    expect([...jar.keys()]).toEqual(['NEXT_LOCALE'])
  })
})
