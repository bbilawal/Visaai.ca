import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A small in-memory stand-in for the supabase-js query builder, enough for
 * the family-gap sync: select / insert / upsert / update / delete with eq, like
 * ('prefix%'), in, limit, maybeSingle and single. Test-only.
 */
export type Row = Record<string, unknown>;

export interface FakeDb {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  /** Every write, in order: `${table}.${op}`. */
  writes: string[];
}

export function makeFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) {
    tables[k] = v.map((r) => ({ ...r }));
  }
  const writes: string[] = [];
  let nextId = 1;

  const from = (table: string) => {
    tables[table] ??= [];
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    let conflict = 'id';
    let payload: Row | Row[] | null = null;
    const filters: Array<(r: Row) => boolean> = [];
    let limit: number | null = null;
    let single = false;

    const run = () => {
      const rows = tables[table];
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const inserted = list.map((r) => ({ id: `row-${nextId++}`, ...r }));
        rows.push(...inserted);
        writes.push(`${table}.insert`);
        return { data: inserted, error: null };
      }
      if (op === 'upsert') {
        const row = payload as Row;
        const hit = rows.find((r) => r[conflict] === row[conflict]);
        if (hit) Object.assign(hit, row);
        else rows.push({ id: `row-${nextId++}`, ...row });
        writes.push(`${table}.upsert`);
        return { data: null, error: null };
      }
      let matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        for (const r of matched) Object.assign(r, payload);
        writes.push(`${table}.update`);
        return { data: matched, error: null };
      }
      if (op === 'delete') {
        tables[table] = rows.filter((r) => !matched.includes(r));
        writes.push(`${table}.delete`);
        return { data: matched, error: null };
      }
      if (limit !== null) matched = matched.slice(0, limit);
      if (single)
        return { data: matched[0] ? { ...matched[0] } : null, error: null };
      return { data: matched.map((r) => ({ ...r })), error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (rows: Row | Row[]) => {
        op = 'insert';
        payload = rows;
        return b;
      },
      upsert: (row: Row, opts?: { onConflict?: string }) => {
        op = 'upsert';
        payload = row;
        conflict = opts?.onConflict ?? 'id';
        return b;
      },
      update: (v: Row) => {
        op = 'update';
        payload = v;
        return b;
      },
      delete: () => {
        op = 'delete';
        return b;
      },
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return b;
      },
      like: (col: string, pattern: string) => {
        const prefix = pattern.replace(/%$/, '');
        filters.push(
          (r) => typeof r[col] === 'string' && r[col].startsWith(prefix),
        );
        return b;
      },
      in: (col: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[col]));
        return b;
      },
      limit: (n: number) => {
        limit = n;
        return b;
      },
      order: () => b,
      maybeSingle: () => {
        single = true;
        return b;
      },
      single: () => {
        single = true;
        return b;
      },
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => {
        try {
          return Promise.resolve(resolve(run()));
        } catch (e) {
          return reject
            ? reject(e)
            : Promise.reject(e instanceof Error ? e : new Error(String(e)));
        }
      },
    };
    return b;
  };

  return {
    client: { from } as unknown as SupabaseClient,
    tables,
    writes,
  };
}
