import { getRegistryOps, type RegistryOps } from '@/lib/api/admin'

/**
 * Visa registry operations (spec §74).
 *
 * The safe change-promotion workflow is draft → review → active: a material
 * change files a new version WITHOUT activating it, and the previous version
 * keeps serving until a person reviews it. That design was implemented, tested
 * and running — with no screen anywhere in the product for the person it
 * depends on. 125 changes sat in production flagged for review, reachable only
 * by connecting to the database directly, which is exactly what §74's closing
 * line exists to prevent.
 *
 * Read-only on purpose. Promotion still goes through a migration that asserts
 * its own claims before committing; a one-click activate here would turn the
 * queue back into decoration.
 */

const HAIRLINE = '1px solid var(--color-hairline-2, rgba(0,0,0,.15))'

function Stat({
  label,
  value,
  bad,
  note,
}: {
  label: string
  value: number | string
  bad?: boolean
  note?: string
}) {
  return (
    <div style={{ border: HAIRLINE, borderRadius: 6, padding: '10px 12px', minWidth: 130 }}>
      <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>{label}</div>
      <div
        className="mono"
        style={{
          fontSize: '1.3rem',
          color: bad ? 'var(--color-rose, #b53030)' : undefined,
        }}
      >
        {value}
      </div>
      {note ? <div style={{ fontSize: '0.65rem', opacity: 0.6 }}>{note}</div> : null}
    </div>
  )
}

export default async function RegistryOpsPage() {
  let ops: RegistryOps | null = null
  let error: string | null = null
  try {
    ops = await getRegistryOps()
  } catch (e) {
    // Degrade to a stated failure rather than an empty page. A registry
    // operations screen that renders zeros when it could not load is the same
    // class of lie this page exists to stop.
    error = e instanceof Error ? e.message : String(e)
  }

  if (!ops) {
    return (
      <div>
        <h1 className="type-h3" style={{ marginBottom: 12 }}>Registry operations</h1>
        <p style={{ color: 'var(--color-rose, #b53030)' }}>
          Could not load registry state: {error ?? 'unknown error'}. These figures are
          not zero — they are unknown.
        </p>
      </div>
    )
  }

  const { registry, provenance, sources, lastRun, reviews } = ops

  return (
    <div>
      <h1 className="type-h3" style={{ marginBottom: 4 }}>Registry operations</h1>
      <p style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: 16 }}>
        Read-only. Promoting a reviewed change still goes through a migration that
        asserts its own claims before it commits.
      </p>

      <h2 className="type-h5" style={{ marginBottom: 8 }}>Waiting for a reviewer</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <Stat label="Awaiting review" value={reviews.awaiting} bad={reviews.awaiting > 0} />
        <Stat
          label="Uncharacterised"
          value={reviews.unattributable}
          bad={reviews.unattributable > 0}
          note="diff could not be computed"
        />
      </div>
      {reviews.unattributable > 0 ? (
        <p style={{ fontSize: '0.72rem', opacity: 0.8, marginBottom: 12 }}>
          An uncharacterised change means the content hash moved but the previous
          version’s text was not retained, so <em>what</em> changed is unknown. Compare
          against the authority’s page directly. Versions filed from 2026-08-24 onward
          retain their text, so this clears itself one change at a time.
        </p>
      ) : null}

      {reviews.items.length === 0 ? (
        <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: 20 }}>
          Nothing is waiting.
        </p>
      ) : (
        <table
          style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}
          className="mono"
        >
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: HAIRLINE }}>
              <th style={{ padding: '8px 6px' }}>Detected</th>
              <th style={{ padding: '8px 6px' }}>Country</th>
              <th style={{ padding: '8px 6px' }}>Source</th>
              <th style={{ padding: '8px 6px' }}>Class</th>
              <th style={{ padding: '8px 6px' }}>+ / −</th>
              <th style={{ padding: '8px 6px' }}>What changed</th>
            </tr>
          </thead>
          <tbody>
            {reviews.items.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid rgba(0,0,0,.08)' }}>
                <td style={{ padding: '8px 6px', fontSize: '0.7rem' }}>
                  {c.detectedAt?.slice(0, 16).replace('T', ' ') ?? '—'}
                </td>
                <td style={{ padding: '8px 6px', fontSize: '0.72rem' }}>{c.country ?? '—'}</td>
                <td style={{ padding: '8px 6px', fontSize: '0.68rem', maxWidth: 260 }}>
                  <a href={c.sourceUrl} target="_blank" rel="noreferrer noopener">
                    {c.sourceUrl}
                  </a>
                </td>
                <td style={{ padding: '8px 6px', fontSize: '0.72rem' }}>{c.classification}</td>
                <td style={{ padding: '8px 6px', fontSize: '0.72rem' }}>
                  {c.unattributable ? '—' : `+${c.addedTotal} / −${c.removedTotal}`}
                </td>
                <td style={{ padding: '8px 6px', fontSize: '0.7rem', maxWidth: 420 }}>
                  {c.unattributable ? (
                    <em>Unknown — previous text not retained. Check the source page.</em>
                  ) : (
                    <>
                      {c.escalationReasons.length > 0
                        ? c.escalationReasons.join('; ')
                        : c.summary.slice(0, 160)}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="type-h5" style={{ marginBottom: 8 }}>Last sync run</h2>
      {lastRun ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          <Stat label="Started" value={lastRun.startedAt?.slice(0, 16).replace('T', ' ') ?? '—'} />
          <Stat label="Checked" value={lastRun.sourcesChecked} />
          <Stat label="OK" value={lastRun.ok} />
          <Stat label="Changed" value={lastRun.changed} />
          <Stat label="Blocked" value={lastRun.blocked} note="authority refuses us" />
          <Stat label="Unavailable" value={lastRun.unavailable} />
          <Stat
            label="Parse errors"
            value={lastRun.parseErrors}
            bad={lastRun.parseErrors > 0}
            note="our bug"
          />
          <Stat
            label="Client-rendered"
            value={lastRun.clientRendered}
            note="no text to read"
          />
        </div>
      ) : (
        <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: 24 }}>No run recorded.</p>
      )}

      <h2 className="type-h5" style={{ marginBottom: 8 }}>Registry</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        <Stat label="Countries" value={registry.countriesTotal} />
        <Stat label="Publishable" value={registry.countriesPublishable} />
        <Stat
          label="Not researched"
          value={registry.countriesBaselineOnly}
          note="publish nothing"
        />
        <Stat label="Visa types" value={registry.visaTypesActive} />
        <Stat label="Requirements" value={registry.requirementsActive} />
        <Stat label="Published pages" value={registry.publishablePages} />
      </div>

      <h2 className="type-h5" style={{ marginBottom: 8 }}>Provenance and sources</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Stat
          label="Without provenance"
          value={provenance.requirementsWithoutProvenance}
          bad={provenance.requirementsWithoutProvenance > 0}
          note="must be zero"
        />
        <Stat label="Active versions" value={provenance.activeSourceVersions} />
        <Stat
          label="Retaining text"
          value={provenance.versionsRetainingText}
          note="diffable next time"
        />
        <Stat label="Sources" value={sources.total} />
        <Stat label="Blocked" value={sources.blocked} note="3+ consecutive failures" />
        <Stat
          label="Stale past SLA"
          value={sources.staleBeyondSla}
          bad={sources.staleBeyondSla > 0}
        />
      </div>

      <p style={{ fontSize: '0.68rem', opacity: 0.6, marginTop: 20 }}>
        Read at {ops.generatedAt.replace('T', ' ').slice(0, 19)} UTC.
      </p>
    </div>
  )
}
