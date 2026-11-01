import { SESSION_CHECK_MS, sessionWarningShown, watchSessionWarning } from '../src/session-warning'

const settle = () => new Promise((r) => setTimeout(r, SESSION_CHECK_MS + 20))

/** IRCC's session timeout dialog, as recorded live 2026-10-18. */
const WARNING = `<mat-dialog-container><h2>Session timeout warning</h2><p>Your session will expire automatically in 3 minutes 45 seconds.</p><button>Continue session</button></mat-dialog-container>`

describe('IRCC session timeout warning', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('is recognised by its own wording', () => {
    document.body.innerHTML = WARNING
    expect(sessionWarningShown()).toBe(true)
  })

  it('a row dialog is not the warning', () => {
    document.body.innerHTML = '<mat-dialog-container><h2>Children</h2><button>Save</button></mat-dialog-container>'
    expect(sessionWarningShown()).toBe(false)
  })

  it('a closed PR-portal modal (host display:none) is not the warning', () => {
    document.body.innerHTML =
      '<lib-modal style="display:none"><div role="dialog" class="modal"><h1>Session timeout warning</h1><p>Your session is about to expire in</p></div></lib-modal>'
    expect(sessionWarningShown()).toBe(false)
  })

  it('an open PR-portal modal is the warning', () => {
    document.body.innerHTML =
      '<lib-modal><div role="dialog" class="modal"><h1>Session timeout warning</h1><p>Your session is about to expire in</p></div></lib-modal>'
    expect(sessionWarningShown()).toBe(true)
  })

  it('reports a PR-portal modal opened by restyling its host', async () => {
    document.body.innerHTML =
      '<lib-modal style="display:none"><div role="dialog"><h1>Session timeout warning</h1></div></lib-modal>'
    const seen: boolean[] = []
    const stop = watchSessionWarning((s) => seen.push(s))
    ;(document.querySelector('lib-modal') as HTMLElement).style.display = ''
    await settle()
    stop()
    expect(seen).toEqual([true])
  })

  it('a visible dialog under a visibility:hidden ancestor still counts', () => {
    document.body.innerHTML =
      '<div style="visibility:hidden"><div role="dialog" style="visibility:visible"><h1>Session timeout warning</h1></div></div>'
    expect(sessionWarningShown()).toBe(true)
  })

  it('reports when it appears and when it goes away', async () => {
    const seen: boolean[] = []
    const stop = watchSessionWarning((s) => seen.push(s))
    document.body.innerHTML = WARNING
    await settle()
    document.body.innerHTML = ''
    await settle()
    stop()
    expect(seen).toEqual([true, false])
  })
})
