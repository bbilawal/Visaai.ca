/**
 * A Supabase client double for the knowledge module's service tests.
 *
 * WHY NOT MOCK THE SERVICE'S OWN METHODS. The behaviour worth testing in
 * `KnowledgeIngestionService` and `KnowledgeRetrievalService` is precisely the
 * sequence of database calls they make — what gets deduplicated, what gets
 * superseded, which filters reach the SQL. A test that stubs those methods
 * asserts nothing about them.
 *
 * So this implements enough of the PostgREST builder to run the real code:
 * from/select/eq/in/neq/insert/upsert/update/delete/order/limit/range/single,
 * plus rpc and storage. Rows live in plain arrays, so a test can assert on
 * `db.tables.kb_chunks` afterwards.
 *
 * It is deliberately NOT a Postgres: no RLS, no constraints, no SQL. The things
 * that need real SQL — `kb_search_hybrid`, the unique indexes, the RLS
 * policies — are covered by the integration spec that runs against the local
 * stack, and this double must never be mistaken for coverage of them.
 */

/*
 * `any` is the point of this file, not an oversight.
 *
 * It models a PostgREST query builder, whose whole interface is dynamic: a
 * column name is a string, a row is whatever the table holds, and a filter
 * value is whatever that column stores. Typing it faithfully would mean
 * reproducing the generated database types here — the very binding the project
 * has deferred as DEBT-001 — for a component whose only job is to let the
 * services under test run their real code paths.
 *
 * The rule is disabled for the file rather than at ~13 individual lines so the
 * reason is stated once, where it can be read.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

type Row = Record<string, any>;

interface Filter {
  op: 'eq' | 'neq' | 'in' | 'is' | 'gte' | 'lte';
  column: string;
  value: any;
}

export interface FakeSupabaseOptions {
  /** Responses for `rpc(name, args)`, by function name. */
  rpc?: Record<string, (args: any) => { data: any; error: any }>;
  /** Force an error from a table, to exercise failure paths. */
  failTable?: Record<string, string>;
  /** Force the storage upload to fail, to exercise the metadata-only path. */
  failStorage?: string;
}

export class FakeSupabase {
  readonly tables: Record<string, Row[]> = {};
  /** Every rpc call made, for assertions on the filters that reached SQL. */
  readonly rpcCalls: Array<{ name: string; args: any }> = [];
  readonly storageUploads: Array<{
    bucket: string;
    path: string;
    size: number;
  }> = [];

  constructor(private readonly opts: FakeSupabaseOptions = {}) {}

  seed(table: string, rows: Row[]): this {
    this.tables[table] = [
      ...(this.tables[table] ?? []),
      ...rows.map((r) => ({ ...r })),
    ];
    return this;
  }

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table, this.opts.failTable?.[table]);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async rpc(name: string, args: any): Promise<{ data: any; error: any }> {
    this.rpcCalls.push({ name, args });
    const handler = this.opts.rpc?.[name];
    if (!handler) return { data: [], error: null };
    return handler(args);
  }

  get storage() {
    return {
      from: (bucket: string) => ({
        // eslint-disable-next-line @typescript-eslint/require-await
        upload: async (path: string, body: Buffer | Uint8Array) => {
          if (this.opts.failStorage) {
            return { data: null, error: { message: this.opts.failStorage } };
          }
          this.storageUploads.push({ bucket, path, size: body.byteLength });
          return { data: { path }, error: null };
        },
      }),
    };
  }

  /** Internal, used by QueryBuilder. */
  _rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }
}

