/**
 * The registry operations page, rendered.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT
 *
 * The access path was verified against production directly: GET
 * /admin/registry-ops returns 401 unauthenticated, /registry 307s to /login, and
 * the anonymous response carries no registry data. That is not what this covers.
 *
 * This covers the half that a 401 says nothing about — what an authorised admin
 * actually SEES. Specifically the two ways this page could quietly undo the work
 * behind it:
 *
 *   1. Rendering an unattributable change as though it had been characterised.
 *      Those records say "something changed" and cannot say what (B-29). A
 *      reviewer shown a confident-looking summary with that fact smoothed away
 *      is exactly where they were before the bug was found.
 *
 *   2. Rendering zeros when the registry could not be read. A registry
 *      operations screen showing "0 requirements without provenance" because the
 *      API was down is the same class of lie this page exists to end.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Named differently from the export it replaces: sharing the name makes the
// factory's reference ambiguous to read, and it cost a confusing debug session.
const mockOps = vi.fn()
vi.mock('@/lib/api/admin', () => ({ getRegistryOps: () => mockOps() }))

const { default: RegistryOpsPage } = await import('./page')

const BASE = {
  generatedAt: '2026-08-24T12:00:00.000Z',
  registry: {
    countriesTotal: 196,
    countriesPublishable: 13,
    countriesBaselineOnly: 183,
    visaTypesActive: 79,
    requirementsActive: 1023,
    publishablePages: 58,
  },
  provenance: {
    requirementsWithoutProvenance: 0,
    activeSourceVersions: 154,
    versionsRetainingText: 2,
  },
  sources: { total: 235, blocked: 74, staleBeyondSla: 0 },
  lastRun: {
    startedAt: '2026-08-24T11:00:00Z',
    sourcesChecked: 235,
    ok: 156,
    changed: 0,
    blocked: 74,
    unavailable: 4,
    parseErrors: 0,
    clientRendered: 1,
  },
  reviews: { awaiting: 125, unattributable: 1, items: [] as unknown[] },
}

const render = async () => renderToStaticMarkup(await RegistryOpsPage())


describe('registry operations page', () => {
  it('says it could not load rather than rendering zeros', async () => {
    // Throw INSIDE the implementation. mockRejectedValue builds the rejected
    // promise at setup time, and the runner flags it as unhandled before the
    // page ever awaits it — which fails the test for a reason that has nothing
    // to do with the page.
    mockOps.mockImplementation(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const html = await render()
    expect(html).toContain('not zero')
    expect(html).toContain('connect ECONNREFUSED')
    // The figures must not appear at all — a reader skimming numbers would
    // otherwise take an outage for a healthy registry.
    expect(html).not.toContain('Awaiting review')
  })

  it('shows an uncharacterised change as unknown, not as a summary', async () => {
    mockOps.mockResolvedValue({
      ...BASE,
      reviews: {
        awaiting: 1,
        unattributable: 1,
        items: [
          {
            id: 'c1',
            sourceUrl: 'https://example.gov/x',
            authority: 'Example',
            country: 'Exampleland',
            classification: 'material',
            escalationReasons: [],
            summary: 'Content changed, but the previous text was not retained',
            addedTotal: 0,
            removedTotal: 0,
            unattributable: true,
            detectedAt: '2026-08-24T10:00:00Z',
          },
        ],
      },
    })
    const html = await render()
    expect(html).toContain('Unknown')
    expect(html).toContain('previous text not retained')
    // No fabricated +/- counts against a diff that was never computed.
    expect(html).not.toContain('+0 / −0')
  })

  it('shows a real change with its counts and reasons', async () => {
    mockOps.mockResolvedValue({
      ...BASE,
      reviews: {
        awaiting: 1,
        unattributable: 0,
        items: [
          {
            id: 'c2',
            sourceUrl: 'https://example.gov/y',
            authority: 'Example',
            country: 'Exampleland',
            classification: 'material',
            escalationReasons: ['a fee changed'],
            summary: '3 added, 2 removed',
            addedTotal: 3,
            removedTotal: 2,
            unattributable: false,
            detectedAt: '2026-08-24T10:00:00Z',
          },
        ],
      },
    })
    const html = await render()
    expect(html).toContain('a fee changed')
    expect(html).toContain('+3')
    expect(html).toContain('2')
  })

  it('renders the counts an operator came for', async () => {
    mockOps.mockResolvedValue(BASE)
    const html = await render()
    expect(html).toContain('Awaiting review')
    expect(html).toContain('125')
    expect(html).toContain('Without provenance')
    expect(html).toContain('Client-rendered')
  })

  it('reports no run rather than an empty one', async () => {
    mockOps.mockResolvedValue({ ...BASE, lastRun: null })
    const html = await render()
    expect(html).toContain('No run recorded')
  })
})
