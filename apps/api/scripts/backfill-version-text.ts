#!/usr/bin/env ts-node
/**
 * Backfill `visa_source_versions.normalized_text` — but ONLY where the hash
 * proves the text is still the same.
 *
 * WHY THIS IS NARROW ON PURPOSE
 *
 * B-29: every change this system filed was diffed against the empty string,
 * because nothing ever wrote the previous version's text. The fix retains text
 * from now on, which leaves a gap — 283 existing versions have none, so the
 * NEXT change on each of those sources still cannot be characterised. One more
 * uncharacterised review item per source.
 *
 * The obvious backfill is to re-fetch each source and store what comes back.
 * That is wrong, and wrong in the same way B-29 was: the page may have changed
 * since the version was filed, and storing today's text against an older
 * version asserts that the version said what the page says now. It would
 * silently erase whatever really changed — a confident wrong answer, which is
 * worse than a gap you can see.
 *
 * So this fills a version ONLY when `sha256(normalizeContent(fetched))` equals
 * the `normalized_sha256` already stored on it. That equality is proof the
 * content is byte-identical to what was hashed at filing time. Where the hashes
 * differ, the version is left NULL and reported — its text is genuinely
 * unrecoverable, and pretending otherwise is the failure this exists to avoid.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx ts-node -P tsconfig.json scripts/backfill-version-text.ts [--write]
 *
 * Without --write it reports and changes nothing.
 */
import './lib/node20-websocket';
import { createClient } from '@supabase/supabase-js';
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import { normalizeContent, sha256 } from '../src/modules/visa-sync/normalize';

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  const write = process.argv.includes('--write');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await db
    .from('visa_source_versions')
    .select('id, source_id, version_number, normalized_sha256, is_active, visa_sources(source_url)')
    .is('normalized_text', null)
    .order('version_number', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as {
    id: string;
    source_id: string;
    version_number: number;
    normalized_sha256: string;
    is_active: boolean;
    visa_sources: { source_url: string } | { source_url: string }[] | null;
  }[];

  console.log(`${rows.length} version(s) carry no retained text.\n`);

  // One fetch per SOURCE, not per version: several versions of the same source
  // share a URL and only the one whose hash matches can be filled anyway.
  const byUrl = new Map<string, typeof rows>();
  for (const r of rows) {
    const s = Array.isArray(r.visa_sources) ? r.visa_sources[0] : r.visa_sources;
    if (!s?.source_url) continue;
    byUrl.set(s.source_url, [...(byUrl.get(s.source_url) ?? []), r]);
  }

  let filled = 0;
  let stale = 0;
  let unreadable = 0;

  for (const [sourceUrl, versions] of byUrl) {
    const res = await fetchSource(sourceUrl, DEFAULT_FETCH_POLICY);
    if (res.status !== 'ok') {
      unreadable += versions.length;
      continue;
    }
    const text = normalizeContent(res.body, res.contentType);
    const hash = sha256(text);

    for (const v of versions) {
      if (v.normalized_sha256 !== hash) {
        // The page has moved on. This version's text is gone, and inventing it
        // would assert the version said what the page says today.
        stale++;
        continue;
      }
      if (write) {
        const { error: upErr } = await db
          .from('visa_source_versions')
          .update({ normalized_text: text })
          .eq('id', v.id);
        if (upErr) {
          console.error(`  update failed for ${v.id}: ${upErr.message}`);
          continue;
        }
      }
      filled++;
      console.log(`  ${write ? 'filled' : 'would fill'}  v${v.version_number}${v.is_active ? ' (active)' : ''}  ${sourceUrl}`);
    }
    await new Promise((r) => setTimeout(r, 2_000)); // polite between sources
  }

  console.log(
    `\n${filled} version(s) ${write ? 'filled' : 'fillable'} — hash still matches, so the text is provably the same.\n` +
      `${stale} left NULL: the page has changed since filing and that text is unrecoverable.\n` +
      `${unreadable} left NULL: the source could not be fetched.`,
  );
  if (!write) console.log('\n(dry run — pass --write to apply)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
