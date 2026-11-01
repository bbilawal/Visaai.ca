/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, flush, installChromeMock, type ChromeMock } from './chrome-mock'
import { optionKey, resolveTarget, screenText } from '../src/executor/resolve-target'
import { executeSelectByText, executeWrite } from '../src/executor/field-executor'
import { readField } from '../src/executor/readback'

/**
 * Review of PR #271 (eapp, the study permit questionnaire):
 *  S3 — the probe checks the reviewed OPTION is listed before anything on
 *       the screen is written; a day "05" is the reviewed "5".
 *  S2 — a screen already filled this launch (IRCC showed it again) is not
 *       filled again: the applicant's correction stays.
 *  S1 — at the end of the questionnaire the panel lists every answer that
 *       never filled.
 *  minor — option text and .wb-inv text are not "on the screen".
 */

const yesNo = (id: string, question: string, opts = '<option value="991">Yes</option><option value="997">No</option>') => `
  <label for="${id}">${question}</label>
  <select id="${id}"><option value="">Select…</option>${opts}</select>`

describe('S3 — option-scoped selectors', () => {
  it('found when the list has the option (by value / by text), no_option when not', () => {
    document.body.innerHTML = yesNo('answerlist[0]', 'Are you an exchange student?')
    const base = 'select[id^="answerlist["] >> label=/are you an exchange student/i'
    expect(resolveTarget(`${base} >> option=value:997`).status).toBe('found')
    expect(resolveTarget(`${base} >> option=text:No`).status).toBe('found')
    expect(resolveTarget(`${base} >> option=value:7225`).status).toBe('no_option')
    expect(resolveTarget(`${base} >> option=text:Maybe`).status).toBe('no_option')
    // The question is not on the screen: missing, not no_option.
    expect(resolveTarget('select >> label=/marital status/i >> option=value:997').status).toBe('missing')
    // The option must come last, once.
    expect(resolveTarget(`select >> option=value:1 >> label=/x/i`).status).toBe('invalid')
    expect(resolveTarget(`select >> option=value:1 >> option=value:2`).status).toBe('invalid')
  })

  it('a write whose option is not listed writes nothing (the select keeps its answer)', () => {
    document.body.innerHTML = yesNo('answerlist[0]', 'Are you an exchange student?')
    const sel = document.getElementById('answerlist[0]') as HTMLSelectElement
    sel.value = '991'
    const w = executeWrite('select >> label=/exchange student/i >> option=value:7225', '7225')
    expect(w).toMatchObject({ written: false, reason: 'selector_missing' })
    expect(sel.value).toBe('991')
  })

  it('day "05" on the portal is the reviewed "5" (write and readback)', async () => {
    const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))
      .map((d, i) => `<option value="${560 + i}">${d}</option>`)
      .join('')
    document.body.innerHTML = `<p>What is your date of birth?</p><select id="answerlist[9]">${days}</select>`
    const sel = 'select[id="answerlist[9]"] >> page=/what is your date of birth/i >> option=text:5'
    expect(resolveTarget(sel).status).toBe('found')
    const w = executeSelectByText(sel, '5')
    expect(w.written).toBe(true)
    expect((document.getElementById('answerlist[9]') as HTMLSelectElement).selectedOptions[0].text).toBe('05')
    await expect(readField(sel, w.node, 0, document, 'option', '5')).resolves.toMatchObject({ found: true, value: '5' })
    expect(optionKey(' 05 ')).toBe('5')
    expect(optionKey('01')).toBe(optionKey('1'))
    expect(optionKey('PAK (Pakistan)')).toBe('pak (pakistan)')
  })
})

describe('S3 — the content-script probe reports a missing option up front', () => {
  let mock: ChromeMock
  beforeEach(() => {
    mock = installChromeMock()
    jest.isolateModules(() => {
      require('../src/content')
    })
  })

  it('optionMissing on the control whose list lacks the answer; found on the rest', async () => {
    document.body.innerHTML =
      yesNo('answerlist[0]', 'Are you an exchange student?') +
      yesNo('answerlist[1]', 'Is work an essential component of your studies?', '<option value="991">Yes</option>')
    const ok = 'select >> label=/exchange student/i >> option=value:997'
    const bad = 'select >> label=/essential component/i >> option=value:997'
    const r = await deliver(mock.listeners.onMessage, { type: 'readback', selectors: [ok, bad] }, undefined, 500)
    expect(r).toEqual([
      expect.objectContaining({ selector: ok, found: true }),
      expect.objectContaining({ selector: bad, found: false, optionMissing: true }),
    ])
  })

  it('screen-questions lists the label of each visible control once', async () => {
    document.body.innerHTML =
      yesNo('answerlist[0]', 'Are you an exchange student?') + '<input type="hidden" id="h" /><button id="_next">Next</button>'
    const r = await deliver(mock.listeners.onMessage, { type: 'screen-questions' }, undefined, 500)
    expect(r).toEqual([
      'Are you an exchange student?',
      'controls:answerlist[0]',
      expect.stringMatching(/^text:[0-9a-f]{8}$/),
    ])
  })

  it('the signature tells apart screens with the same generic labels; an error box does not', async () => {
    const screen = (para: string, extra = '') => `
      <p>${para}</p>${extra}
      <label for="answerlist[0]">Yes or no</label>
      <select id="answerlist[0]" name="answerList[0].value"><option value="991">Yes</option><option value="997">No</option></select>`
    const sig = async () => deliver(mock.listeners.onMessage, { type: 'screen-questions' }, undefined, 500)
    document.body.innerHTML = screen('Are you an exchange student?')
    const a = await sig()
    document.body.innerHTML = screen('Is work an essential component of your studies?')
    const b = await sig()
    expect(a).not.toEqual(b)
    document.body.innerHTML = screen('Are you an exchange student?', '<div role="alert">Please answer this question.</div>')
    expect(await sig()).toEqual(a)
    // .wb-inv text does not change it.
    document.body.innerHTML = screen('Are you an exchange student?', '<span class="wb-inv">Required</span>')
    expect(await sig()).toEqual(a)
  })
})

