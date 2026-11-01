import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError, type ApiError } from '@/api/errors';

/**
 * Minimal async-data hook.
 *
 * Deliberately not react-query: the app needs load / error / refresh and
 * nothing more, and a cache layer here would be a second source of truth for
 * case data that must always reflect the server.
 *
 * Guarantees that matter on mobile:
 *  - the in-flight request is aborted on unmount (screens are popped mid-fetch
 *    constantly), so no setState-after-unmount and no wasted cellular data;
 *  - a stale response from a superseded call never overwrites a newer one;
 *  - the first fetch is scheduled on a microtask rather than run synchronously
 *    inside the effect, which keeps it off the render → setState → re-render
 *    cascade the React Compiler lint (react-hooks/set-state-in-effect) flags.
 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | Error | null;
  refresh: () => Promise<void>;
  /** True while a user-initiated pull-to-refresh is running. */
  refreshing: boolean;
}

/**
 * `key` identifies the request (e.g. an application id) and is the only trigger
 * for a refetch. It replaces a spread dependency array: the React Compiler lint
 * requires a literal dependency list, and a single stable key is also less
 * error-prone than a variadic array whose length can change between renders.
 */
export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  key: string | number = '',
  options: { enabled?: boolean } = {},
): AsyncState<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);

  // The fetcher is a fresh closure on every render. Holding it in a ref (updated
  // in an effect, never during render) lets the refetch trigger be `key` alone
  // instead of re-firing whenever the parent re-renders.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const run = useCallback(
    async (isRefresh: boolean): Promise<void> => {
      if (!enabled) return;
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      const id = ++requestId.current;

      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const result = await fetcherRef.current(ctrl.signal);
        // Discard if a newer request started or the screen went away.
        if (!mounted.current || id !== requestId.current) return;
        setData(result);
        setError(null);
      } catch (e) {
        if (!mounted.current || id !== requestId.current) return;
        if (ctrl.signal.aborted) return;
        setError(isApiError(e) ? e : e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (mounted.current && id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [enabled],
  );

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void run(false);
    });
    return () => {
      cancelled = true;
      mounted.current = false;
      controller.current?.abort();
    };
  }, [run, key]);

  const refresh = useCallback(() => run(true), [run]);

  return { data, loading, error, refresh, refreshing };
}
