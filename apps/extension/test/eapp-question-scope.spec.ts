/// <reference types="chrome" />
declare function require(id: string): unknown
import { flush, installChromeMock } from './chrome-mock'
import { parseScopedSelector, questionText, resolveTarget, screenText } from '../src/executor/resolve-target'
import { executeSelectByText, executeWrite } from '../src/executor/field-executor'
import { readField } from '../src/executor/readback'
import { classifyPortalPage, isEappEditUrl, isServerPagedUrl } from '../src/portal-page'

/**
 * IRCC's secure-account questionnaire (study permit, live 2026-10-20): every
 * screen is /eapp/eapp and `select#answerlist[0]` is a different question on
 * each. The server names a control by its CSS AND its question
 * (`<css> >> label=/re/i`, `<css> >> page=/re/i`); a control whose question is
 * not on the screen must resolve to nothing.
 */

const ANY = 'select[id^="answerlist["]'
const EXCHANGE = `${ANY} >> label=/are you an exchange student/i`
const MARITAL = `${ANY} >> label=/what is your marital status/i`

const yesNo = (id: string, question: string) => `
  <label for="${id}">${question}</label>
  <select id="${id}" name="answerList[${id.slice(11, -1)}].value">
    <option value="">Select…</option><option value="991">Yes</option><option value="997">No</option>
  </select>`

describe('question-scoped selectors', () => {
  it('finds the control by its label; another question with the same id is not it', () => {
    document.body.innerHTML = yesNo('answerlist[0]', 'Are you an exchange student?')
    const r = resolveTarget(EXCHANGE)
    expect(r.status).toBe('found')
    expect(resolveTarget(MARITAL).status).toBe('missing')

    // The next screen, same URL, same id, another question.
    document.body.innerHTML = yesNo('answerlist[0]', 'What is your marital status?')
    expect(resolveTarget(EXCHANGE).status).toBe('missing')
    expect(resolveTarget(MARITAL).status).toBe('found')
  })

  it('picks the right select among several on one screen', () => {
    document.body.innerHTML =
      yesNo('answerlist[0]', 'Are you an exchange student?') +
      yesNo('answerlist[1]', 'Is work an essential component of your studies?')
    const r = resolveTarget(`${ANY} >> label=/is work an essential component/i`)
    expect(r.status === 'found' && r.el.id).toBe('answerlist[1]')
    // Plain CSS still means "exactly one": two selects are ambiguous.
    expect(resolveTarget(ANY).status).toBe('ambiguous')
  })

  it('two controls with matching labels are ambiguous, never the first', () => {
    document.body.innerHTML = yesNo('answerlist[0]', 'Are you an exchange student?') + yesNo('answerlist[1]', 'Are you an exchange student?')
    expect(resolveTarget(EXCHANGE).status).toBe('ambiguous')
  })

  it('a page scope needs the text on the screen (date of birth, radio answers)', () => {
    document.body.innerHTML = `
      <p>What is your date of birth?</p>
      <select id="answerlist[7]"><option value="974">1991</option></select>`
    const sel = 'select[id="answerlist[7]"] >> page=/what is your date of birth/i'
    expect(resolveTarget(sel).status).toBe('found')
    document.body.innerHTML = `<select id="answerlist[7]"><option>1991</option></select>`
    expect(resolveTarget(sel).status).toBe('missing')
    // Hidden text does not count as on the screen.
    document.body.innerHTML = `
      <div style="display:none">What is your date of birth?</div><script>/* What is your date of birth? */</script>
      <select id="answerlist[7]"><option>1991</option></select>`
    expect(resolveTarget(sel).status).toBe('missing')
    expect(screenText()).not.toMatch(/date of birth/)
  })

  it('the radio question: the answer input on the screen that asks it', () => {
    const radios = (q: string) => `
      <fieldset><legend>${q}</legend>
      ${[7340, 7341, 7342, 7343]
        .map((v, k) => `<input type="radio" id="answerlist[0]-radiobutton${k}" name="answerList[0].value" value="${v}" />`)
        .join('')}
      </fieldset>`
    const no = 'input[type="radio"][name="answerList[0].value"][value="7343"] >> page=/are you giving someone access to your application/i'
    document.body.innerHTML = radios('Are you giving someone access to your application?')
    const r = resolveTarget(no)
    expect(r.status === 'found' && (r.el as HTMLInputElement).value).toBe('7343')
    expect(questionText(r.status === 'found' ? r.el : document.body)).toMatch(/giving someone access/)
    document.body.innerHTML = radios('Something else?')
    expect(resolveTarget(no).status).toBe('missing')
  })

  it('label sources: label[for], wrapping label, aria-label, aria-labelledby, legend', () => {
    document.body.innerHTML = `
      <label>Wrapped question <select id="a"></select></label>
      <select id="b" aria-label="Aria question"></select>
      <span id="q">Referenced question</span><select id="c" aria-labelledby="q"></select>`
    expect(resolveTarget('select >> label=/wrapped question/i').status).toBe('found')
    expect(resolveTarget('select >> label=/aria question/i').status).toBe('found')
    expect(resolveTarget('select >> label=/referenced question/i').status).toBe('found')
  })

  it('a scope that does not parse is invalid, never ignored', () => {
    document.body.innerHTML = yesNo('answerlist[0]', 'Are you an exchange student?')
    for (const bad of [
      `${ANY} >> label=are you`,
      `${ANY} >> label=/(/i`,
      `${ANY} >> label=/x/g`,
      `${ANY} >> other=/x/i`,
      `${ANY} >> label=/a/i >> label=/b/i`,
      ` >> label=/x/i`,
    ]) {
      expect(parseScopedSelector(bad)).toBeNull()
      expect(resolveTarget(bad).status).toBe('invalid')
    }
    // Plain CSS is untouched (TRV / eTA selectors).
    expect(parseScopedSelector('#a > b')).toEqual({ css: '#a > b' })
  })

  it('writes and reads back through the scope; a screen without it writes nothing', async () => {
    document.body.innerHTML = yesNo('answerlist[0]', 'Are you an exchange student?')
    const w = executeWrite(EXCHANGE, '997')
    expect(w.written).toBe(true)
    expect((document.getElementById('answerlist[0]') as HTMLSelectElement).value).toBe('997')
    await expect(readField(EXCHANGE, w.node, 0)).resolves.toMatchObject({ found: true, sameNode: true, value: '997' })

    document.body.innerHTML = yesNo('answerlist[0]', 'What is your marital status?')
    expect(executeWrite(EXCHANGE, '997')).toMatchObject({ written: false, reason: 'selector_missing' })
    expect((document.getElementById('answerlist[0]') as HTMLSelectElement).value).toBe('')
  })

  it('choose by option text through a scope (passport code)', () => {
    document.body.innerHTML = `
      <label for="answerlist[3]">Select the code that matches the one on your passport.</label>
      <select id="answerlist[3]"><option value="">Select…</option><option value="13410">PAK (Pakistan)</option></select>`
    const w = executeSelectByText('select[id="answerlist[3]"] >> label=/select the code that matches/i', 'PAK (Pakistan)')
    expect(w.written).toBe(true)
    expect((document.getElementById('answerlist[3]') as HTMLSelectElement).value).toBe('13410')
  })
})

