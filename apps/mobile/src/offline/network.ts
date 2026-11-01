import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Connectivity state. `isConnected` means "the radio has a link";
 * `isReachable` means the OS believes the internet is actually reachable —
 * a captive-portal hotel wifi is connected but not reachable, and treating
 * those as the same thing produces uploads that hang until timeout.
 */
export interface NetworkState {
  isConnected: boolean;
  isReachable: boolean;
  type: string;
}

let current: NetworkState = { isConnected: true, isReachable: true, type: 'unknown' };
const listeners = new Set<(s: NetworkState) => void>();

function normalize(raw: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
  type?: string;
}): NetworkState {
  return {
    isConnected: raw.isConnected ?? false,
    // `isInternetReachable` is null while the probe is in flight; assume the
    // link works rather than blocking the user behind an "offline" screen.
    isReachable: raw.isInternetReachable ?? raw.isConnected ?? false,
    type: raw.type ?? 'unknown',
  };
}

export function startNetworkMonitor(): () => void {
  const unsubscribe = NetInfo.addEventListener((state) => {
    current = normalize(state as Parameters<typeof normalize>[0]);
    listeners.forEach((l) => l(current));
  });
  void NetInfo.fetch().then((state) => {
    current = normalize(state as Parameters<typeof normalize>[0]);
    listeners.forEach((l) => l(current));
  });
  return unsubscribe;
}

export function getNetworkState(): NetworkState {
  return current;
}

export function isOnline(): boolean {
  return current.isConnected && current.isReachable;
}

export function onNetworkChange(listener: (s: NetworkState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React binding for banners and disabled submit buttons. */
export function useNetwork(): NetworkState {
  const [state, setState] = useState<NetworkState>(current);
  useEffect(() => onNetworkChange(setState), []);
  return state;
}

/** Test seam. */
export function __setNetworkState(next: NetworkState): void {
  current = next;
  listeners.forEach((l) => l(current));
}
