import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/** Supabase keeps the session in `sb-<ref>-auth-token` cookies, chunked as `.0`, `.1`… when large. */
const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/

export async function POST() {
  const supabase = await createClient()
  // supabase-js keeps the session when the logout call itself fails (network
  // error, GoTrue 5xx), so the applicant clicked Sign out and stayed signed in
  // (live 2026-10-24). Revoke when we can, then drop the session cookies anyway.
  await supabase.auth.signOut().catch(() => undefined)
  const cookieStore = await cookies()
  // Every chunk of each session cookie seen: a token refreshed on this very
  // request can be re-chunked under names this request never carried.
  const bases = new Set(
    cookieStore.getAll().flatMap(({ name }) => (SESSION_COOKIE.test(name) ? [name.replace(/\.\d+$/, '')] : [])),
  )
  for (const base of bases) {
    cookieStore.delete(base)
    for (let i = 0; i < 5; i++) cookieStore.delete(`${base}.${i}`)
  }
  // 303: the form POSTed here, and a 307 made the browser POST to /login too.
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'), 303)
}
