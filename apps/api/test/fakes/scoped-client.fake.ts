import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A minimal stand-in for an RLS-scoped Supabase client.
 *
 * The messaging specs previously used `{} as SupabaseClient`, which works right
 * up until the code under test actually reads the database. SEC-105 added an
 * authorization check that does exactly that — `ensureConversation` now
 * confirms the application is visible under the CALLER'S scope before creating
 * anything — and every one of those specs failed with `db.from is not a
 * function`.
 *
 * The tempting shortcut was to make the production check tolerate a client
 * without `.from()`. That would have made an authorization check skippable by
 * passing the wrong object, which is precisely the kind of "safe by accident"
 * code the check exists to remove. The fake models the client instead.
 *
 * `visible: false` simulates an RLS-filtered row — the not-your-application
 * case — so a spec can assert the denial rather than only the happy path.
 */
export function fakeScopedClient({
  visible = true,
}: { visible?: boolean } = {}): SupabaseClient {
  const result = Promise.resolve({
    data: visible ? { id: 'app-1' } : null,
    error: null,
  });

  // Every builder method returns the same chainable object; the chain resolves
  // to `result` whichever terminal the caller uses.
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'is']) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = () => result;
  chain.single = () => result;
  chain.then = (...args: unknown[]) =>
    (result as unknown as { then: (...a: unknown[]) => unknown }).then(...args);

  return { from: () => chain } as unknown as SupabaseClient;
}
