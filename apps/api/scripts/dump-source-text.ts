/** Fetch a registered source and print its normalized text, for manual extraction. */
import { fetchSource, DEFAULT_FETCH_POLICY } from '../src/modules/visa-sync/source-fetcher';
import { normalizeContent } from '../src/modules/visa-sync/normalize';

async function main() {
  const url = process.argv[2];
  const r = await fetchSource(url, DEFAULT_FETCH_POLICY);
  if (r.status !== 'ok') {
    console.error(`FETCH ${r.status}: ${JSON.stringify(r)}`);
    process.exit(1);
  }
  console.log(normalizeContent(r.body, r.contentType));
}
main();
