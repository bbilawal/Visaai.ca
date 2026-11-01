'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { getSession } from '@/lib/supabase/client'
import {
  suspendUser,
  reactivateUser,
  softDeleteUser,
  restoreUser,
  resetUserPassword,
  grantUserRole,
  revokeUserRole,
} from '@/lib/api/admin-client'
import type { AdminUserDetail } from '@visaai/types'
import type { RoleCatalogEntry } from '@/lib/api/admin'

// ── Types ─────────────────────────────────────────────────────────────────────

type LifecycleAction = 'suspend' | 'reactivate' | 'soft-delete' | 'restore'

interface ConfirmState {
  action: LifecycleAction
  reason: string
}

// ── Shared button style ───────────────────────────────────────────────────────

const btnBase: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
  borderRadius: 'var(--radius-sm, 4px)',
  padding: '4px 12px',
  cursor: 'pointer',
  fontSize: '0.82rem',
}

const btnDestructive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--color-rose, #b53030)',
  color: 'var(--color-surface, #fff)',
  border: '1px solid var(--color-rose, #b53030)',
}

// ── Focus trap helpers ────────────────────────────────────────────────────────

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

function trapFocus(container: HTMLElement, e: KeyboardEvent) {
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]

  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault()
      last.focus()
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

// ── LifecycleConfirmDialog ────────────────────────────────────────────────────

