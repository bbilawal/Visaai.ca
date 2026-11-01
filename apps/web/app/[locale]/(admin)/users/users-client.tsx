'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname, useRouter, Link } from '@/i18n/navigation'
import { getSession } from '@/lib/supabase/client'
import {
  bulkUsers,
  getConsultantCountries,
  setConsultantCountries,
  setUserRole,
} from '@/lib/api/admin-client'
import { ApiError } from '@/lib/api/client'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { CountryFlag } from '@/components/ui/country-flag'
import { useSupportedCountries } from '@/lib/use-supported-countries'
import type { AdminUserListResult, AdminUserView, BulkAction } from '@visaai/types'
import type { AdminUser } from '@/lib/api/admin'
import type { AppRole } from '@/lib/api/me'
import type { Route } from 'next'

// ── constants ──────────────────────────────────────────────────────────────────

const ROLES: AppRole[] = ['user', 'consultant', 'admin']
const ROLE_LABEL_KEY: Record<AppRole, string> = {
  user: 'roleUser',
  consultant: 'roleConsultant',
  admin: 'roleAdmin',
}

const cell: React.CSSProperties = { padding: '8px 6px' }
const bulkBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
  borderRadius: 'var(--radius-sm, 4px)',
  padding: '2px 10px',
  cursor: 'pointer',
  fontSize: '0.8rem',
}

// ── types ──────────────────────────────────────────────────────────────────────

interface UsersTableParams {
  q: string
  status: string
  page: number
  sort: string
  pageSize: number
}

type ConfirmState = { action: BulkAction; reason: string } | null

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--color-emerald, #1a6b40)',
  suspended: '#8a5f00',
  deleted: 'var(--color-rose, #b53030)',
}

// ── UsersTable ─────────────────────────────────────────────────────────────────

/**
 * Paginated users table with URL-driven search/filter, bulk actions, status
 * badges, and locale-aware navigation. All mutations are re-checked server-side.
 */
