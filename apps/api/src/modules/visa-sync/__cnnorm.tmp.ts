import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { normalizeContent } from './normalize';
const D =
  '/private/tmp/claude-501/-Users-bilawalmuzaffar/eb394d6b-82c6-4895-9d0a-f0414fa996e0/scratchpad/cnnew';
for (const f of readdirSync(D).filter((f) => f.endsWith('.html'))) {
  writeFileSync(
    `${D}/${f.replace('.html', '.txt')}`,
    normalizeContent(readFileSync(`${D}/${f}`, 'utf8'), 'text/html'),
    'utf8',
  );
}
console.log('normalized with v4');
