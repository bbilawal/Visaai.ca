/// <reference types="chrome" />
declare function require(id: string): unknown
import { flush, installChromeMock } from './chrome-mock'

/**
 * Dry run 2026-10-18: on the eTA form the panel showed the visitor-visa
 * portal's tips ("IRCC signs you out… sign in… Save and continue"). The eTA
 * form has no account, no sign-in and no "Save and continue".
 */

jest.mock('socket.io-client', () => ({ io: () => ({ on: () => undefined, emit: jest.fn(), disconnect: jest.fn() }) }))

const ETA = 'https://eta.onlineservices-servicesenligne.apps.cic.gc.ca/eta/welcome?lang=en#/application'
const TRV = 'https://portal-portail.apps.cic.gc.ca/en/application/purpose'

async function load(activeUrl: string) {
  document.body.innerHTML = `
    <div id="ircc-tips"></div><div id="eta-tips" style="display:none"></div>
    <div id="connect"><input id="apiUrl" /><input id="token" /><button id="connectBtn"></button></div>
    <div id="session"><div id="steps"></div></div>
    <div id="status"></div><div id="error"></div>`
  const mock = installChromeMock({})
  mock.chrome.tabs.query = jest.fn(async () => [{ id: 7, active: true, url: activeUrl }])
  jest.isolateModules(() => {
    require('../src/sidepanel')
  })
  await flush(10)
}

const shown = (id: string) => document.getElementById(id)!.style.display !== 'none'

describe('side panel tips follow the portal in front', () => {
  it('shows the eTA tips, not the visitor-visa ones, on the eTA form', async () => {
    await load(ETA)
    expect(shown('eta-tips')).toBe(true)
    expect(shown('ircc-tips')).toBe(false)
  })

  it('keeps the IRCC account portal tips on the visitor-visa portal', async () => {
    await load(TRV)
    expect(shown('eta-tips')).toBe(false)
    expect(shown('ircc-tips')).toBe(true)
  })
})
