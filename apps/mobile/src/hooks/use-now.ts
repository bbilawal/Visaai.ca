import { useEffect, useState } from 'react';

/**
 * A clock that React can depend on.
 *
 * Screens need "is this appointment still upcoming?", which means reading the
 * current time. Calling `Date.now()` in a render body is impure — the output
 * changes without any state changing, so React (and the React Compiler lint,
 * react-hooks/purity) cannot reason about when to re-render. Holding the time
 * in state and advancing it on an interval makes it an ordinary dependency,
 * and has the nice side effect that a screen left open actually updates when a
 * meeting time passes instead of going stale.
 *
 * Returns 0 until the first effect runs. Callers should treat 0 as "not known
 * yet" rather than as the epoch.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    // Both updates are scheduled, never synchronous inside the effect body: a
    // synchronous setState here would cascade an extra render on every mount.
    const seed = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(seed);
      clearInterval(id);
    };
  }, [intervalMs]);

  return now;
}
