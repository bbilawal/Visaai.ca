#!/usr/bin/env node
// Schema parity gate: every Postgres function the API calls via `.rpc('name')`
// must exist in the database the API is about to talk to.
//
// Why this exists: `origin/main` shipped LedgerService calling
// claim_payment_webhook_event & co. while the migration that creates them was
// never applied to the self-hosted production database. Every build and test
// passed; the first live Stripe webhook would have 500'd forever. Nothing on the
// deploy path compared the code's schema expectations with the real schema.
//
// Usage (on the target box, read-only — it only GETs the PostgREST OpenAPI doc):
//   node infra/scripts/rpc-parity.mjs <repo-root> <api-env-file>
// Exits 0 when every referenced RPC is exposed, 1 when any is missing, 2 on a
// usage/transport error.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RPC_CALL = /\.rpc(?:<[^>]*>)?\(\s*['"`]([a-z0-9_]+)['"`]/g;

/** RPC names called by one source file. Handles a name on the next line. */
export function rpcNamesIn(source) {
  const names = new Set();
  for (const m of source.matchAll(RPC_CALL)) names.add(m[1]);
  return names;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** Every RPC the API source calls, sorted. Specs are excluded — they mock. */
export function referencedRpcs(apiSrcDir) {
  const all = new Set();
  for (const f of walk(apiSrcDir)) {
    for (const n of rpcNamesIn(readFileSync(f, 'utf8'))) all.add(n);
  }
  return [...all].sort();
}

/** RPC names exposed by a PostgREST OpenAPI document. */
export function exposedRpcs(openapi) {
  return new Set(
    Object.keys(openapi?.paths ?? {})
      .filter((p) => p.startsWith('/rpc/'))
      .map((p) => p.slice('/rpc/'.length)),
  );
}

export function missingRpcs(referenced, exposed) {
  return referenced.filter((n) => !exposed.has(n));
}

export function readEnv(file) {
  const env = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function main([repoRoot, envFile]) {
  if (!repoRoot || !envFile) {
    console.error('usage: rpc-parity.mjs <repo-root> <api-env-file>');
    return 2;
  }
  const env = readEnv(envFile);
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in ' + envFile);
    return 2;
  }
  // service_role sees functions whose EXECUTE is revoked from anon, which is
  // how the payment-ledger RPCs are granted.
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error(`PostgREST OpenAPI fetch failed: HTTP ${res.status}`);
    return 2;
  }
  const referenced = referencedRpcs(join(repoRoot, 'apps', 'api', 'src'));
  const missing = missingRpcs(referenced, exposedRpcs(await res.json()));
  if (missing.length) {
    console.error(
      `${missing.length} of ${referenced.length} RPCs the API calls are missing from the database:`,
    );
    for (const n of missing) console.error(`  - ${n}`);
    console.error('Apply the pending migration(s) BEFORE deploying this build.');
    return 1;
  }
  console.log(`all ${referenced.length} RPCs the API calls exist in the database`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err?.message ?? err);
      process.exit(2);
    },
  );
}
