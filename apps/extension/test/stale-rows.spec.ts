/// <reference types="chrome" />
declare function require(id: string): unknown
import { staleRows } from '../src/executor/stale-rows'
import { flush, installChromeMock } from './chrome-mock'

/**
 * Dry run 2026-10-16: Mian Talha was removed in VisaAI, but his row from an
 * earlier entry stayed on IRCC's children table and nobody was told.
 */
const IRCC_ROWS = [
  'Family name Given name Date of birth Relationship Country of birth Sort ascending',
  'Bilawal Mian Muhammad 1989-10-14 Son Pakistan edit Edit delete_forever Delete',
  'Talha Mian 2000-**-** Son Pakistan edit Edit delete_forever Delete',
  'Sajawal Mian Muhammad 1989-10-14 Son Pakistan edit Edit delete_forever Delete',
]
const REVIEWED = [
  'Mian Muhammad Bilawal (Son, born 1989-10-14)',
  'Mian Muhammad Sajawal (Son, born 1989-10-14)',
]

describe('staleRows', () => {
  it('lists the row that matches no reviewed row, without the action words', () => {
    expect(staleRows(IRCC_ROWS, REVIEWED)).toEqual(['Talha Mian 2000-**-** Son Pakistan'])
  })
  it('reports nothing when every data row is reviewed', () => {
    expect(staleRows(IRCC_ROWS.filter((r) => !/Talha/.test(r)), REVIEWED)).toEqual([])
  })
  it('reports nothing for a page the assistant fills no rows on', () => {
    expect(staleRows(IRCC_ROWS, [])).toEqual([])
  })
})

describe('side panel shows stale rows after a page is filled', () => {
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

  it('names the leftover row in the panel and never deletes it', async () => {
    document.body.innerHTML = `
      <div id="connect"><input id="apiUrl" /><input id="token" /><button id="connectBtn"></button></div>
      <div id="session"><div id="steps"></div></div><div id="next"></div><div id="stale" style="display:none"></div>
      <div id="status"></div><div id="error"></div>`
    const mock = installChromeMock({
      pendingSession: { token: 't', apiUrl: 'https://api.visaai.co', readbackToken: 'rb', receivedAt: Date.now() },
    })
    const url = 'https://tr-rt.apps.cic.gc.ca/family-info-children?lang=en'
    mock.chrome.tabs.query = jest.fn(async () => [{ id: 7, active: true, url }])
    mock.chrome.tabs.get = jest.fn(async (id: number) => ({ id, url }))
    const sent: string[] = []
    mock.chrome.runtime.sendMessage = jest.fn(async (m: { type: string; command?: { executionId: string; fieldKey: string } }) => {
      sent.push(m.type)
      if (m.type === 'pf-bind-session') return { ok: true }
      if (m.type === 'pf-page-rows') return IRCC_ROWS
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
    for (const summary of REVIEWED) {
      await sock.handlers['portal-fill:write'](
        { protocol: 2, kind: 'write', executionId: 'e1', fieldKey: 'row', selector: 'main button[id*="add"]', mappedValue: summary, expectedValueHash: 'h', op: 'dialog_open' },
        jest.fn(),
      )
    }
    await sock.handlers['portal-fill:stage']({ protocol: 2, kind: 'stage', executionId: 'e1', stage: 'completed' }, jest.fn())
    const stale = document.getElementById('stale')!
    expect(stale.style.display).toBe('block')
    expect(stale.textContent).toMatch(/Talha Mian 2000-\*\*-\*\* Son Pakistan/)
    expect(stale.textContent).not.toMatch(/Sajawal|Bilawal/)
    expect(sent).not.toContain('pf-delete')
  })
})
