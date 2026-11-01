import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { IExecutionTokenStore } from './execution-token.store';

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Supabase-backed single-use ledger. The PRIMARY KEY on token_hash is the
 * atomic gate: the first insert wins (true); a duplicate violates the PK and is
 * reported as replay (false). Service-role (admin) — execution is a system path.
 * No constructor side effects.
 */
@Injectable()
export class ExecutionTokenStore implements IExecutionTokenStore {
  constructor(private readonly supabase: SupabaseService) {}

  async consume(tokenHash: string, applicationId: string): Promise<boolean> {
    const { error } = await this.supabase.admin
      .from('consumed_readback_tokens')
      .insert({ token_hash: tokenHash, application_id: applicationId });
    if (!error) return true;
    if (error.code === PG_UNIQUE_VIOLATION) return false; // already consumed -> replay
    throw new Error(`consume failed: ${error.message}`);
  }
}
