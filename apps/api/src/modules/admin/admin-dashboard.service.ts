import { Injectable } from '@nestjs/common';
import type {
  AdminDashboard,
  AdminDashboardRaw,
  DashboardRange,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { shapeDashboard } from './dashboard';
import { pageRows, toError } from '../shared/supabase/page-rows';

const DAYS: Record<DashboardRange, number> = { '7d': 7, '30d': 30, '90d': 90 };
const STATUSES = ['draft', 'ready', 'submitted', 'decided'] as const;

/**
 * The slice of the PostgREST builder these counts actually use.
 *
 * `build` was `(q: any) => any`, which made every filter in this method an
 * unsafe-any call — the lint errors were noise that hid real ones. Naming the
 * three methods used is enough to type the chain end to end, and it fails the
 * build if a filter is misspelled, which `any` did not.
 */
/** The AI-usage columns this aggregate reads. */
interface AiUsageRow {
  input_tokens: number | null;
  output_tokens: number | null;
  request_cost_usd: string | number | null;
  billable_cost_usd: string | number | null;
}

interface AiTotals {
  inputTokens: number;
  outputTokens: number;
  requestCostUsd: number;
  billableCostUsd: number;
}

interface CountQuery extends PromiseLike<{
  count: number | null;
  error: unknown;
}> {
  not: (column: string, operator: string, value: unknown) => CountQuery;
  gte: (column: string, value: string) => CountQuery;
  eq: (column: string, value: unknown) => CountQuery;
}

@Injectable()
export class AdminDashboardService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Coerce any input to a valid range (default 30d). */
  static coerceRange(input: unknown): DashboardRange {
    return input === '7d' || input === '90d' ? input : '30d';
  }

  async getDashboard(range: DashboardRange): Promise<AdminDashboard> {
    return shapeDashboard(await this.collectRaw(range), range);
  }

  private async collectRaw(range: DashboardRange): Promise<AdminDashboardRaw> {
    const db = this.supabase.admin;
    const sinceIso = new Date(
      Date.now() - DAYS[range] * 86_400_000,
    ).toISOString();
    const count = async (
      table: string,
      build: (q: CountQuery) => CountQuery = (q) => q,
    ): Promise<number> => {
      // Throw on a returned error so the outer catch reports dbReachable=false.
      // supabase-js resolves DB errors as { error } rather than rejecting, so a
      // silent `c ?? 0` would otherwise yield all-zeros under a "healthy" flag.
      const { count: c, error } = await build(
        // Load-bearing: without it TS resolves the full PostgREST builder type
        // and gives up with TS2589 (excessively deep). `eslint --fix` will
        // happily delete this as "unnecessary" — it is not.
        /* eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion */
        db.from(table).select('*', {
          count: 'exact',
          head: true,
        }) as unknown as CountQuery,
      );
      if (error) throw toError(error);
      return c ?? 0;
    };

    try {
      // REG-001: REGISTERED users, not sessions.
      //
      // This counted every row in `users`, and a guest who opens the funnel
      // gets one: the app issues Supabase ANONYMOUS identities so an applicant
      // can start before signing up. On production 2026-09-06 that made the
      // executive "Users" tile read 50 when 15 people had actually registered —
      // 35 of the rows were anonymous sessions. An exec metric wrong by 3.3x is
      // worse than no metric, because it is acted on.
      //
      // An anonymous identity has no email and a registered one always does
      // (signup is email/password or OAuth), so the column is the discriminator
      // and it needs no join onto `auth.users`. Verified against the source of
      // truth the same day: auth.users had is_anonymous=true for exactly the 35
      // rows with a null email, and false for exactly the 15 with one.
      const usersTotal = await count('users', (q) =>
        q.not('email', 'is', null),
      );
      const usersNew = await count('users', (q) =>
        q.not('email', 'is', null).gte('created_at', sinceIso),
      );
      // ACTIVE consultants. `consultant_profiles.active_status` is one of
      // draft/pending_review/active/suspended, and counting all four put people
      // who abandoned onboarding, and people who were banned, on the executive
      // "Consultants" tile alongside working consultants — the same shape as
      // REG-001 counting guest sessions as registered users.
      const consultants = await count('consultant_profiles', (q) =>
        q.eq('active_status', 'active'),
      );

      const appsByStatus: Record<string, number> = {};
      for (const s of STATUSES) {
        appsByStatus[s] = await count('applications', (q) => q.eq('status', s));
      }

      // AI usage over range — fetch the numeric columns and sum in app code.
      // (Acceptable at current scale; revisit with a SQL aggregate/RPC if slow.)
      //
      // DASH-002: paged, because an unbounded select stops at PGRST_DB_MAX_ROWS
      // (1000) with no error. This is a per-REQUEST event table, so it is the
      // first table here to cross that line, and when it does the AI spend tile
      // stops rising — reporting the cost of the first 1000 calls in the window
      // as the cost of the window. Under-reporting spend is the failure nobody
      // investigates.
      const aiRows = await pageRows<AiUsageRow>(
        () =>
          db
            .from('ai_usage_events')
            .select(
              'input_tokens, output_tokens, request_cost_usd, billable_cost_usd',
            )
            .gte('created_at', sinceIso) as never,
      );
      const ai = aiRows.reduce<AiTotals>(
        (a, r) => ({
          inputTokens: a.inputTokens + (r.input_tokens ?? 0),
          outputTokens: a.outputTokens + (r.output_tokens ?? 0),
          requestCostUsd: a.requestCostUsd + Number(r.request_cost_usd ?? 0),
          billableCostUsd: a.billableCostUsd + Number(r.billable_cost_usd ?? 0),
        }),
        {
          inputTokens: 0,
          outputTokens: 0,
          requestCostUsd: 0,
          billableCostUsd: 0,
        },
      );

      const payRows = await pageRows<{ plan_tier: string | null }>(
        () =>
          db
            .from('payments')
            .select('plan_tier')
            .eq('status', 'complete')
            .gte('created_at', sinceIso) as never,
      );
      const paymentsByTier: Record<string, number> = {};
      for (const r of payRows) {
        const t = r.plan_tier;
        if (!t) continue;
        paymentsByTier[t] = (paymentsByTier[t] ?? 0) + 1;
      }

      const logins = await count('auth_audit_log', (q) =>
        q.eq('event_type', 'login_success').gte('created_at', sinceIso),
      );
      const lockouts = await count('auth_audit_log', (q) =>
        q.eq('event_type', 'account_locked').gte('created_at', sinceIso),
      );

      const { data: recentActivity, error: recentErr } = await db
        .from('audit_events')
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(10);
      if (recentErr) throw recentErr;

      return {
        usersTotal,
        usersNew,
        consultants,
        appsByStatus,
        ai,
        paymentsByTier,
        security: { logins, lockouts },
        recentActivity: recentActivity ?? [],
        dbReachable: true,
      };
    } catch {
      return {
        usersTotal: 0,
        usersNew: 0,
        consultants: 0,
        appsByStatus: {},
        ai: {
          inputTokens: 0,
          outputTokens: 0,
          requestCostUsd: 0,
          billableCostUsd: 0,
        },
        paymentsByTier: {},
        security: { logins: 0, lockouts: 0 },
        recentActivity: [],
        dbReachable: false,
      };
    }
  }
}
