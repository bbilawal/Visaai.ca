'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react'

/**
 * Theme selection.
 *
 * Three values, not two. `system` is a distinct choice from `light` or `dark`:
 * a user who has not chosen should follow their OS forever, including when the
 * OS flips at sunset. Collapsing `system` into whichever theme happens to be
 * active at first paint would silently freeze them.
 *
 * The DOM contract is a `data-theme` attribute on `<html>`, read by the
 * semantic token layer in globals.css. `system` removes the attribute entirely
 * so the `prefers-color-scheme` media query takes over — rather than writing
 * the resolved value, which would again freeze the choice.
 *
 * Both pieces of state come from `useSyncExternalStore`. They live outside
 * React — one in localStorage, one in a media query — and this is the API for
 * exactly that: it gives a server snapshot (so hydration cannot mismatch) and
 * subscribes without a setState-in-effect.
 */
export type ThemePreference = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'visaai.theme'

interface ThemeContextValue {
  /** What the user chose. */
  preference: ThemePreference
  /** What is actually on screen right now. */
  resolved: 'light' | 'dark'
  setPreference: (next: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Inline script for `<head>`, run before first paint.
 *
 * Without it the page renders light, then flips to dark once React hydrates —
 * a white flash into a dark room. This has to be blocking and inline; any
 * async or deferred alternative paints first by definition.
 *
 * Kept deliberately tiny and defensive: it runs before anything else, and a
 * throw here would take the whole page down. Storage access alone can throw in
 * Safari's private mode.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_STORAGE_KEY}');if(p==='dark'||p==='light'){document.documentElement.setAttribute('data-theme',p);}}catch(e){}})();`

// ---- preference store (localStorage) --------------------------------------

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribePreference(listener: () => void): () => void {
  listeners.add(listener)
  // `storage` fires in OTHER tabs, so changing the theme in one tab updates
  // the rest. Same-tab changes are announced by emit() in setPreference.
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function readPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    return raw === 'dark' || raw === 'light' ? raw : 'system'
  } catch {
    // Storage unavailable (private mode, blocked cookies). Follow the OS.
    return 'system'
  }
}

/** The server cannot know the preference; `system` is the honest answer. */
const preferenceServerSnapshot = (): ThemePreference => 'system'

// ---- OS preference store (media query) ------------------------------------

function subscribeSystem(listener: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

function readSystem(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

const systemServerSnapshot = (): 'light' | 'dark' => 'light'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    readPreference,
    preferenceServerSnapshot,
  )
  const system = useSyncExternalStore(
    subscribeSystem,
    readSystem,
    systemServerSnapshot,
  )

  const setPreference = useCallback((next: ThemePreference) => {
    const root = document.documentElement
    if (next === 'system') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', next)
    }
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
      else localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // The preference still applies for this session; it just will not persist.
    }
    // `storage` does not fire in the tab that wrote it.
    emit()
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved: preference === 'system' ? system : preference,
      setPreference,
    }),
    [preference, system, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
