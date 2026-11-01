/**
 * Run the source monitor against the local registry.
 *
 * Exists so the sync can be exercised without the full Nest bootstrap (which
 * refuses to boot outside production against production env). Takes the same
 * VisaSyncService the scheduled job will, so what this proves is the real path.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx ts-node -P tsconfig.json scripts/visa-sync-run.ts [--limit N] [--country CA]
 */
import './lib/node20-websocket';
import { createClient } from '@supabase/supabase-js';
import { VisaSyncService } from '../src/modules/visa-sync/visa-sync.service';
import { DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');

  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : undefined;

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const svc = new VisaSyncService(db);
  const summary = await svc.run({
    trigger: 'manual',
    limit,
    fetchPolicy: DEFAULT_FETCH_POLICY,
    // Polite: 2s between requests to the same host. canada.ca publishes no
    // Crawl-delay for '*', so this is our own restraint, not a floor they set.
    perHostDelayMs: 2_000,
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