export function UsersTable({
  result,
  params,
  currentUserId,
}: {
  result: AdminUserListResult
  params: UsersTableParams
  currentUserId?: string
}) {
  const t = useTranslations('adminUsers')
  const router = useRouter()
  const pathname = usePathname()

  const [query, setQuery] = useState(params.q)
  const [statusFilter, setStatusFilter] = useState(params.status)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmState, setConfirmState] = useState<ConfirmState>(null)
  const mounted = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const { rows, total } = result
  const pageSize = params.pageSize ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = params.page

  // ── URL push ──────────────────────────────────────────────────────────────

  const pushUrl = useCallback(
    (q: string, status: string, page: number) => {
      const qs = new URLSearchParams()
      if (q) qs.set('q', q)
      if (status) qs.set('status', status)
      if (page > 1) qs.set('page', String(page))
      if (params.sort) qs.set('sort', params.sort)
      const search = qs.toString()
      router.replace(`${pathname}${search ? `?${search}` : ''}`)
    },
    [router, pathname, params.sort],
  )

  // Debounce search — skip on first mount to avoid replacing URL immediately.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      pushUrl(query, statusFilter, 1)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  function onStatusChange(s: string) {
    setStatusFilter(s)
    pushUrl(query, s, 1)
  }

  // ── Bulk selection ────────────────────────────────────────────────────────

  const selectableIds = useMemo(
    () => rows.filter((r) => r.id !== currentUserId).map((r) => r.id),
    [rows, currentUserId],
  )
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))

  function toggleAll() {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(selectableIds))
  }

  function toggleRow(id: string) {
    if (id === currentUserId) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Bulk execute ──────────────────────────────────────────────────────────

  async function executeBulk(action: BulkAction, reason?: string) {
    const {
      data: { session },
    } = await getSession()
    if (!session) return
    await bulkUsers(session.access_token, action, Array.from(selectedIds), reason || undefined)
    setSelectedIds(new Set())
    setConfirmState(null)
    router.refresh()
  }

  function onBulkAction(action: BulkAction) {
    if (action === 'suspend' || action === 'soft-delete') {
      setConfirmState({ action, reason: '' })
    } else {
      void executeBulk(action)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Search + status filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="input mono"
          style={{ fontSize: '0.82rem', maxWidth: 280 }}
          aria-label={t('searchPlaceholder')}
        />
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className="mono"
          style={{
            fontSize: '0.82rem',
            padding: '4px 8px',
            border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
            borderRadius: 4,
          }}
          aria-label={t('filterAllStatuses')}
        >
          <option value="">{t('filterAllStatuses')}</option>
          <option value="active">{t('statusActive')}</option>
          <option value="suspended">{t('statusSuspended')}</option>
          <option value="deleted">{t('statusDeleted')}</option>
        </select>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 12,
            padding: '8px 12px',
            background: 'var(--color-atmosphere-wash, #cfdaf5)',
            borderRadius: 4,
            flexWrap: 'wrap',
          }}
        >
          <span className="mono" style={{ fontSize: '0.82rem' }}>
            {t('bulkSelected', { count: selectedIds.size })}
          </span>
          <button type="button" className="mono" onClick={() => onBulkAction('suspend')} style={bulkBtnStyle}>
            {t('bulkSuspend')}
          </button>
          <button type="button" className="mono" onClick={() => onBulkAction('reactivate')} style={bulkBtnStyle}>
            {t('bulkReactivate')}
          </button>
          <button type="button" className="mono" onClick={() => onBulkAction('soft-delete')} style={bulkBtnStyle}>
            {t('bulkSoftDelete')}
          </button>
          <button type="button" className="mono" onClick={() => onBulkAction('restore')} style={bulkBtnStyle}>
            {t('bulkRestore')}
          </button>
        </div>
      )}

      {/* In-page confirm dialog */}
      {confirmState && (
        <ConfirmDialog
          action={confirmState.action}
          reason={confirmState.reason}
          onReasonChange={(r) => setConfirmState((s) => (s ? { ...s, reason: r } : s))}
          onConfirm={() => void executeBulk(confirmState.action, confirmState.reason || undefined)}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {/* Table */}
      {rows.length === 0 ? (
        <p className="mono text-muted" style={{ fontSize: '0.82rem' }}>
          {t('noUsers')}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }} className="mono">
            <thead>
              <tr
                style={{
                  textAlign: 'left',
                  borderBottom: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
                }}
              >
                <th style={cell}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                    disabled={selectableIds.length === 0}
                  />
                </th>
                <th style={cell}>{t('colEmail')}</th>
                <th style={cell}>{t('colName')}</th>
                <th style={cell}>{t('colStatus')}</th>
                <th style={cell}>{t('colRole')}</th>
                <th style={cell}>{t('colCountries')}</th>
                <th style={cell}>{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <UserRow
                  key={row.id}
                  row={row}
                  selected={selectedIds.has(row.id)}
                  isSelf={row.id === currentUserId}
                  onToggle={() => toggleRow(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
          <button
            type="button"
            className="mono"
            disabled={currentPage <= 1}
            onClick={() => pushUrl(query, statusFilter, currentPage - 1)}
            style={bulkBtnStyle}
          >
            {t('prev')}
          </button>
          <span className="mono" style={{ fontSize: '0.82rem' }}>
            {t('pageInfo', { page: currentPage, total: totalPages })}
          </span>
          <button
            type="button"
            className="mono"
            disabled={currentPage >= totalPages}
            onClick={() => pushUrl(query, statusFilter, currentPage + 1)}
            style={bulkBtnStyle}
          >
            {t('next')}
          </button>
        </div>
      )}
    </div>
  )
}

// ── UserRow ────────────────────────────────────────────────────────────────────

function UserRow({
  row,
  selected,
  isSelf,
  onToggle,
}: {
  row: AdminUserView
  selected: boolean
  isSelf: boolean
  onToggle: () => void
}) {
  const t = useTranslations('adminUsers')
  const [role, setRole] = useState<AppRole>(row.appRole)

  const statusColor = STATUS_COLOR[row.status] ?? 'inherit'
  const statusLabel =
    row.status === 'active'
      ? t('statusActive')
      : row.status === 'suspended'
        ? t('statusSuspended')
        : t('statusDeleted')

  return (
    <tr style={{ borderBottom: '1px solid var(--color-hairline-2, rgba(0,0,0,.08))' }}>
      <td style={cell}>
        <input
          type="checkbox"
          checked={selected}
          disabled={isSelf}
          onChange={onToggle}
          aria-label={`Select ${row.email}`}
          title={isSelf ? t('selfActionDisabled') : undefined}
        />
      </td>
      <td style={cell}>{row.email}</td>
      <td style={cell}>{row.fullName ?? '—'}</td>
      <td style={cell}>
        <span
          className="mono"
          style={{
            fontSize: '0.75rem',
            padding: '2px 6px',
            borderRadius: 3,
            background: `${statusColor}1a`, // 10% opacity tint
            color: statusColor,
            border: `1px solid ${statusColor}55`,
          }}
        >
          {statusLabel}
        </span>
      </td>
      <td style={cell}>
        <UserRoleControl user={row} onRoleChange={setRole} />
      </td>
      <td style={cell}>
        {role === 'consultant' ? (
          <ConsultantCountriesControl userId={row.id} />
        ) : (
          <span className="text-muted" style={{ fontSize: '0.72rem' }}>
            —
          </span>
        )}
      </td>
      <td style={cell}>
        <Link
          href={`/users/${row.id}` as Route}
          className="mono"
          style={{ fontSize: '0.8rem', textDecoration: 'underline', textUnderlineOffset: 2 }}
        >
          {t('manage')}
        </Link>
      </td>
    </tr>
  )
}

// ── ConfirmDialog ──────────────────────────────────────────────────────────────

function ConfirmDialog({
  action: _action,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  action: BulkAction
  reason: string
  onReasonChange: (r: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('adminUsers')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: 'var(--color-paper-canvas, #f6f3f1)',
          padding: 24,
          borderRadius: 8,
          maxWidth: 440,
          width: '90%',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <h2
          id="confirm-dialog-title"
          className="mono"
          style={{ fontSize: '1rem', fontWeight: 600 }}
        >
          {t('confirmTitle')}
        </h2>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="mono" style={{ fontSize: '0.82rem' }}>
            {t('reasonLabel')}
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder={t('reasonPlaceholder')}
            className="input mono"
            style={{ fontSize: '0.82rem' }}
            autoFocus
          />
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="mono"
            onClick={onCancel}
            style={bulkBtnStyle}
          >
            {t('confirmCancel')}
          </button>
          <button
            type="button"
            className="mono"
            onClick={onConfirm}
            style={{
              ...bulkBtnStyle,
              background: 'var(--color-rose, #b53030)',
              color: 'var(--color-surface, #fff)',
              border: '1px solid var(--color-rose, #b53030)',
            }}
          >
            {t('confirmProceed')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── UserRoleControl ────────────────────────────────────────────────────────────

/**
 * Role control. Click the role label to enter "selection mode" — a searchable
 * combobox of roles.
 *
 * "The backend re-checks admin" used to be written here and was not true:
 * `POST /admin/users/:id/role` had no last-admin or self-demotion guard, so two
 * clicks in this table could remove the platform's final administrator with no
 * way back in (ADMIN-003). The guard now exists, which makes it possible to be
 * refused — so show the server's reason instead of a bare "failed", because
 * "cannot remove the last platform admin" is the entire useful content of that
 * response.
 */
export function UserRoleControl({
  user,
  onRoleChange,
}: {
  user: AdminUser
  onRoleChange?: (role: AppRole) => void
}) {
  const t = useTranslations('admin')
  const [role, setRole] = useState<AppRole>(user.appRole)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<'' | 'saved' | 'failed'>('')
  const [reason, setReason] = useState<string | null>(null)

  async function change(next: AppRole) {
    setEditing(false)
    if (next === role) return
    setSaving(true)
    setMsg('')
    setReason(null)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error('no session')
      await setUserRole(session.access_token, user.id, next)
      setRole(next)
      onRoleChange?.(next)
      setMsg('saved')
    } catch (e) {
      setMsg('failed')
      setReason(e instanceof ApiError ? (e.detail ?? null) : null)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <SearchableSelect
        id={`role-${user.id}`}
        value={role}
        onChange={(next) => void change(next as AppRole)}
        disabled={saving}
        compact
        ariaLabel={t('colRole')}
        placeholder="Search role…"
        options={ROLES.map((r) => ({ value: r, label: t(ROLE_LABEL_KEY[r]) }))}
      />
    )
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <button
        type="button"
        className="mono"
        disabled={saving}
        onClick={() => setEditing(true)}
        style={{
          background: 'none',
          border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
          borderRadius: 'var(--radius-sm, 4px)',
          padding: '2px 8px',
          cursor: 'pointer',
          fontSize: '0.82rem',
        }}
        aria-label={`Edit role for ${user.email} (currently ${t(ROLE_LABEL_KEY[role])})`}
      >
        {t(ROLE_LABEL_KEY[role])}
      </button>
      {msg && (
        <span
          className="mono"
          role={msg === 'failed' ? 'alert' : undefined}
          style={{
            fontSize: '0.75rem',
            color: msg === 'failed' ? 'var(--color-rose, #b53030)' : undefined,
          }}
        >
          {msg === 'failed' && reason ? reason : t(msg)}
        </span>
      )}
    </span>
  )
}

// ── ConsultantCountriesControl ─────────────────────────────────────────────────

/**
 * Consultant country scope editor. Loads the current ISO-2 codes on mount and
 * saves the whole set via PUT. Strict scope is enforced server-side — an empty
 * set means the consultant sees no applications.
 */
export function ConsultantCountriesControl({ userId }: { userId: string }) {
  const { countries, loading: countriesLoading, error: countriesError } =
    useSupportedCountries()
  const [codes, setCodes] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<'' | 'saved' | 'failed'>('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const {
          data: { session },
        } = await getSession()
        if (!session) throw new Error('no session')
        const res = await getConsultantCountries(session.access_token, userId)
        if (active) setCodes(res.codes ?? [])
      } catch {
        if (active) {
          setCodes([])
          setMsg('failed')
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [userId])

  async function save(next: string[]) {
    setCodes(next)
    setSaving(true)
    setMsg('')
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error('no session')
      const res = await setConsultantCountries(session.access_token, userId, next)
      setCodes(res.codes ?? next)
      setMsg('saved')
    } catch {
      setMsg('failed')
    } finally {
      setSaving(false)
    }
  }

  function toggle(code: string) {
    if (!codes) return
    const next = codes.includes(code)
      ? codes.filter((c) => c !== code)
      : [...codes, code]
    void save(next)
  }

  if (loading || codes === null) {
    return (
      <span className="text-muted" style={{ fontSize: '0.72rem' }}>
        loading…
      </span>
    )
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 6, maxWidth: 320 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {codes.length === 0 ? (
          <span className="text-muted" style={{ fontSize: '0.72rem' }}>
            None — consultant sees no applications.
          </span>
        ) : (
          codes.map((code) => {
            const c = countries.find((x) => x.code === code)
            return (
              <button
                key={code}
                type="button"
                disabled={saving}
                onClick={() => toggle(code)}
                className="mono"
                title={`Remove ${c?.name ?? code}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
                  borderRadius: 'var(--radius-sm, 4px)',
                  padding: '1px 6px',
                  background: 'var(--color-atmosphere-wash, #cfdaf5)',
                  cursor: 'pointer',
                  fontSize: '0.72rem',
                }}
                aria-label={`Remove ${c?.name ?? code}`}
              >
                <CountryFlag code={code} size="sm" />
                <span>{code}</span>
                <span aria-hidden="true">×</span>
              </button>
            )
          })
        )}
      </div>

      <SearchableSelect
        id={`countries-${userId}`}
        value={null}
        onChange={(code) => toggle(code)}
        disabled={saving || countriesLoading || !!countriesError}
        compact
        ariaLabel="Add a country"
        placeholder={countriesError ? 'Failed to load countries' : 'Add country…'}
        options={countries
          .filter((c) => !codes.includes(c.code))
          .map((c) => ({
            value: c.code,
            label: c.name,
            meta: c.code,
            leading: <CountryFlag code={c.code} name={c.name} size="sm" />,
          }))}
      />

      {msg && (
        <span className="mono" style={{ fontSize: '0.72rem' }}>
          {msg === 'saved' ? 'saved' : 'failed'}
        </span>
      )}
    </div>
  )
}
