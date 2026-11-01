#!/usr/bin/env ts-node
/**
 * How many registered sources would change hash under the CURRENT normalizer?
 *
 * WHY: a change to `normalizeContent` silently re-hashes the world. Every page
 * whose output shifts stops matching its active version, files a change, and
 * lands in the review queue. That happened once already — bumping
 * EXTRACTOR_VERSION for B-26 produced 111 review items in a single run, each
 * claiming a government had edited a page nobody had touched.
 *
 * So measure before deploying, not after. This fetches each source, normalizes
 * it with the code as it stands, and compares against the hash stored on the
 * active version.
 *
 * WHAT THIS DOES NOT TELL YOU, AND HOW TO GET IT
 *
 * A drift count is not a verdict on your change. Run against production on
 * 2026-08-24 this reported 30 of 40 active versions would re-hash, which looks
 * damning until you remember the text backfill had just established that 128 of
 * 283 pages no longer match the hash stored at filing time. Most of that drift
 * is the world moving on, not the code.
 *
 * To get the delta attributable to YOUR change, normalize the same fetched
 * bytes both ways and compare only those:
 *
 *   git show HEAD:apps/api/src/modules/visa-sync/normalize.ts > /tmp/old.ts
 *   # import both, hash both, report only where they disagree, then DELETE the
 *   # copy — a second normalize.ts living in the tree is a list that drifts.
 *
 * That measurement is what cleared the quoted-attribute fix (B-31): 0 of 25
 * readable sources changed because of it. Without it the honest-looking move
 * would have been to revert a correct fix.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx ts-node -P tsconfig.json scripts/check-normalization-drift.ts [--limit N]
 */
import './lib/node20-websocket';
import { createClient } from '@supabase/supabase-js';
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import { normalizeContent, sha256 } from '../src/modules/visa-sync/normalize';

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  const li = process.argv.indexOf('--limit');
  const limit = li >= 0 ? Number(process.argv[li + 1]) : undefined;
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await db
    .from('visa_source_versions')
    .select('id, normalized_sha256, visa_sources(source_url)')
    .eq('is_active', true);
  if (error) throw error;

  const rows = (data ?? []) as {
    normalized_sha256: string;
    visa_sources: { source_url: string } | { source_url: string }[] | null;
  }[];
  const targets = (limit ? rows.slice(0, limit) : rows).filter((r) => r.visa_sources);

  let same = 0;
  let drifted = 0;
  let unreadable = 0;

  for (const r of targets) {
    const src = Array.isArray(r.visa_sources) ? r.visa_sources[0] : r.visa_sources!;
    const res = await fetchSource(src.source_url, DEFAULT_FETCH_POLICY);
    if (res.status !== 'ok') {
      unreadable++;
      continue;
    }
    const hash = sha256(normalizeContent(res.body, res.contentType));
    if (hash === r.normalized_sha256) same++;
    else {
      drifted++;
      console.log(`  DRIFT  ${src.source_url}`);
    }
    await new Promise((s) => setTimeout(s, 1_500));
  }

  console.log(
    `\n${same} unchanged, ${drifted} would re-hash, ${unreadable} unreadable ` +
      `(of ${targets.length} active version(s) checked).`,
  );
  if (drifted > 0) {
    console.log(
      '\nEach drifted source will file a change on the next run. Some of those are\n' +
        'genuine edits by the authority; the rest are this normalizer change. The\n' +
        'two are indistinguishable in the queue, which is the cost of shipping a\n' +
        'normalizer change without measuring it first.',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
