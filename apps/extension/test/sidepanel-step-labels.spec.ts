/// <reference types="chrome" />
declare function require(id: string): unknown
import { flush, installChromeMock } from './chrome-mock'

/**
 * Dry run 2026-10-17: the panel listed each step by its key
 * ("ircc_upload_passport"). It now shows the label the applicant confirmed on
 * VisaAI, and the key only when an older server sends no label.
 */
describe('side panel step labels', () => {
  type Handler = (...a: any[]) => unknown
  const sockets: { handlers: Record<string, Handler>; emit: jest.Mock }[] = []
  jest.mock('socket.io-client', () => ({
    io: () => {
      const sock = {
        handlers: {} as Record<string, Handler>,
        emit: jest.fn(),
        on(ev: string, h: Handler) {
          this.handlers[ev] = h
        },
        disconnect: jest.fn(),
        connected: true,
      }
      sockets.push(sock)
      return sock
    },
  }))

  it('shows the confirmed label, falling back to the key', async () => {
    document.body.innerHTML = `
      <div id="connect"><input id="apiUrl" /><input id="token" /><button id="connectBtn"></button></div>
      <div id="session"><div id="steps"></div></div><div id="next"></div>
      <div id="status"></div><div id="error"></div>`
    const mock = installChromeMock({
      pendingSession: { token: 't', apiUrl: 'https://api.visaai.co', readbackToken: 'rb', receivedAt: Date.now() },
    })
    const url = 'https://tr-rt.apps.cic.gc.ca/bio-data?lang=en'
    mock.chrome.tabs.query = jest.fn(async () => [{ id: 7, active: true, url }])
    mock.chrome.tabs.get = jest.fn(async (id: number) => ({ id, url }))
    mock.chrome.runtime.sendMessage = jest.fn(async (m: { type: string; command?: { executionId: string; fieldKey: string } }) => {
      if (m.type === 'pf-bind-session') return { ok: true }
      if (m.type === 'pf-execute-field')
        return { protocol: 2, kind: 'field_result', executionId: m.command!.executionId, fieldKey: m.command!.fieldKey, outcome: 'verified', selectorFound: true }
      return undefined
    })
    jest.isolateModules(() => {
      require('../src/sidepanel')
    })
    await flush(10)
    const sock = sockets[sockets.length - 1]
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await sock.handlers['portal-fill:stage']({ protocol: 2, kind: 'stage', executionId: 'e1', stage: 'started' }, jest.fn())
    const write = (fieldKey: string, label?: string) =>
      sock.handlers['portal-fill:write'](
        { protocol: 2, kind: 'write', executionId: 'e1', fieldKey, selector: '#x', mappedValue: 'v', expectedValueHash: 'h', ...(label ? { label } : {}) },
        jest.fn(),
      )
    await write('ircc_passport_number', 'Passport number')
    await write('ircc_family_name')
    const steps = Array.from(document.querySelectorAll('#steps .step')).map((e) => e.textContent)
    expect(steps[0]).toContain('Passport number')
    expect(steps[0]).not.toContain('ircc_passport_number')
    expect(steps[1]).toContain('ircc_family_name')
  })
})
