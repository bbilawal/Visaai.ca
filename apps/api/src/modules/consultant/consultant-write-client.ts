import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { Env } from '../../config/configuration';
import type {
  ConsultantApproval,
  ConsultantAssignment,
  ConsultantDecisionInput,
} from '@visaai/types';

/**
 * Phase-2 HOOK — UNUSED in Phase 1. The RLS-safe write surface that will replace
 * service-role writes once a request-scoped RLS client is threaded through.
 * Defined now to fix the architectural seam; intentionally NOT implemented or
 * wired yet.
 */
export interface IRlsSafeConsultantWriteClient {
  writeAssignment(
    applicationId: string,
    consultantId: string,
  ): Promise<ConsultantAssignment>;
  updateConsultantDecision(
    input: ConsultantDecisionInput,
  ): Promise<ConsultantApproval>;
}

/**
 * ConsultantWriteClient — the single seam for the consultant data layer's write
 * client. It encapsulates `supabase.admin` so the service-role -> RLS-safe
 * migration is one localized change later.
 *
 * Phase 1 (now): ALWAYS returns the service-role client — ZERO behavior change.
 * The LEGACY_AUTOMATION_WRITE_ENABLED flag selects the strategy; the non-legacy
 * branch is a placeholder that still returns service-role until the RLS-safe
 * client is wired (Phase 2). No `supabase.admin` is removed, no RLS migration,
 * no RBAC change here — pure encapsulation.
 */
@Injectable()
export class ConsultantWriteClient {
  /** true = explicit service-role (legacy). false/default = Phase-2 RLS path (stubbed to service-role for now). */
  readonly serviceRoleMode: boolean;

  constructor(
    private readonly supabase: SupabaseService,
    config: ConfigService<Env>,
  ) {
    // configuration.ts transforms this env var to a boolean.
    this.serviceRoleMode =
      config.get('LEGACY_AUTOMATION_WRITE_ENABLED', { infer: true }) === true;
  }

  /**
   * Client for consultant_assignments / consultant_approvals operations.
   * Phase 1: service-role in BOTH branches (behavior unchanged). The false
   * branch marks exactly where the RLS-safe client plugs in (Phase 2).
   */
  get client(): SupabaseClient {
    if (this.serviceRoleMode) {
      return this.supabase.admin; // explicit legacy service-role path
    }
    // Phase 2 seam: a request-scoped RLS client will be returned here.
    // Until wired, fall back to service-role so Phase 1 behavior is identical.
    return this.supabase.admin;
  }
}
