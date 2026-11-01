import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect({ href: '/login', locale })
  const { data: row } = await supabase.from('users').select('onboarded_at').eq('id', user.id).single()
  if (row?.onboarded_at) redirect({ href: '/', locale })
  return (
    <div className="min-h-[100dvh] bg-canvas-white flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-[560px]">{children}</div>
    </div>
  )
}
