import '../../../strategies'; // registers the built-in country strategies
import { TemplateSweepService } from './sweep.service';
import { RobotsGate } from '../robots';
import type { FetchLike, HttpResponse } from '../http';
import type { SupabaseService } from '../../shared/supabase/supabase.service';
import type { AuthorityIndex } from './index-sources';

function res(body: string, ok = true, status = 200): HttpResponse {
  return {
    ok,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

/** robots.txt that allows everything, plus the index page body. */
function http(body: string, robots = 'User-agent: *\nDisallow:'): FetchLike {
  return (url) =>
    Promise.resolve(res(url.endsWith('/robots.txt') ? robots : body));
}

interface Recorder {
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
}

function fakeSupabase(
  existing: { id: string; status: string } | null,
  rec: Recorder,
): SupabaseService {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data: existing, error: null }),
    insert: (row: Record<string, unknown>) => {
      rec.inserts.push(row);
      return Promise.resolve({ error: null });
    },
    update: (row: Record<string, unknown>) => {
      rec.updates.push(row);
      return { eq: () => Promise.resolve({ error: null }) };
    },
  };
  return { admin: { from: () => builder } } as unknown as SupabaseService;
}

const FAKE_INDEX: AuthorityIndex = {
  authority: 'test',
  label: 'Test authority',
  indexUrl: 'https://www.canada.ca/test-index.html',
  parse: () => [
    { code: 'IMM 5257', title: 'Already cataloged', url: 'https://x/1' },
    { code: 'IMM 9999', title: 'Brand new form', url: 'https://x/2' },
  ],
};

describe('TemplateSweepService.knownCodes', () => {
  const svc = new TemplateSweepService(
    fakeSupabase(null, { inserts: [], updates: [] }),
    new RobotsGate(http('')),
    http(''),
  );

  it('covers forms and document templates alike', () => {
    const known = svc.knownCodes();
    expect(known.has('IMM5257')).toBe(true); // a FormSpec
    expect(known.has('IMM5484')).toBe(true); // a document checklist
    expect(known.has('ICAO-PHOTO')).toBe(true); // a Schengen specification
  });

  // Link-only entries are excluded from the REFRESH worklist but are still in
  // the catalog. Omitting them here would make the sweep propose the very
  // artifacts we deliberately serve as links, every week, forever.
  it('includes link-only entries the refresh job skips', () => {
    expect(svc.knownCodes().has('IMM5476')).toBe(true);
  });

  it('normalises spacing so the diff compares like with like', () => {
    const known = svc.knownCodes();
    expect(known.has('IMM 5257')).toBe(false); // stored space-stripped
    expect(known.has('IMM5257')).toBe(true);
  });
});

describe('TemplateSweepService.sweepOne', () => {
  it('records only the codes the catalog does not have', async () => {
    const rec: Recorder = { inserts: [], updates: [] };
    const svc = new TemplateSweepService(
      fakeSupabase(null, rec),
      new RobotsGate(http('')),
      http(''),
    );

    const out = await svc.sweepOne(FAKE_INDEX);

    expect(out).toMatchObject({ indexed: 2, known: 1, recorded: 1 });
    expect(rec.inserts).toHaveLength(1);
    expect(rec.inserts[0]).toMatchObject({
      authority: 'test',
      code: 'IMM 9999',
      status: 'new',
    });
  });

  // An operator who marked a finding 'ignored' has answered permanently.
  // Re-opening it every week is how a review queue becomes something people
  // stop reading.
  it('refreshes an existing finding without resetting its status', async () => {
    const rec: Recorder = { inserts: [], updates: [] };
    const svc = new TemplateSweepService(
      fakeSupabase({ id: 'f1', status: 'ignored' }, rec),
      new RobotsGate(http('')),
      http(''),
    );

    await svc.sweepOne(FAKE_INDEX);

    expect(rec.inserts).toHaveLength(0);
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0]).toHaveProperty('last_seen_at');
    expect(rec.updates[0]).not.toHaveProperty('status');
  });

  it('skips an index robots.txt disallows', async () => {
    const rec: Recorder = { inserts: [], updates: [] };
    const disallowing = http('', 'User-agent: *\nDisallow: /');
    const svc = new TemplateSweepService(
      fakeSupabase(null, rec),
      new RobotsGate(disallowing),
      disallowing,
    );

    const out = await svc.sweepOne(FAKE_INDEX);

    expect(out.recorded).toBe(0);
    expect(out.message).toContain('robots.txt');
    expect(rec.inserts).toHaveLength(0);
  });

  // A restructured index that parses to nothing must never be read as "the
  // authority withdrew every form" — it records nothing and says so loudly.
  it('records nothing when the index parses empty', async () => {
    const rec: Recorder = { inserts: [], updates: [] };
    const svc = new TemplateSweepService(
      fakeSupabase(null, rec),
      new RobotsGate(http('')),
      http(''),
    );

    const out = await svc.sweepOne({ ...FAKE_INDEX, parse: () => [] });

    expect(out).toMatchObject({ indexed: 0, recorded: 0 });
    expect(out.message).toContain('may have changed');
    expect(rec.inserts).toHaveLength(0);
  });
});