class QueryBuilder implements PromiseLike<{
  data: any;
  error: any;
  count?: number;
}> {
  private filters: Filter[] = [];
  private mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Row[] = [];
  private onConflict: string[] = [];
  private ignoreDuplicates = false;
  private updates: Row = {};
  private limitN: number | null = null;
  private singleMode: 'single' | 'maybeSingle' | null = null;
  private orderBy: Array<{ column: string; ascending: boolean }> = [];

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
    private readonly forcedError?: string,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  select(cols?: string, opts?: unknown): this {
    // Column selection is ignored on purpose: the double returns whole rows,
    // and a test that depended on projection would be asserting the double's
    // behaviour rather than the service's.
    return this;
  }
  eq(column: string, value: any): this {
    this.filters.push({ op: 'eq', column, value });
    return this;
  }
  neq(column: string, value: any): this {
    this.filters.push({ op: 'neq', column, value });
    return this;
  }
  in(column: string, value: any[]): this {
    this.filters.push({ op: 'in', column, value });
    return this;
  }
  is(column: string, value: any): this {
    this.filters.push({ op: 'is', column, value });
    return this;
  }
  gte(column: string, value: any): this {
    this.filters.push({ op: 'gte', column, value });
    return this;
  }
  lte(column: string, value: any): this {
    this.filters.push({ op: 'lte', column, value });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push({ column, ascending: opts?.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number): this {
    this.limitN = to - from + 1;
    return this;
  }
  single(): this {
    this.singleMode = 'single';
    return this;
  }
  maybeSingle(): this {
    this.singleMode = 'maybeSingle';
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.mode = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(
    rows: Row | Row[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.mode = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.onConflict = opts?.onConflict
      ? opts.onConflict.split(',').map((c) => c.trim())
      : [];
    this.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
    return this;
  }
  update(values: Row): this {
    this.mode = 'update';
    this.updates = values;
    return this;
  }
  delete(): this {
    this.mode = 'delete';
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const v = row[f.column];
      switch (f.op) {
        case 'eq':
          return v === f.value;
        case 'neq':
          return v !== f.value;
        case 'in':
          return (f.value as any[]).includes(v);
        case 'is':
          return v === f.value;
        case 'gte':
          return v >= f.value;
        case 'lte':
          return v <= f.value;
        default:
          return false;
      }
    });
  }

  private run(): { data: any; error: any; count?: number } {
    if (this.forcedError)
      return { data: null, error: { message: this.forcedError } };
    const rows = this.db._rows(this.table);
    let result: Row[] = [];
    let seq = rows.length;

    switch (this.mode) {
      case 'select':
        result = rows.filter((r) => this.matches(r));
        break;
      case 'insert':
        for (const r of this.payload) {
          const row = { id: r.id ?? `${this.table}-${++seq}`, ...r };
          rows.push(row);
          result.push(row);
        }
        break;
      case 'upsert':
        for (const r of this.payload) {
          const existing = this.onConflict.length
            ? rows.find((row) => this.onConflict.every((k) => row[k] === r[k]))
            : undefined;
          if (existing) {
            if (!this.ignoreDuplicates) Object.assign(existing, r);
            result.push(existing);
          } else {
            const row = { id: r.id ?? `${this.table}-${++seq}`, ...r };
            rows.push(row);
            result.push(row);
          }
        }
        break;
      case 'update':
        for (const row of rows) {
          if (this.matches(row)) {
            Object.assign(row, this.updates);
            result.push(row);
          }
        }
        break;
      case 'delete': {
        const keep: Row[] = [];
        for (const row of rows) {
          if (this.matches(row)) result.push(row);
          else keep.push(row);
        }
        this.db.tables[this.table] = keep;
        break;
      }
    }

    if (this.mode === 'select' && this.orderBy.length) {
      result = [...result].sort((a, b) => {
        for (const { column, ascending } of this.orderBy) {
          const av = a[column];
          const bv = b[column];
          if (av === bv) continue;
          if (av === null || av === undefined) return ascending ? -1 : 1;
          if (bv === null || bv === undefined) return ascending ? 1 : -1;
          return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      });
    }

    const count = result.length;
    if (this.limitN !== null) result = result.slice(0, this.limitN);

    if (this.singleMode === 'single') {
      if (result.length !== 1) {
        return {
          data: null,
          error: { message: `expected 1 row, got ${result.length}` },
        };
      }
      return { data: result[0], error: null, count };
    }
    if (this.singleMode === 'maybeSingle') {
      return { data: result[0] ?? null, error: null, count };
    }
    return { data: result, error: null, count };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: any;
          error: any;
          count?: number;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}
