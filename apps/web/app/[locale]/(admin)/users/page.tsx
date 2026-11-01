import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getUsers } from '@/lib/api/admin'
import { UsersTable } from './users-client'

type SearchParams = Promise<{
  q?: string
  status?: string
  page?: string
  sort?: string
}>

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)

  const [result, supabase, t] = await Promise.all([
    getUsers({ q: sp.q, status: sp.status, page, sort: sp.sort }),
    createClient(),
    getTranslations('adminUsers'),
  ])

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const currentUserId = user?.id

  return (
    <div>
      <h1 className="type-h3" style={{ marginBottom: 12 }}>
        {t('heading')}
      </h1>
      <UsersTable
        result={result}
        params={{
          q: sp.q ?? '',
          status: sp.status ?? '',
          page,
          sort: sp.sort ?? '',
          pageSize: 25,
        }}
        currentUserId={currentUserId}
      />
    </div>
  )
}
