import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PartnerPrincipal } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { PartnerErrors } from './partner-errors';
import {
  idempotencyExpiry,
  idempotencyRequestHash,
  isValidIdempotencyKey,
} from './partner-governance';
import { PARTNER_REPOSITORY } from './partner.tokens';
import type { IPartnerRepository } from './partner.repository';

/**
 * Idempotent execution of a mutating operation.
 *
 * A partner retrying a POST after a timeout must not create two applications.
 * The rules, in the order they are checked:
 *
 *   same key + same body + completed  → return the stored response, do nothing
 *   same key + same body + in flight  → 409, retry shortly (do NOT run twice)
 *   same key + different body         → 409, this is a client bug
 *   new key                           → claim it, run, store the response
 *
 * A failed operation RELEASES the key. Leaving it claimed would mean a single
 * transient 500 poisons that key for 24 hours and the partner can never retry
 * the request they meant to make.
 */
@Injectable()
export class PartnerIdempotencyService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PARTNER_REPOSITORY) private readonly repo: IPartnerRepository,
  ) {}

  private get db(): SupabaseClient {
    return this.supabase.admin;
  }

  async run<T>(
    principal: PartnerPrincipal,
    key: string | undefined,
    method: string,
    routeTemplate: string,
    body: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    // Idempotency is opt-in. Requiring a key on every POST would break every
    // partner's first integration attempt for a benefit they did not ask for.
    if (!key) return operation();

    if (!isValidIdempotencyKey(key)) {
      throw PartnerErrors.invalidRequest(
        'Idempotency-Key must be 1–255 characters of letters, digits, dot, colon, underscore or hyphen.',
        'Idempotency-Key',
      );
    }

    const hash = idempotencyRequestHash(method, routeTemplate, body);
    const claim = await this.repo.claimIdempotencyKey(
      this.db,
      principal.applicationId,
      key,
      hash,
      routeTemplate,
      idempotencyExpiry(new Date()),
    );

    if (!claim.claimed) {
      const existing = claim.existing;
      if (existing.request_hash !== hash)
        throw PartnerErrors.idempotencyMismatch();
      if (existing.state === 'in_progress')
        throw PartnerErrors.idempotencyInFlight();
      return existing.response_body as T;
    }

    try {
      const result = await operation();
      await this.repo.completeIdempotencyKey(
        this.db,
        principal.applicationId,
        key,
        200,
        result,
      );
      return result;
    } catch (err) {
      await this.repo.releaseIdempotencyKey(
        this.db,
        principal.applicationId,
        key,
      );
      throw err;
    }
  }
}
