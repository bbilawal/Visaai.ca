import type { SupabaseClient } from '@supabase/supabase-js';

import {
  KnowledgeFreshnessService,
  selectPolicy,
} from './knowledge-freshness.service';
import { FakeSupabase } from './test-support/fake-supabase';

describe('selectPolicy', () => {
  const policies = [
    {
      source_role: null,
      country_id: null,
      visa_type_id: null,
      risk_class: 'standard',
      check_interval: '1 day',
    },
    {
      source_role: 'fees',
      country_id: null,
      visa_type_id: null,
      risk_class: 'volatile',
      check_interval: '6 hours',
    },
    {
      source_role: 'fees',
      country_id: 'ca',
      visa_type_id: null,
      risk_class: 'volatile',
      check_interval: '1 hour',
    },
    {
      source_role: null,
      country_id: null,
      visa_type_id: 'trv',
      risk_class: 'volatile',
      check_interval: '2 hours',
    },
  ];

  it('prefers the visa-type policy over everything else', () => {
    const p = selectPolicy(policies, {
      role: 'fees',
      countryId: 'ca',
      visaTypeId: 'trv',
    });
    expect(p!.check_interval).toBe('2 hours');
  });

  it('prefers a country+role policy over role alone', () => {
    const p = selectPolicy(policies, {
      role: 'fees',
      countryId: 'ca',
      visaTypeId: null,
    });
    expect(p!.check_interval).toBe('1 hour');
  });

  it('falls back to the role policy for another country', () => {
    const p = selectPolicy(policies, {
      role: 'fees',
      countryId: 'au',
      visaTypeId: null,
    });
    expect(p!.check_interval).toBe('6 hours');
  });

  it('falls back to the corpus default for an unmatched role', () => {
    const p = selectPolicy(policies, {
      role: 'policy',
      countryId: 'au',
      visaTypeId: null,
    });
    expect(p!.check_interval).toBe('1 day');
  });

  it('checks a fee page far more often than ordinary guidance', () => {
    // The ordering that makes the whole freshness design work.
    const fee = selectPolicy(policies, {
      role: 'fees',
      countryId: 'au',
      visaTypeId: null,
    });
    const other = selectPolicy(policies, {
      role: 'requirements',
      countryId: 'au',
      visaTypeId: null,
    });
    expect(fee!.check_interval).toBe('6 hours');
    expect(other!.check_interval).toBe('1 day');
  });
});

function db() {
  return new FakeSupabase().seed('kb_freshness_policies', [
    {
      source_role: null,
      country_id: null,
      visa_type_id: null,
      risk_class: 'standard',
      check_interval: '1 day',
      staleness_sla: '30 days',
      active: true,
    },
    {
      source_role: 'fees',
      country_id: null,
      visa_type_id: null,
      risk_class: 'volatile',
      check_interval: '6 hours',
      staleness_sla: '7 days',
      active: true,
    },
  ]);
}

const svc = (fake: FakeSupabase) =>
  new KnowledgeFreshnessService(fake as unknown as SupabaseClient);

describe('dueSources', () => {
  it('returns only sources past their own interval', async () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const fake = db().seed('visa_sources', [
      // Checked 2 hours ago: due under the 6h fee policy? No.
      {
        id: 'fee-fresh',
        source_url: 'https://a/fees',
        country_id: 'ca',
        visa_type_id: null,
        role: 'fees',
        active: true,
        last_checked_at: '2026-09-03T10:00:00Z',
      },
      // Checked 8 hours ago: due under the 6h fee policy.
      {
        id: 'fee-due',
        source_url: 'https://a/fees2',
        country_id: 'ca',
        visa_type_id: null,
        role: 'fees',
        active: true,
        last_checked_at: '2026-09-03T04:00:00Z',
      },
      // Checked 8 hours ago: NOT due under the 1-day default.
      {
        id: 'req-fresh',
        source_url: 'https://a/req',
        country_id: 'ca',
        visa_type_id: null,
        role: 'requirements',
        active: true,
        last_checked_at: '2026-09-03T04:00:00Z',
      },
      // Never checked: always due.
      {
        id: 'never',
        source_url: 'https://a/new',
        country_id: 'ca',
        visa_type_id: null,
        role: 'requirements',
        active: true,
        last_checked_at: null,
      },
    ]);

    const due = await svc(fake).dueSources(100, now);
    const ids = due.map((d) => d.sourceId).sort();
    expect(ids).toEqual(['fee-due', 'never']);
    expect(due.find((d) => d.sourceId === 'fee-due')!.riskClass).toBe(
      'volatile',
    );
  });
});

