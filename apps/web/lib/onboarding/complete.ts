import { createClient } from '@/lib/supabase/client'

/** Idempotently mark the current user onboarded (RLS own-row policy authorizes). */
export async function markOnboarded(userId: string): Promise<{ error: unknown }> {
  const { error } = await createClient()
    .from('users')
    .update({ onboarded_at: new Date().toISOString() })
    .eq('id', userId)
  return { error }
}
