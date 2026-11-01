/// <reference types="chrome" />
import { sendToPortalTab } from '../src/portal-messaging'

/**
 * Dry run 2026-10-16: after the extension was reloaded, the open IRCC tab had
 * no content script ("Receiving end does not exist") and nothing was filled.
 */
function chromeWith(send: jest.Mock, exec?: jest.Mock) {
  ;(globalThis as any).chrome = {
    tabs: { sendMessage: send },
    ...(exec ? { scripting: { executeScript: exec } } : {}),
  }
}

describe('sendToPortalTab', () => {
  it('passes through when the content script answers', async () => {
    const send = jest.fn().mockResolvedValue('ok')
    const exec = jest.fn()
    chromeWith(send, exec)
    await expect(sendToPortalTab(7, { type: 'readback' })).resolves.toBe('ok')
    expect(exec).not.toHaveBeenCalled()
  })

  it('re-injects the content script once when the tab lost it, then retries', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce('ok')
    const exec = jest.fn().mockResolvedValue([])
    chromeWith(send, exec)
    await expect(sendToPortalTab(7, { type: 'readback' })).resolves.toBe('ok')
    expect(exec).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['content.js'] })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not inject on any other failure', async () => {
    const send = jest.fn().mockRejectedValue(new Error('pf-timeout'))
    const exec = jest.fn()
    chromeWith(send, exec)
    await expect(sendToPortalTab(7, {})).rejects.toThrow('pf-timeout')
    expect(exec).not.toHaveBeenCalled()
  })
})
