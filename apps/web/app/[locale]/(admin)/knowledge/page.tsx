import {
  getKnowledgeCoverage,
  getKnowledgeReview,
  getKnowledgeStatus,
  type KnowledgeCoverage,
  type KnowledgeReviewItem,
  type KnowledgeStatus,
} from '@/lib/api/admin'

/**
 * Visa knowledge system operations.
 *
 * The screen the retrieval corpus depends on. Its job is to answer, in one
 * page, the questions an operator actually has:
 *
 *   - which supported routes can the system answer about, and which cannot
 *   - what did it refuse to index, and why
 *   - what needs a human
 *   - how big is the corpus, and what is deduplication actually saving
 *
 * TWO GAP CLASSES ARE SHOWN SEPARATELY, and that is the point of the layout
 * rather than a formatting choice. "No official source registered" is a
 * RESEARCH task — somebody has to find the authority's page. "Sources
 * registered but nothing indexed" is an ENGINEERING task — the pipeline did not
 * run, or quarantined everything. Collapsing them into one "coverage gap"
 * number is how a research backlog gets mistaken for a broken pipeline.
 *
 * Read-only, like the registry screen next door. Re-ingestion goes through
 * `POST /admin/knowledge/ingest` with a dry-run mode; a one-click button that
 * fires a few hundred requests at government hosts does not belong on a
 * dashboard.
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
        style={{ fontSize: '1.3rem', color: bad ? 'var(--color-rose, #b53030)' : undefined }}
      >
        {value}
      </div>
      {note ? <div style={{ fontSize: '0.65rem', opacity: 0.6 }}>{note}</div> : null}
    </div>
  )
}

function bytes(n: number | undefined): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low']

export default async function KnowledgeOpsPage() {
  let status: KnowledgeStatus | null = null
  let coverage: KnowledgeCoverage | null = null
  let review: { total: number; items: KnowledgeReviewItem[] } | null = null
  let error: string | null = null

  try {
    ;[status, coverage, review] = await Promise.all([
      getKnowledgeStatus(),
      getKnowledgeCoverage(),
      getKnowledgeReview(),
    ])
  } catch (e) {
    // Degrade to a stated failure, never to zeros. A corpus screen that renders
    // "0 gaps" when it could not load is the same class of lie the whole
    // grounding layer exists to stop.
    error = e instanceof Error ? e.message : String(e)
  }

  if (!status || !coverage) {
    return (
      <div>
        <h1 className="type-h3" style={{ marginBottom: 12 }}>
          Visa knowledge system
        </h1>
        <p style={{ color: 'var(--color-rose, #b53030)' }}>
          Could not load knowledge-system state: {error ?? 'unknown error'}. These figures
          are not zero — they are unknown.
        </p>
      </div>
    )
  }

  const noSource = coverage.visaTypesWithoutAnySource
  const noChunks = coverage.visaTypesWithSourcesButNoChunks
  const answerable = coverage.visaTypesWithChunks
  const rows = [...coverage.rows].sort(
    (a, b) =>
      a.countryCode.localeCompare(b.countryCode) ||
      (a.visaTypeName ?? '').localeCompare(b.visaTypeName ?? ''),
  )

  return (
    <div>
      <h1 className="type-h3" style={{ marginBottom: 4 }}>
        Visa knowledge system
      </h1>
      <p style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: 16 }}>
        Read-only. Retrieval answers only from indexed official sources; a route with
        nothing indexed is refused, not guessed. Generated {coverage.generatedAt.slice(0, 16).replace('T', ' ')}.
      </p>

      <h2 className="type-h5" style={{ marginBottom: 8 }}>
        Coverage
      </h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <Stat label="Supported countries" value={coverage.supportedCountries} />
        <Stat label="Active visa types" value={coverage.supportedVisaTypes} />
        <Stat
          label="With a mapped source"
          value={coverage.visaTypesWithSources}
          bad={coverage.visaTypesWithSources < coverage.supportedVisaTypes}
          note={`${noSource.length} without`}
        />
        <Stat
          label="Answerable"
          value={answerable}
          bad={answerable < coverage.visaTypesWithSources}
          note="has indexed passages"
        />
        <Stat
          label="Stale sources"
          value={coverage.totals.staleSources}
          bad={coverage.totals.staleSources > 0}
          note="past freshness SLA"
        />
      </div>

      {noSource.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <h3 className="type-h6" style={{ marginBottom: 6 }}>
            Gap: no official source registered ({noSource.length}) — research
          </h3>
          <p style={{ fontSize: '0.72rem', opacity: 0.8, marginBottom: 6 }}>
            These routes are listed as active but have no monitored official source, so
            every question about them is refused. Register the authority page in{' '}
            <code>visa_sources</code>.
          </p>
          <ul className="mono" style={{ fontSize: '0.7rem', columns: 2, marginBottom: 0 }}>
            {noSource.slice(0, 40).map((g) => (
              <li key={`${g.country}-${g.slug}`}>
                {g.country} — {g.visaType}
              </li>
            ))}
          </ul>
          {noSource.length > 40 ? (
            <p style={{ fontSize: '0.68rem', opacity: 0.6 }}>
              …and {noSource.length - 40} more.
            </p>
          ) : null}
        </div>
      ) : null}

      {noChunks.length > 0 ? (
        <div style={{ marginBottom: 20 }}>
          <h3 className="type-h6" style={{ marginBottom: 6 }}>
            Gap: sources registered, nothing indexed ({noChunks.length}) — engineering
          </h3>
          <p style={{ fontSize: '0.72rem', opacity: 0.8, marginBottom: 6 }}>
            Official sources exist but produced no retrievable passages: ingestion has not
            run for them, or every version was quarantined. Check the job and quarantine
            counts below.
          </p>
          <ul className="mono" style={{ fontSize: '0.7rem', columns: 2, marginBottom: 0 }}>
            {noChunks.slice(0, 40).map((g) => (
              <li key={`${g.country}-${g.slug}`}>
                {g.country} — {g.visaType}
              </li>
            ))}
          </ul>
          {noChunks.length > 40 ? (
            <p style={{ fontSize: '0.68rem', opacity: 0.6 }}>
              …and {noChunks.length - 40} more.
            </p>
          ) : null}
        </div>
      ) : null}

      <h2 className="type-h5" style={{ marginBottom: 8 }}>
        Corpus and storage
      </h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <Stat label="Passages" value={status.storage.chunk_count ?? 0} />
        <Stat
          label="Distinct texts"
          value={status.storage.distinct_chunk_texts ?? 0}
          note="one row per unique passage"
        />
        <Stat
          label="Text dedup saving"
          value={pct(status.storage.chunkTextDeduplicationRatio)}
          note="vs storing every instance"
        />
        <Stat label="Embeddings" value={status.storage.embedding_count ?? 0} />
        <Stat
          label="Embedding models"
          value={status.storage.embedding_models ?? 0}
          note="one vector per text per model"
        />
        <Stat label="Cached files" value={status.storage.blob_count ?? 0} />
        <Stat label="Source bytes" value={bytes(status.storage.blob_logical_bytes)} />
        <Stat
          label="Stored bytes"
          value={bytes(status.storage.blob_stored_bytes)}
          note={`${pct(status.storage.blobCompressionRatio)} compressed`}
        />
      </div>
      <p style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: 20 }}>
        Source bytes are cached only where the authority permits redistribution.
        Otherwise the hash and size are kept — enough to detect change and to prove what
        was read — and users are linked to the authority&rsquo;s own page.
      </p>

      <h2 className="type-h5" style={{ marginBottom: 8 }}>
        Pipeline
      </h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <Stat label="Jobs succeeded" value={status.jobs.succeeded ?? 0} />
        <Stat label="Skipped (unchanged)" value={status.jobs.skipped ?? 0} />
        <Stat
          label="Jobs failed"
          value={status.jobs.failed ?? 0}
          bad={(status.jobs.failed ?? 0) > 0}
        />
        <Stat label="Queued" value={status.jobs.queued ?? 0} />
        <Stat
          label="Quarantined"
          value={status.quarantine.open}
          bad={status.quarantine.open > 0}
          note={
            Object.entries(status.quarantine.byReason)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ') || 'nothing refused'
          }
        />
      </div>

      <h2 className="type-h5" style={{ marginBottom: 8 }}>
        Needs a human ({status.review.open})
      </h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        {SEVERITY_ORDER.filter((s) => status.review.bySeverity[s]).map((s) => (
          <Stat
            key={s}
            label={s}
            value={status.review.bySeverity[s] ?? 0}
            bad={s === 'critical' || s === 'high'}
          />
        ))}
      </div>

      {!review || review.items.length === 0 ? (
        <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: 24 }}>Nothing is waiting.</p>
      ) : (
        <table
          style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}
          className="mono"
        >
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: HAIRLINE }}>
              <th style={{ padding: '8px 6px' }}>Severity</th>
              <th style={{ padding: '8px 6px' }}>Kind</th>
              <th style={{ padding: '8px 6px' }}>What</th>
              <th style={{ padding: '8px 6px' }}>Seen</th>
              <th style={{ padding: '8px 6px' }}>Last</th>
            </tr>
          </thead>
          <tbody>
            {review.items.map((item) => (
              <tr key={item.id} style={{ borderBottom: '1px solid rgba(0,0,0,.08)' }}>
                <td
                  style={{
                    padding: '8px 6px',
                    fontSize: '0.72rem',
                    color:
                      item.severity === 'high' || item.severity === 'critical'
                        ? 'var(--color-rose, #b53030)'
                        : undefined,
                  }}
                >
                  {item.severity}
                </td>
                <td style={{ padding: '8px 6px', fontSize: '0.7rem' }}>{item.kind}</td>
                <td style={{ padding: '8px 6px', fontSize: '0.7rem', maxWidth: 520 }}>
                  {item.title}
                </td>
                <td style={{ padding: '8px 6px', fontSize: '0.72rem' }}>{item.occurrences}×</td>
                <td style={{ padding: '8px 6px', fontSize: '0.68rem' }}>
                  {item.last_seen_at?.slice(0, 16).replace('T', ' ') ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="type-h5" style={{ marginBottom: 8 }}>
        Per route
      </h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} className="mono">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: HAIRLINE }}>
              <th style={{ padding: '8px 6px' }}>Country</th>
              <th style={{ padding: '8px 6px' }}>Visa type</th>
              <th style={{ padding: '8px 6px', textAlign: 'right' }}>Sources</th>
              <th style={{ padding: '8px 6px', textAlign: 'right' }}>Indexed</th>
              <th style={{ padding: '8px 6px', textAlign: 'right' }}>Passages</th>
              <th style={{ padding: '8px 6px', textAlign: 'right' }}>Embedded</th>
              <th style={{ padding: '8px 6px', textAlign: 'right' }}>Stale</th>
              <th style={{ padding: '8px 6px' }}>Last checked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.countryCode}-${r.visaTypeSlug ?? 'country'}`}
                style={{ borderBottom: '1px solid rgba(0,0,0,.08)' }}
              >
                <td style={{ padding: '6px', fontSize: '0.72rem' }}>{r.countryCode}</td>
                <td style={{ padding: '6px', fontSize: '0.7rem', maxWidth: 320 }}>
                  {r.visaTypeName ?? '(country level)'}
                </td>
                <td style={{ padding: '6px', fontSize: '0.72rem', textAlign: 'right' }}>
                  {r.sourceCount}
                </td>
                <td style={{ padding: '6px', fontSize: '0.72rem', textAlign: 'right' }}>
                  {r.indexedSourceCount}
                </td>
                <td
                  style={{
                    padding: '6px',
                    fontSize: '0.72rem',
                    textAlign: 'right',
                    color: r.chunkCount === 0 ? 'var(--color-rose, #b53030)' : undefined,
                  }}
                >
                  {r.chunkCount}
                </td>
                <td style={{ padding: '6px', fontSize: '0.72rem', textAlign: 'right' }}>
                  {r.embeddedChunkCount}
                </td>
                <td
                  style={{
                    padding: '6px',
                    fontSize: '0.72rem',
                    textAlign: 'right',
                    color: r.staleSourceCount > 0 ? 'var(--color-rose, #b53030)' : undefined,
                  }}
                >
                  {r.staleSourceCount}
                </td>
                <td style={{ padding: '6px', fontSize: '0.68rem' }}>
                  {r.lastCheckedAt?.slice(0, 10) ?? 'never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