function LifecycleConfirmDialog({
  state,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  state: ConfirmState
  onReasonChange: (r: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('adminUsers')
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)

  // Focus first control on open
  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])

  // Tab trap + Escape close
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCancel()
        return
      }
      if (e.key === 'Tab') {
        trapFocus(el!, e)
      }
    }

    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const needsReason = state.action === 'suspend' || state.action === 'soft-delete'

  return (
    <div
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lifecycle-confirm-title"
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
        <h3
          id="lifecycle-confirm-title"
          className="mono"
          style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}
        >
          {t('confirmTitle')}
        </h3>

        {needsReason && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="mono" style={{ fontSize: '0.82rem' }}>
              {t('reasonLabel')}
            </span>
            <input
              ref={firstInputRef}
              type="text"
              value={state.reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              className="input mono"
              style={{ fontSize: '0.82rem' }}
            />
          </label>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="mono"
            onClick={onCancel}
            style={btnBase}
          >
            {t('confirmCancel')}
          </button>
          <button
            type="button"
            className="mono"
            onClick={onConfirm}
            style={btnDestructive}
            ref={needsReason ? undefined : (el) => el?.focus()}
          >
            {t('confirmProceed')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── UserDetailClient ──────────────────────────────────────────────────────────

export function UserDetailClient({
  detail,
  roleCatalog,
  currentUserId,
}: {
  detail: AdminUserDetail
  roleCatalog: RoleCatalogEntry[]
  currentUserId: string
}) {
  const t = useTranslations('adminUsers')
  const router = useRouter()

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [pending, setPending] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [roleError, setRoleError] = useState<string | null>(null)

  const isSelf = detail.id === currentUserId

  // ── Flash helper ───────────────────────────────────────────────────────────

  const showFlash = useCallback((msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 3000)
  }, [])

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async function execAction(action: LifecycleAction, reason?: string) {
    setPending(true)
    setFlash(null)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('no session')
      const token = session.access_token
      const id = detail.id

      switch (action) {
        case 'suspend':
          await suspendUser(token, id, reason)
          break
        case 'reactivate':
          await reactivateUser(token, id)
          break
        case 'soft-delete':
          await softDeleteUser(token, id, reason)
          break
        case 'restore':
          await restoreUser(token, id)
          break
      }

      setConfirmState(null)
      router.refresh()
    } catch {
      showFlash(t('failed'))
    } finally {
      setPending(false)
    }
  }

  function openConfirm(action: LifecycleAction) {
    setConfirmState({ action, reason: '' })
  }

  async function onConfirm() {
    if (!confirmState) return
    const needsReason = confirmState.action === 'suspend' || confirmState.action === 'soft-delete'
    await execAction(confirmState.action, needsReason ? confirmState.reason || undefined : undefined)
  }

  // ── Reset password ─────────────────────────────────────────────────────────

  async function handleResetPassword() {
    setPending(true)
    setFlash(null)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('no session')
      await resetUserPassword(session.access_token, detail.id)
      showFlash(t('resetSent'))
    } catch {
      showFlash(t('failed'))
    } finally {
      setPending(false)
    }
  }

  // ── Role grant/revoke ──────────────────────────────────────────────────────

  async function handleGrantRole(roleKey: string) {
    setRoleError(null)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('no session')
      await grantUserRole(session.access_token, detail.id, roleKey)
      router.refresh()
    } catch {
      setRoleError(t('failed'))
    }
  }

  async function handleRevokeRole(roleKey: string) {
    setRoleError(null)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('no session')
      await revokeUserRole(session.access_token, detail.id, roleKey)
      router.refresh()
    } catch {
      setRoleError(t('failed'))
    }
  }

  // ── Lifecycle buttons by current status ────────────────────────────────────

  const status = detail.status

  const availableActions: LifecycleAction[] = status === 'active'
    ? ['suspend', 'soft-delete']
    : status === 'suspended'
      ? ['reactivate', 'soft-delete']
      : ['restore']

  // Also show reset-password when active or suspended (not deleted)
  const showResetPassword = status !== 'deleted'

  // ── Roles catalog filtered to those not already held ───────────────────────

  const heldRoleKeys = new Set(detail.roles)
  const addableRoles = roleCatalog.filter((r) => !heldRoleKeys.has(r.key))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Confirm dialog ──────────────────────────────────────────────────── */}
      {confirmState && (
        <LifecycleConfirmDialog
          state={confirmState}
          onReasonChange={(r) => setConfirmState((s) => (s ? { ...s, reason: r } : s))}
          onConfirm={() => void onConfirm()}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {/* ── Lifecycle actions ────────────────────────────────────────────────── */}
      <section
        aria-label="Lifecycle actions"
        style={{
          background: 'var(--color-paper-canvas, #f6f3f1)',
          border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
          borderRadius: 8,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {availableActions.map((action) => {
            const isDestructive = action === 'suspend' || action === 'soft-delete'
            const selfBlocked = isSelf && isDestructive

            const label =
              action === 'suspend'
                ? t('actionSuspend')
                : action === 'reactivate'
                  ? t('actionReactivate')
                  : action === 'soft-delete'
                    ? t('actionSoftDelete')
                    : t('actionRestore')

            return (
              <button
                key={action}
                type="button"
                className="mono"
                disabled={pending || selfBlocked}
                title={selfBlocked ? t('selfActionDisabled') : undefined}
                onClick={() => {
                  if (isDestructive) {
                    openConfirm(action)
                  } else {
                    void execAction(action)
                  }
                }}
                style={isDestructive && !selfBlocked ? btnDestructive : btnBase}
              >
                {label}
              </button>
            )
          })}

          {showResetPassword && (
            <button
              type="button"
              className="mono"
              disabled={pending}
              onClick={() => void handleResetPassword()}
              style={btnBase}
            >
              {t('actionResetPassword')}
            </button>
          )}
        </div>

        {flash && (
          <p className="mono" style={{ fontSize: '0.8rem', marginTop: 10, margin: '10px 0 0' }}>
            {flash}
          </p>
        )}
      </section>

      {/* ── Roles editor ─────────────────────────────────────────────────────── */}
      <section
        aria-label={t('rolesHeading')}
        style={{
          background: 'var(--color-paper-canvas, #f6f3f1)',
          border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
          borderRadius: 8,
          padding: 20,
        }}
      >
        <h3 className="mono" style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 12 }}>
          {t('rolesHeading')}
        </h3>

        {/* Current role chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {detail.roles.length === 0 ? (
            <span className="mono text-muted" style={{ fontSize: '0.82rem' }}>
              {t('noRoles')}
            </span>
          ) : (
            detail.roles.map((roleKey) => {
              const entry = roleCatalog.find((r) => r.key === roleKey)
              const label = entry?.name ?? roleKey
              return (
                <span
                  key={roleKey}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '2px 8px',
                    background: 'var(--color-atmosphere-wash, #cfdaf5)',
                    border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
                    borderRadius: 'var(--radius-sm, 4px)',
                    fontSize: '0.8rem',
                  }}
                >
                  <span className="mono">{label}</span>
                  <button
                    type="button"
                    aria-label={`Remove role ${roleKey}`}
                    onClick={() => void handleRevokeRole(roleKey)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '0 2px',
                      fontSize: '0.85rem',
                      lineHeight: 1,
                      color: 'inherit',
                    }}
                  >
                    ×
                  </button>
                </span>
              )
            })
          )}
        </div>

        {/* Add role select */}
        {addableRoles.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="mono"
              defaultValue=""
              aria-label={t('addRole')}
              onChange={(e) => {
                if (e.target.value) {
                  void handleGrantRole(e.target.value)
                  e.target.value = ''
                }
              }}
              style={{
                fontSize: '0.82rem',
                padding: '4px 8px',
                border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
                borderRadius: 4,
              }}
            >
              <option value="" disabled>
                {t('addRole')}…
              </option>
              {addableRoles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {roleError && (
          <p
            className="mono"
            style={{ fontSize: '0.8rem', color: 'var(--color-rose, #b53030)', marginTop: 8 }}
          >
            {roleError}
          </p>
        )}
      </section>
    </>
  )
}