describe('minor — screen text', () => {
  it('leaves out option text and screen-reader-only (.wb-inv) text', () => {
    document.body.innerHTML = `
      <span class="wb-inv">What is your date of birth?</span>
      <select><option>Are you giving someone access to your application?</option></select>
      <p>Shown text</p>`
    expect(screenText()).toBe('Shown text')
    expect(resolveTarget('select >> page=/giving someone access/i').status).toBe('missing')
  })
})

// ── side panel ──────────────────────────────────────────────────────────────
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

describe('side panel on the questionnaire', () => {
  const PROTOCOL = 2
  const HOST = 'https://onlineservices-servicesenligne.cic.gc.ca'
  const EAPP = `${HOST}/eapp/eapp`

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
    const screen = { q: ['What would you like to do in Canada?'] }
    mock.chrome.tabs.query = jest.fn(async () => [{ id: 7, active: true, url: url.v }])
    mock.chrome.tabs.get = jest.fn(async (id: number) => ({ id, url: url.v }))
    mock.chrome.tabs.sendMessage = jest.fn(async (_id: number, m: { type: string }) =>
      m.type === 'screen-questions' ? screen.q : undefined,
    ) as never
    mock.chrome.runtime.sendMessage = jest.fn(async (m: { type: string }) => (m.type === 'pf-bind-session' ? { ok: true } : undefined))
    jest.isolateModules(() => {
      require('../src/sidepanel')
    })
    await flush(10)
    return { sock: sockets[0], mock, url, screen }
  }
  const starts = (s: FakeSocket) => s.emit.mock.calls.filter(([ev]) => ev === 'portal-fill:start')
  async function runScreen(sock: FakeSocket, executionId: string, remaining: string[], filled: string[] = []) {
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId, stage: 'started' }, jest.fn())
    for (const label of filled) {
      // A verified field the panel counts as filled.
      await sock.handlers['portal-fill:field']?.(
        { protocol: PROTOCOL, kind: 'field_result', executionId, fieldKey: label, outcome: 'verified', label },
        jest.fn(),
      )
    }
    await sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId, stage: 'completed', remaining },
      jest.fn(),
    )
  }
  const reload = (mock: ReturnType<typeof installChromeMock>, url: string) => {
    for (const fn of mock.listeners.tabsUpdated) fn(7, { status: 'loading', url }, { id: 7, url })
    for (const fn of mock.listeners.tabsUpdated) fn(7, { status: 'complete' }, { id: 7, url })
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('S2: a screen already filled (same questions) is not filled again; a new one is', async () => {
    const { sock, mock, screen } = await load(EAPP)
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await flush(10)
    await runScreen(sock, 'e1', ['Marital status'])
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })

    // IRCC shows the same screen again (validation error / reload / Back).
    reload(mock, EAPP)
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(1)
    expect(document.getElementById('status')?.textContent).toMatch(/filled already/)

    // The next question: fills, with the approval that was kept.
    screen.q = ['What is your marital status?']
    reload(mock, EAPP)
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(2)
    expect(starts(sock)[1]).toEqual(['portal-fill:start', { readbackToken: 'renewed-1' }])
  })

  it('S1: at "Review your answers" every answer that never filled is listed', async () => {
    const { sock, mock, url } = await load(EAPP)
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await flush(10)
    await runScreen(sock, 'e1', ['Marital status', 'Exchange student'])
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    url.v = `${HOST}/eapp/comeToCanadaReviewPage`
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: url.v }, { id: 7, url: url.v })
    await flush(5)
    const next = document.getElementById('next')?.textContent ?? ''
    expect(next).toMatch(/Not filled/)
    expect(next).toMatch(/Marital status, Exchange student/)
    expect(document.getElementById('status')?.textContent).toMatch(/stops here/)
  })
})