describe('sweepStale', () => {
  it('raises a review item per stale source, at a severity matching its risk class', async () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const fake = db().seed('visa_sources', [
      {
        id: 'fee-stale',
        country_id: 'ca',
        visa_type_id: null,
        role: 'fees',
        canonical_url: 'https://a/fees',
        authority: 'IRCC',
        active: true,
        last_checked_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'req-stale',
        country_id: 'ca',
        visa_type_id: null,
        role: 'requirements',
        canonical_url: 'https://a/req',
        authority: 'IRCC',
        active: true,
        last_checked_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'fresh',
        country_id: 'ca',
        visa_type_id: null,
        role: 'requirements',
        canonical_url: 'https://a/ok',
        authority: 'IRCC',
        active: true,
        last_checked_at: '2026-09-03T00:00:00Z',
      },
    ]);

    const result = await svc(fake).sweepStale(now);
    expect(result.stale).toBe(2);
    const items = fake.tables.kb_review_queue;
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.source_id === 'fee-stale')!.severity).toBe(
      'high',
    );
    expect(items.find((i) => i.source_id === 'req-stale')!.severity).toBe(
      'medium',
    );
  });

  it('bumps an occurrence rather than filing a second ticket on the next sweep', async () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const fake = db().seed('visa_sources', [
      {
        id: 's1',
        country_id: 'ca',
        visa_type_id: null,
        role: 'requirements',
        canonical_url: 'https://a/x',
        authority: 'IRCC',
        active: true,
        last_checked_at: '2026-01-01T00:00:00Z',
      },
    ]);
    const s = svc(fake);
    await s.sweepStale(now);
    await s.sweepStale(now);
    expect(fake.tables.kb_review_queue).toHaveLength(1);
    expect(fake.tables.kb_review_queue[0].occurrences).toBe(2);
  });
});

describe('coverageReport', () => {
  function coverageDb() {
    const now = new Date().toISOString();
    return db()
      .seed('visa_countries', [
        { id: 'ca', code: 'CA', name: 'Canada', support_state: 'supported' },
        { id: 'au', code: 'AU', name: 'Australia', support_state: 'supported' },
      ])
      .seed('visa_types', [
        {
          id: 'trv',
          country_id: 'ca',
          official_name: 'Visitor visa',
          slug: 'visitor',
          lifecycle_state: 'active',
        },
        {
          id: 'study',
          country_id: 'ca',
          official_name: 'Study permit',
          slug: 'study',
          lifecycle_state: 'active',
        },
        {
          id: 'v600',
          country_id: 'au',
          official_name: 'Visitor (600)',
          slug: 'visitor-600',
          lifecycle_state: 'active',
        },
        {
          id: 'gone',
          country_id: 'ca',
          official_name: 'Retired route',
          slug: 'retired',
          lifecycle_state: 'discontinued',
        },
      ])
      .seed('visa_sources', [
        {
          id: 'src-trv',
          country_id: 'ca',
          visa_type_id: 'trv',
          active: true,
          last_checked_at: now,
          freshness_sla: '30 days',
        },
        {
          id: 'src-study',
          country_id: 'ca',
          visa_type_id: 'study',
          active: true,
          last_checked_at: now,
          freshness_sla: '30 days',
        },
      ])
      .seed('kb_chunks', [
        {
          source_id: 'src-trv',
          country_id: 'ca',
          visa_type_id: 'trv',
          text_sha256: 'sha-1',
          status: 'current',
        },
        {
          source_id: 'src-trv',
          country_id: 'ca',
          visa_type_id: 'trv',
          text_sha256: 'sha-2',
          status: 'current',
        },
        {
          source_id: 'src-trv',
          country_id: 'ca',
          visa_type_id: 'trv',
          text_sha256: 'sha-old',
          status: 'superseded',
        },
      ])
      .seed('kb_embeddings', [{ text_sha256: 'sha-1' }]);
  }

  it('separates "no source registered" from "sources but nothing indexed"', async () => {
    // Different owners: the first is research, the second is engineering.
    const report = await svc(coverageDb()).coverageReport();

    expect(report.visaTypesWithoutAnySource).toContainEqual(
      expect.objectContaining({ country: 'AU', visaType: 'Visitor (600)' }),
    );
    expect(report.visaTypesWithSourcesButNoChunks).toContainEqual(
      expect.objectContaining({ country: 'CA', visaType: 'Study permit' }),
    );
  });

  it('ignores discontinued routes', async () => {
    const report = await svc(coverageDb()).coverageReport();
    expect(report.rows.some((r) => r.visaTypeSlug === 'retired')).toBe(false);
    expect(report.supportedVisaTypes).toBe(3);
  });

  it('counts only current chunks, and reports how many are actually embedded', async () => {
    const report = await svc(coverageDb()).coverageReport();
    const trv = report.rows.find((r) => r.visaTypeSlug === 'visitor')!;
    expect(trv.chunkCount).toBe(2);
    // An unembedded chunk is invisible to the vector arm — reported apart.
    expect(trv.embeddedChunkCount).toBe(1);
  });

  it('names countries with no registered source at all', async () => {
    const report = await svc(coverageDb()).coverageReport();
    expect(report.countriesWithoutAnySource).toEqual(['AU']);
  });

  it('files both gap classes as review items', async () => {
    const fake = coverageDb();
    const raised = await svc(fake).raiseCoverageGaps();
    expect(raised).toBeGreaterThanOrEqual(2);
    const kinds = fake.tables.kb_review_queue.map((i) => i.kind);
    expect(new Set(kinds)).toEqual(new Set(['coverage_gap']));
    const severities = fake.tables.kb_review_queue.map((i) => i.severity);
    expect(severities).toContain('high');
    expect(severities).toContain('medium');
  });
});

