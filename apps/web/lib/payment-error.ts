import { getSession } from '@/lib/supabase/client'

/**
 * Handle a fetch Response on a paid action (download / portal auto-fill). If
 * the API returns HTTP 402, the one-time form fee for this visa hasn't been
 * paid: open a Stripe checkout for it and redirect. Returns true so the caller
 * can bail out of its own success path.
 */
export async function handlePaymentRequired(
  res: Response,
  applicationId: string,
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void,
): Promise<boolean> {
  if (res.status !== 402) return false

  toast('Unlock downloads & auto-submit — redirecting to checkout…', 'info')

  try {
    const { data: { session } } = await getSession()
    if (!session) throw new Error('Not authenticated')

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
    const base = window.location.origin
    const checkoutRes = await fetch(`${apiUrl}/billing/checkout/prefill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        applicationId,
        successUrl: `${base}/prefill/${applicationId}?paid=1`,
        cancelUrl: `${base}/prefill/${applicationId}`,
      }),
    })
    if (!checkoutRes.ok) throw new Error('Failed to start checkout')
    const { url } = await checkoutRes.json() as { url: string }
    window.location.assign(url)
  } catch {
    toast('Could not start checkout. Please try again.', 'error')
  }
  return true
}
