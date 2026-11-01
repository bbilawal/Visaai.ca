const KEY = 'va_anon_id';

export function getAnonymousId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // localStorage can throw (private browsing, blocked storage, sandboxed
    // iframe) — analytics must never break the UX, so degrade to anonymous.
    return '';
  }
}