describe('the questionnaire pages', () => {
  const HOST = 'https://onlineservices-servicesenligne.cic.gc.ca'
  it('/eapp/eapp is server paged; nothing else is', () => {
    expect(isServerPagedUrl(`${HOST}/eapp/eapp`)).toBe(true)
    expect(isServerPagedUrl(`${HOST}/eapp/comeToCanadaReviewPage`)).toBe(false)
    expect(isServerPagedUrl('https://tr-rt.apps.cic.gc.ca/purpose')).toBe(false)
    expect(isServerPagedUrl('https://eta.onlineservices-servicesenligne.apps.cic.gc.ca/eta/welcome')).toBe(false)
  })

  it('the assistant stops at the review page and everything after it', () => {
    for (const p of ['comeToCanadaReviewPage', 'comeToCanadaInstructions', 'documentsToSubmit'])
      expect(classifyPortalPage(`${HOST}/eapp/${p}`).kind).toBe('review')
    expect(classifyPortalPage(`${HOST}/eapp/eapp`).kind).toBe('form')
    expect(classifyPortalPage(`${HOST}/eapp/comeToCanadaReviewPage`).message).toMatch(/stops here/)
  })

  it('the answer list "Cancel" returns to is a stop page too', () => {
    expect(classifyPortalPage(`${HOST}/eapp/previousAnswers`).kind).toBe('review')
  })

  it('a "Modify my Answers" screen is an edit of the server-paged form', () => {
    const edit = `${HOST}/eapp/eapp?modifyCaller=PAQ&paqReturnToEappValue=2167`
    expect(isServerPagedUrl(edit)).toBe(true)
    expect(isEappEditUrl(edit)).toBe(true)
    expect(isEappEditUrl(`${HOST}/eapp/eapp`)).toBe(false)
    expect(isEappEditUrl(`${HOST}/eapp/previousAnswers?modifyCaller=PAQ`)).toBe(false)
  })
})

