/**
 * Coverage and freshness report for the visa knowledge corpus.
 *
 * Answers the acceptance question directly: for every supported country and
 * visa category, is there a mapped official source, and is anything actually
 * indexed from it? The two gaps are reported SEPARATELY because they have
 * different owners — "no source registered" is research, "sources registered
 * but nothing indexed" is engineering.
 *
 * `--raise` also files each gap as a `kb_review_queue` item, so a gap becomes
 * work rather than a number in a report nobody opens.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx ts-node -P tsconfig.json scripts/knowledge-coverage.ts \
 *       [--raise] [--sweep] [--out coverage.json] [--markdown]
 */
import './lib/node20-websocket';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import { KnowledgeFreshnessService } from '../src/modules/knowledge/knowledge-freshness.service';

function toMarkdown(
  report: Awaited<ReturnType<KnowledgeFreshnessService['coverageReport']>>,
): string {
  const lines: string[] = [];
  lines.push(`# Visa knowledge coverage`);
  lines.push('');
  lines.push(`Generated ${report.generatedAt}`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Supported countries | ${report.supportedCountries} |`);
  lines.push(`| Active visa types | ${report.supportedVisaTypes} |`);
  lines.push(
    `| Visa types with a mapped official source | ${report.visaTypesWithSources} |`,
  );
  lines.push(
    `| Visa types with indexed passages | ${report.visaTypesWithChunks} |`,
  );
  lines.push(`| Registered sources (active) | ${report.totals.sources} |`);
  lines.push(
    `| Sources with indexed passages | ${report.totals.indexedSources} |`,
  );
  lines.push(`| Current passages | ${report.totals.chunks} |`);
  lines.push(
    `| Passages with an embedding | ${report.totals.embeddedChunks} |`,
  );
  lines.push(
    `| Sources past their freshness SLA | ${report.totals.staleSources} |`,
  );
  lines.push('');

  if (report.visaTypesWithoutAnySource.length) {
    lines.push('## Gap: no official source registered');
    lines.push('');
    lines.push(
      'These routes are listed as active but have no monitored official source, so the',
    );
    lines.push(
      'knowledge system refuses every question about them. This is a research task.',
    );
    lines.push('');
    lines.push('| Country | Visa type |');
    lines.push('|---|---|');
    for (const g of report.visaTypesWithoutAnySource)
      lines.push(`| ${g.country} | ${g.visaType} |`);
    lines.push('');
  }

  if (report.visaTypesWithSourcesButNoChunks.length) {
    lines.push('## Gap: sources registered, nothing indexed');
    lines.push('');
    lines.push(
      'Official sources exist but produced no retrievable passages — ingestion has not',
    );
    lines.push(
      'run for them, or every version was quarantined. This is an engineering task.',
    );
    lines.push('');
    lines.push('| Country | Visa type |');
    lines.push('|---|---|');
    for (const g of report.visaTypesWithSourcesButNoChunks)
      lines.push(`| ${g.country} | ${g.visaType} |`);
    lines.push('');
  }

  lines.push('## Per route');
  lines.push('');
  lines.push(
    '| Country | Visa type | Sources | Indexed sources | Passages | Embedded | Stale sources |',
  );
  lines.push('|---|---|---:|---:|---:|---:|---:|');
  for (const r of [...report.rows].sort((a, b) =>
    a.countryCode.localeCompare(b.countryCode),
  )) {
    lines.push(
      `| ${r.countryCode} | ${r.visaTypeName ?? '(country level)'} | ${r.sourceCount} | ` +
        `${r.indexedSourceCount} | ${r.chunkCount} | ${r.embeddedChunkCount} | ${r.staleSourceCount} |`,
    );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');

  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = new KnowledgeFreshnessService(db);

  const report = await service.coverageReport();

  let raised = 0;
  if (argv.includes('--raise'))
    raised = await service.raiseCoverageGaps(report);

  let stale: { stale: number; raised: number } | null = null;
  if (argv.includes('--sweep')) stale = await service.sweepStale();

  const out = get('--out');
  if (argv.includes('--markdown')) {
    const md = toMarkdown(report);
    if (out) {
      writeFileSync(out, md);
      process.stderr.write(`[knowledge-coverage] wrote ${out}\n`);
    } else {
      console.log(md);
    }
    return;
  }

  const payload = { ...report, coverageGapsRaised: raised, staleSweep: stale };
  const json = JSON.stringify(payload, null, 2);
  if (out) {
    writeFileSync(out, json);
    process.stderr.write(`[knowledge-coverage] wrote ${out}\n`);
  } else {
    console.log(json);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