describe('propagateChange', () => {
  function changeDb(classification: string, requiresReview: boolean) {
    return db()
      .seed('visa_source_changes', [
        {
          id: 'chg-1',
          source_id: 'src-1',
          from_version_id: 'v1',
          to_version_id: 'v2',
          classification,
          requires_review: requiresReview,
          summary: 'Fee changed',
          state: 'detected',
        },
      ])
      .seed('visa_sources', [
        {
          id: 'src-1',
          country_id: 'ca',
          visa_type_id: 'trv',
          role: 'fees',
          canonical_url: 'https://a/fees',
          authority: 'IRCC',
        },
      ])
      .seed('kb_chunks', [
        {
          id: 'k1',
          source_id: 'src-1',
          visa_type_id: 'trv',
          status: 'current',
        },
        {
          id: 'k2',
          source_id: 'src-1',
          visa_type_id: 'trv',
          status: 'current',
        },
        {
          id: 'other',
          source_id: 'src-2',
          visa_type_id: 'study',
          status: 'current',
        },
      ]);
  }

  it('invalidates only the affected source, never the whole corpus', async () => {
    const fake = changeDb('material', true);
    const result = await svc(fake).propagateChange('chg-1');
    expect(result.affectedChunks).toBe(2);
    expect(result.affectedVisaTypes).toBe(1);
  });

  it('queues an idempotent re-index of the new version', async () => {
    const fake = changeDb('material', true);
    const s = svc(fake);
    await s.propagateChange('chg-1');
    await s.propagateChange('chg-1');
    const jobs = fake.tables.kb_ingestion_jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotency_key).toBe('reindex:v2');
    expect(jobs[0].kind).toBe('reindex');
  });

  it('raises a review item for a material change', async () => {
    const fake = changeDb('material', true);
    const result = await svc(fake).propagateChange('chg-1');
    expect(result.reviewRaised).toBe(true);
    const item = fake.tables.kb_review_queue[0];
    expect(item.kind).toBe('material_change');
    expect(item.severity).toBe('high');
    expect(item.detail).toMatch(/previously reviewed version keeps serving/);
  });

  it('re-indexes a cosmetic change without paging anyone', async () => {
    // The whole point of the normalized hash: a CSS refresh wakes nobody.
    const fake = changeDb('cosmetic', false);
    const result = await svc(fake).propagateChange('chg-1');
    expect(result.reindexQueued).toBe(true);
    expect(result.reviewRaised).toBe(false);
    expect(fake.tables.kb_review_queue ?? []).toHaveLength(0);
  });
});
