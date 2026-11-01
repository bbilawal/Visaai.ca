/**
 * A minimal in-memory `chrome` for loading the extension's entry points
 * (background.ts, content.ts, sidepanel.ts) under jsdom. Only the surface those
 * files touch is modelled; every listener is captured so a test can drive the
 * event exactly as Chrome would.
 *
 * Not a spec file (jest.config testMatch is `*.spec.ts`).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (...args: any[]) => any

export const EXT_ID = 'this-extension-id'

export interface ChromeMock {
  chrome: any
  store: Record<string, unknown>
  listeners: {
    onMessage: Fn[]
    onMessageExternal: Fn[]
    onStartup: Fn[]
    tabsUpdated: Fn[]
    tabsRemoved: Fn[]
    onAlarm: Fn[]
    storageChanged: Fn[]
  }
}

export function installChromeMock(storage: Record<string, unknown> = {}): ChromeMock {
  const store: Record<string, unknown> = { ...storage }
  const listeners: ChromeMock['listeners'] = {
    onMessage: [],
    onMessageExternal: [],
    onStartup: [],
    tabsUpdated: [],
    tabsRemoved: [],
    onAlarm: [],
    storageChanged: [],
  }
  const ev = (arr: Fn[]) => ({ addListener: (fn: Fn) => arr.push(fn) })
  const chrome = {
    runtime: {
      id: EXT_ID,
      onMessage: ev(listeners.onMessage),
      onMessageExternal: ev(listeners.onMessageExternal),
      onStartup: ev(listeners.onStartup),
      getManifest: () => ({ version: '0.0.0-test' }),
      sendMessage: jest.fn(async () => undefined),
    },
    sidePanel: { setPanelBehavior: jest.fn(async () => undefined) },
    storage: {
      local: {
        get: jest.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: jest.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items)
        }),
        remove: jest.fn(async (key: string) => {
          delete store[key]
        }),
      },
      onChanged: ev(listeners.storageChanged),
    },
    action: {
      setBadgeText: jest.fn(async () => undefined),
      setBadgeBackgroundColor: jest.fn(async () => undefined),
    },
    tabs: {
      query: jest.fn(async () => []),
      get: jest.fn(async (id: number) => ({ id, url: undefined as string | undefined })),
      sendMessage: jest.fn(async () => undefined),
      onUpdated: ev(listeners.tabsUpdated),
      onRemoved: ev(listeners.tabsRemoved),
    },
    alarms: {
      create: jest.fn(async () => undefined),
      onAlarm: ev(listeners.onAlarm),
    },
  }
  ;(globalThis as any).chrome = chrome
  // Each test loads the content script afresh; its one-copy guard must not
  // carry over from the previous test's load.
  delete (globalThis as any).__visaaiPortalAssistantLoaded
  return { chrome, store, listeners }
}

/** Let queued microtasks (and the fake storage's promises) settle. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

/**
 * Deliver one runtime message to every captured onMessage listener, the way
 * Chrome does, and resolve with whatever was passed to sendResponse — or
 * 'NO_RESPONSE' if nothing answered within `ms`.
 */
export function deliver(
  listeners: Fn[],
  msg: unknown,
  sender: Record<string, unknown> = { id: EXT_ID },
  ms = 1000,
): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('NO_RESPONSE'), ms)
    const sendResponse = (r: unknown) => {
      clearTimeout(timer)
      resolve(r)
    }
    for (const l of listeners) l(msg, sender, sendResponse)
  })
}
