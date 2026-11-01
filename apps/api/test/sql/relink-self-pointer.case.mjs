// Child process for field-provenance-retire.sql.spec.ts: a live row pointing
// at a retired (self-pointing) row, then a delete of the retired row. The
// relink trigger must leave it to the deferred FK — not loop. Prints
// "refused: <error>" or "deleted"; run under a hard kill by the spec, since
// PGlite ignores statement_timeout.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '../../../../supabase/migrations');
const db = new PGlite();
await db.exec(`
  create table field_provenance (
    id uuid primary key, application_id uuid not null, field_key text not null,
    superseded_by uuid references field_provenance);
`);
await db.exec(
  readFileSync(join(migrations, '20261015043000_field_provenance_relink_chain.sql'), 'utf8'),
);
// Only the trigger function of the retire migration matters here.
const retire = readFileSync(
  join(migrations, '20261020120000_field_provenance_retire.sql'),
  'utf8',
);
const start = retire.indexOf(
  'create or replace function public.field_provenance_relink_chain()',
);
if (start < 0) throw new Error('relink trigger not found in the retire migration');
const trigger = retire.slice(start);
const end = trigger.indexOf('$$;');
if (end < 0) throw new Error('end of the relink trigger ($$;) not found');
await db.exec(trigger.slice(0, end + 3));
await db.exec(`
  insert into field_provenance values
    ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'k', null),
    ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'k2', null);
  update field_provenance set superseded_by = id
   where id = '00000000-0000-0000-0000-00000000000b';
  update field_provenance set superseded_by = '00000000-0000-0000-0000-00000000000b'
   where id = '00000000-0000-0000-0000-00000000000a';
`);
try {
  await db.exec(
    `delete from field_provenance where id = '00000000-0000-0000-0000-00000000000b'`,
  );
  console.log('deleted');
} catch (e) {
  console.log(`refused: ${e.message}`);
}
await db.close();
