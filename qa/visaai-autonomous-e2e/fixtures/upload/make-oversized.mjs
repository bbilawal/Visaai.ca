/**
 * Recreates oversized.pdf, the only upload fixture kept out of git.
 *
 * The documents client caps uploads at 50 MB (MAX_FILE_SIZE in
 * documents-client.tsx), so this file exists purely to be rejected. It is 51 MB
 * of filler behind a real PDF header — big enough to trip the cap, boring enough
 * that nothing else in the pipeline has an opinion about it.
 *
 *   node qa/visaai-autonomous-e2e/fixtures/upload/make-oversized.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'oversized.pdf');
const TARGET_BYTES = 51 * 1024 * 1024;

const header = Buffer.from('%PDF-1.4\n% oversized upload fixture — expected to be rejected\n');
const filler = Buffer.alloc(TARGET_BYTES - header.length, 0x20); // spaces

writeFileSync(OUT, Buffer.concat([header, filler]));
console.log(`wrote ${OUT} (${TARGET_BYTES} bytes)`);
