/**
 * A portal tab that was open when the extension was reloaded or updated has
 * lost its content script: every message to it fails with "Receiving end does
 * not exist", and reloading an IRCC form page lands on IRCC's error page
 * (dry run 2026-10-16). Put the script back — only when no copy answers, and
 * only into the bound portal tab (host permissions cover nothing else).
 */
export async function sendToPortalTab<T>(tabId: number, message: unknown): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/Receiving end does not exist|Could not establish connection/i.test(msg)) throw err
    if (!chrome.scripting?.executeScript) throw err
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  }
}

