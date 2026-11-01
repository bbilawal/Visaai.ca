'use client'

import { createContext, useContext, useState, useCallback, useId } from 'react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  message: string
  type: ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex items-center gap-3 rounded-[14px] px-4 py-3 text-[13px] leading-[1.5] shadow-lg min-w-[240px] max-w-[360px]',
        toast.type === 'success' && 'bg-deep-black text-canvas-white',
        toast.type === 'error' && 'bg-callout-red text-canvas-white',
        toast.type === 'info' && 'bg-ghost-gray text-rich-black border border-subtle-ash',
      )}
    >
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={onRemove}
        aria-label="Dismiss notification"
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity text-[16px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current rounded"
      >
        ×
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const baseId = useId()

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `${baseId}-${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => removeToast(id), 4000)
  }, [baseId, removeToast])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-label="Notifications"
          className="fixed bottom-4 end-4 flex flex-col gap-2 z-50"
        >
          {toasts.map(t => (
            <ToastItem key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
