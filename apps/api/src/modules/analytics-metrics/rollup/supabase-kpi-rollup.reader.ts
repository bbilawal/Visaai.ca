import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import { monthlyEquivCents } from '../../subscriptions/subscription.constants';
import { pageRows } from '../../shared/supabase/page-rows';
import type {
  KpiRollupReader,
  FunnelDailyRow,
  IdentityLink,
} from './kpi-rollup.service';
import type { CohortReader, CohortRow } from './kpi-cohort.service';

function dayOf(iso: string): string {
  return String(iso).slice(0, 10);
}
function sinceIso(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

/**
 * Concrete rollup source reader (replaces NoopKpiRollupReader). Reads bounded
 * lookback windows from the raw analytics + operational tables and aggregates in
 * JS. Read-only; SupabaseKpiWriter persists. Row shapes match the frozen
 * KpiRollupReader/CohortReader ports exactly.
 */
@Injectable()
export class SupabaseKpiRollupReader implements KpiRollupReader, CohortReader {
  constructor(private readonly supabase: SupabaseService) {}
  private get db() {
    return this.supabase.admin;
  }

  /**
   * KPI-001: every read in this file is paged.
   *
   * PostgREST silently truncates an unbounded select at PGRST_DB_MAX_ROWS
   * (1000 on the self-hosted stack) — no error, no flag, just a prefix. Every
   * method here then sums, counts or groups those rows in JavaScript, so each
   * one was correct only while its table held under a thousand rows and quietly
   * wrong, always downward, forever after. These are the numbers the business
   * is steered by: MRR, active subscribers, funnel conversion, churn, take
   * rate. A revenue figure that stops rising is worse than no figure.
   *
   * Ordered by the primary key so `.range()` paging is stable while the tables
   * are being written. `analytics_event_stream` is keyed on
   * (event_id, occurred_at); `event_id` is selected only to sort on it.
   */
  private events(names: string[], days: number): Promise<any[]> {
    return pageRows<any>(
      () =>
        this.db
          .from('analytics_event_stream')
          .select('event_id, name, occurred_at, user_id, anonymous_id, props')
          .in('name', names)
          .gte('occurred_at', sinceIso(days))
          .order('occurred_at', { ascending: true })
          .order('event_id', { ascending: true }) as never,
    );
  }

  async churnEventsSince(
    days: number,
  ): Promise<
    { subscriptionId: string; day: string; kind: 'voluntary' | 'involuntary' }[]
  > {
    const voluntary = (await this.events(['subscription.canceled'], days)).map(
      (e) => ({
        subscriptionId: String(e.props?.subscription_id ?? ''),
        day: dayOf(e.occurred_at),
        kind: 'voluntary' as const,
      }),
    );
    // Involuntary churn: dunning rows that reached the canceled terminal state.
    const dunning = await pageRows<any>(
      () =>
        this.db
          .from('payment_dunning')
          .select('subscription_id, status, updated_at')
          .eq('status', 'canceled')
          .gte('updated_at', sinceIso(days))
          .order('subscription_id', { ascending: true }) as never,
    );
    const involuntary = dunning.map((d: any) => ({
      subscriptionId: String(d.subscription_id),
      day: dayOf(d.updated_at),
      kind: 'involuntary' as const,
    }));
    return [...voluntary, ...involuntary].filter((r) => r.subscriptionId);
  }

  async activeAtStart(
    days: number,
  ): Promise<{ day: string; dimVal: string; value: number }[]> {
    const rows = await pageRows<{ status: string }>(
      () =>
        this.db
          .from('subscriptions')
          .select('id, status')
          .in('status', ['active', 'trialing'])
          .order('id', { ascending: true }) as never,
    );
    return [{ day: dayOf(sinceIso(days)), dimVal: '', value: rows.length }];
  }

  async identifiedSince(days: number): Promise<IdentityLink[]> {
    return (await this.events(['user.identified'], days))
      .filter((e) => e.anonymous_id && e.user_id)
      .map((e) => ({ anonymousId: e.anonymous_id, userId: e.user_id }));
  }

  async funnelCountsSince(days: number): Promise<FunnelDailyRow[]> {
    const rows = await this.events(
      [
        'application.created',
        'application.stage_advanced',
        'application.completed',
      ],
      days,
    );
    const STEP: Record<
      string,
      { funnel: string; step: string; stepIndex: number }
    > = {
      'application.created': {
        funnel: 'application',
        step: 'created',
        stepIndex: 0,
      },
      'application.stage_advanced': {
        funnel: 'application',
        step: 'advanced',
        stepIndex: 1,
      },
      'application.completed': {
        funnel: 'application',
        step: 'completed',
        stepIndex: 2,
      },
    };
    const agg = new Map<string, FunnelDailyRow>();
    for (const e of rows) {
      const meta = STEP[e.name];
      if (!meta) continue;
      const day = dayOf(e.occurred_at);
      const key = `${meta.funnel}|${meta.step}|${day}`;
      const cur = agg.get(key) ?? {
        funnel: meta.funnel,
        step: meta.step,
        stepIndex: meta.stepIndex,
        day,
        dimKey: '',
        dimVal: '',
        entered: 0,
        converted: 0,
      };
      cur.entered += 1;
      cur.converted += 1;
      agg.set(key, cur);
    }
    return [...agg.values()];
  }

  async mrrSnapshot(
    _days: number,
  ): Promise<{ day: string; dimVal: string; value: number }[]> {
    const rows = await pageRows<any>(
      () =>
        this.db
          .from('subscriptions')
          .select('id, plan, status, billing_interval')
          .in('status', ['active', 'trialing'])
          .order('id', { ascending: true }) as never,
    );
    const cents = rows.reduce(
      (s: number, r: any) => s + monthlyEquivCents(r.plan, r.billing_interval),
      0,
    );
    return [{ day: dayOf(new Date().toISOString()), dimVal: '', value: cents }];
  }

  async commissionSplitsSince(days: number): Promise<
    {
      day: string;
      consultantId: string;
      grossCents: number;
      payoutCents: number;
    }[]
  > {
    // consultant_service_orders persists the split at checkout (gross + payout),
    // computed from commission rules — the authoritative take-rate source (COR-1).
    const rows = await pageRows<any>(
      () =>
        this.db
          .from('consultant_service_orders')
          .select(
            'id, consultant_id, amount_usd, consultant_payout_usd, status, paid_at, created_at',
          )
          .eq('status', 'paid')
          .gte('created_at', sinceIso(days))
          .order('id', { ascending: true }) as never,
    );
    return rows.map((o: any) => ({
      day: dayOf(o.paid_at ?? o.created_at),
      consultantId: String(o.consultant_id),
      grossCents: Math.round(Number(o.amount_usd) * 100),
      payoutCents: Math.round(Number(o.consultant_payout_usd) * 100),
    }));
  }

  async subscriptionCohorts(): Promise<CohortRow[]> {
    const rows = await pageRows<any>(
      () =>
        this.db
          .from('subscriptions')
          .select('id, status, billing_interval, plan, created_at')
          .order('id', { ascending: true }) as never,
    );
    const byMonth = new Map<
      string,
      { size: number; retained: number; cents: number }
    >();
    for (const s of rows) {
      const month = `${String(s.created_at).slice(0, 7)}-01`;
      const cur = byMonth.get(month) ?? { size: 0, retained: 0, cents: 0 };
      cur.size += 1;
      if (s.status === 'active' || s.status === 'trialing') {
        cur.retained += 1;
        cur.cents += monthlyEquivCents(s.plan, s.billing_interval);
      }
      byMonth.set(month, cur);
    }
    return [...byMonth.entries()].map(([cohortMonth, v]) => ({
      cohortMonth,
      periodIndex: 0,
      dimKey: '',
      dimVal: '',
      cohortSize: v.size,
      retained: v.retained,
      retainedCents: v.cents,
    }));
  }
}
