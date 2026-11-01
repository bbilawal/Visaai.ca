import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * DEBT-001 / RT-026 — the typed client, staged.
 *
 * `SupabaseClient` with no generic resolves to `SupabaseClient<any>`, so every
 * `.from(...).select(...)` chain returns `any`. The generated schema types are
 * now committed (`packages/types/src/database.types.ts`, 140 tables) and this
 * alias is ready:
 *
 *   export type Db = SupabaseClient<Database>;
 *
 * Binding it was MEASURED, not guessed: it compiles down to **59 type errors
 * across 19 files**, and they are real. Two samples:
 *
 *   provenance.repository.impl.ts  `string | null` assigned to `string` —
 *       OcrRun promises non-null for columns Postgres allows to be null.
 *   supabase-kpi-rollup.reader.ts  a `text` column passed where a `SubPlan`
 *       union is required — the code asserts a narrowness the schema does not
 *       enforce.
 *
 * Each one is a domain decision (is the type wrong, or the schema?), and
 * answering them with a blanket `as` cast would launder exactly the defects the
 * change exists to surface. Scoped as RT-026 with the per-file counts recorded;
 * `iam.repository.impl.ts` is already migrated as the worked example.
 *
 * Regenerate after a migration:
 *   npx supabase@latest gen types typescript --local \
 *     > packages/types/src/database.types.ts
 */
export type Db = SupabaseClient;
import type { Env } from '../../../config/configuration';

/**
 * Two distinct Supabase access modes:
 *
 *  - `admin`  : service-role key. BYPASSES Row-Level Security. Use ONLY for
 *               background jobs (BullMQ processors), inbound webhooks, and
 *               system tasks that run without a user request context.
 *
 *  - forUser(token) : anon key + the caller's access token. RLS IS ENFORCED.
 *               Use for every request-path read/write on user-owned data, so a
 *               missing `.eq('user_id', ...)` filter can never leak across tenants.
 *
 * SECURITY (F1): request handlers must prefer `forUser`. The legacy `client`
 * getter is a deprecated alias of `admin` kept only so not-yet-migrated modules
 * keep compiling; each remaining call site must be audited and moved to either
 * `admin` (if it is genuinely a background/system path) or `forUser` (if it acts
 * on behalf of a logged-in user). See VISAAIDocs strategy/02-backend-architecture.md.
 */
@Injectable()
export class SupabaseService {
  /** Service-role client. Bypasses RLS. Background jobs / webhooks only. */
  readonly admin: Db;

  private readonly url: string;
  private readonly publicUrl: string;
  private readonly anonKey: string;

  constructor(private config: ConfigService<Env>) {
    this.url = this.config.get('SUPABASE_URL', { infer: true })!;
    this.publicUrl =
      this.config.get('SUPABASE_PUBLIC_URL', { infer: true }) ?? this.url;
    this.anonKey = this.config.get('SUPABASE_ANON_KEY', { infer: true })!;

    this.admin = createClient(
      this.url,
      this.config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true })!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  /**
   * Rewrite a Storage URL so a BROWSER can actually reach it.
   *
   * WHY THIS EXISTS — MEASURED IN PRODUCTION 2026-08-13
   *
   * supabase-js builds every signed URL from the base it was constructed with.
   * On the VPS that base is `http://127.0.0.1:54421`: Kong listens on loopback,
   * so the URL is correct for this process and useless to a customer. Every
   * upload link, attachment link and generated-document link the API returned
   * pointed at the server's own loopback. Document upload — the core flow — had
   * been broken since the domain cutover, silently, because nothing on the
   * server ever follows those URLs.
   *
   * Server-side calls keep using the loopback client: it is faster, stays
   * inside the box, and does not depend on nginx. ONLY the string handed to a
   * client is rewritten, and only when it actually starts with the internal
   * base — an already-public URL, or one from another host, is returned
   * untouched rather than mangled.
   */
  toPublicStorageUrl(url: string): string {
    if (!url) return url;
    if (this.publicUrl === this.url) return url;
    if (!url.startsWith(this.url)) return url;
    return this.publicUrl.replace(/\/+$/, '') + url.slice(this.url.length);
  }

  /**
   * RLS-enforcing client scoped to a single user's access token.
   * Every query runs as that user, so Row-Level Security policies apply.
   */
  forUser(accessToken: string): Db {
    return createClient(this.url, this.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }
}
