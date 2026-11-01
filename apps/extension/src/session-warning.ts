/**
 * IRCC's own "Session timeout warning" (live 2026-10-18): a dialog about 3¾
 * minutes before IRCC signs the applicant out, with "Continue session". An
 * applicant on VisaAI or in another tab misses it and loses the page they
 * have not saved. The content script reports it to the side panel, which
 * says what to do. Read-only: the assistant never presses IRCC's buttons.
 */
export function sessionWarningShown(root: ParentNode = document): boolean {
  return Array.from(root.querySelectorAll('mat-dialog-container, [role="dialog"]')).some(
    (d) =>
      rendered(d) &&
      /session timeout warning|your session (will|is about to) expire/i.test(
        (d as HTMLElement).innerText ?? d.textContent ?? '',
      ),
  )
}

/**
 * The PR portal keeps its timeout dialogs in the page at all times, inside a
 * `<lib-modal>` host with `display: none` until they open (live 2026-10-20);
 * `innerText` still returns their text, so the wording alone would report the
 * warning on every page.
 */
function rendered(el: Element): boolean {
  // visibility is inherited (and overridable), so the dialog's own says it all.
  if (getComputedStyle(el).visibility === 'hidden') return false
  for (let e: Element | null = el; e; e = e.parentElement) {
    if ((e as HTMLElement).hidden) return false
    if (getComputedStyle(e).display === 'none') return false
  }
  return true
}

/** At most one check per this many ms: the warning gives minutes of notice. */
export const SESSION_CHECK_MS = 300
/** A check even on a quiet page, whatever way the portal opens its dialog. */
export const SESSION_POLL_MS = 5000

/** Calls `report(shown)` whenever the warning appears or goes away. */
export function watchSessionWarning(report: (shown: boolean) => void, root: Node = document.body): () => void {
  let last = false
  let pending: ReturnType<typeof setTimeout> | undefined
  let obs: MutationObserver | undefined
  let poll: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    obs?.disconnect()
    clearInterval(poll)
    clearTimeout(pending)
  }
  const check = () => {
    pending = undefined
    try {
      const now = sessionWarningShown(document)
      if (now !== last) {
        last = now
        report(now)
      }
    } catch {
      // The page (or the extension) went away: stop watching.
      stop()
    }
  }
  // An Angular page restyles on every keystroke: coalesce into one check.
  const soon = () => {
    if (pending === undefined) pending = setTimeout(check, SESSION_CHECK_MS)
  }
  obs = new MutationObserver(soon)
  // The PR portal opens its dialog by restyling the host, not by adding it.
  obs.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  })
  poll = setInterval(soon, SESSION_POLL_MS)
  check()
  return stop
}