// ── the side panel follows each screen of the questionnaire ─────────────────
type Handler = (...a: any[]) => unknown
interface FakeSocket {
  handlers: Record<string, Handler>
  emit: jest.Mock
  on: (ev: string, h: Handler) => void
  disconnect: jest.Mock
  connected: boolean
}
let sockets: FakeSocket[] = []
jest.mock('socket.io-client', () => ({
  io: () => {
    const sock: FakeSocket = {
      handlers: {},
      emit: jest.fn(),
      on(ev, h) {
        this.handlers[ev] = h
      },
      disconnect: jest.fn(),
      connected: true,
    }
    sockets.push(sock)
    return sock
  },
}))

describe('side panel on a server-paged form', () => {
  const PROTOCOL = 2
  const EAPP = 'https://onlineservices-servicesenligne.cic.gc.ca/eapp/eapp'
  const TRRT = 'https://tr-rt.apps.cic.gc.ca/purpose?lang=en'

  async function load(start: string) {
    sockets = []
    document.body.innerHTML = `
      <div id="connect"><input id="apiUrl" /><input id="token" /><button id="connectBtn"></button></div>
      <div id="session"><div id="steps"></div></div><div id="next"></div><button id="fillAgain" style="display:none"></button>
      <div id="status"></div><div id="error"></div><div id="uploads"></div><div id="sessionWarning" style="display:none"></div>`
    const mock = installChromeMock({
      pendingSession: { token: 'connect-token', apiUrl: 'https://api.visaai.co', readbackToken: 'approval', receivedAt: Date.now() },
    })
    const url = { v: start }
    mock.chrome.tabs.query = jest.fn(async () => [{ id: 7, active: true, url: url.v }])
    mock.chrome.tabs.get = jest.fn(async (id: number) => ({ id, url: url.v }))
    mock.chrome.runtime.sendMessage = jest.fn(async (m: { type: string }) => (m.type === 'pf-bind-session' ? { ok: true } : undefined))
    jest.isolateModules(() => {
      require('../src/sidepanel')
    })
    await flush(10)
    return { sock: sockets[0], mock, url }
  }
  const starts = (s: FakeSocket) => s.emit.mock.calls.filter(([ev]) => ev === 'portal-fill:start')
  async function runScreen(sock: FakeSocket, executionId: string) {
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId, stage: 'started' }, jest.fn())
    await sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId, stage: 'completed', remaining: ['Marital status'] },
      jest.fn(),
    )
  }
  const reload = (mock: ReturnType<typeof installChromeMock>, url: string) => {
    for (const fn of mock.listeners.tabsUpdated) fn(7, { status: 'loading' }, { id: 7, url })
    for (const fn of mock.listeners.tabsUpdated) fn(7, { status: 'complete' }, { id: 7, url })
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('the next screen (same URL, new load) fills with the renewed approval', async () => {
    const { sock, mock } = await load(EAPP)
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runScreen(sock, 'e1')
    expect(document.getElementById('next')?.textContent).toMatch(/press Next on IRCC/)
    expect((document.getElementById('fillAgain') as HTMLElement).style.display).toBe('none')
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    await jest.advanceTimersByTimeAsync(3000)
    // No new load yet: nothing starts.
    expect(starts(sock)).toHaveLength(1)

    reload(mock, EAPP)
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(2)
    expect(starts(sock)[1]).toEqual(['portal-fill:start', { readbackToken: 'renewed-1' }])

    // A second "complete" for the same load does not start it again.
    await runScreen(sock, 'e2')
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-2' })
    for (const fn of mock.listeners.tabsUpdated) fn(7, { status: 'complete' }, { id: 7, url: EAPP })
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(2)
  })

  it('a "Modify my Answers" screen names its own button, "Update information"', async () => {
    const { sock } = await load(`${EAPP}?modifyCaller=PAQ&paqReturnToEappValue=2167`)
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runScreen(sock, 'e1')
    expect(document.getElementById('next')?.textContent).toMatch(/press Update information on IRCC/)
    sock.handlers['automation:error']({ message: 'Nothing to fill on this screen: answer it yourself and press Next. Keep this panel open.' })
    expect(document.getElementById('status')?.textContent).toMatch(/press Update information\./)
  })

  it('tr-rt keeps its rule: a reload of the same page is not refilled', async () => {
    const { sock, mock } = await load(TRRT)
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' }, jest.fn())
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'completed' }, jest.fn())
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    reload(mock, TRRT)
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(1)
  })
})
