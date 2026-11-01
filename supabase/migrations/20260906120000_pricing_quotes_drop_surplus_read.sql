-- ===========================================================================
-- SEC-4092b : pricing_quotes — remove a read grant nothing uses
-- ===========================================================================
-- SEC-4092 (20260816120000) found `pricing_quotes` readable by the anonymous
-- role and narrowed it to `authenticated`, with the policy body left as
-- `using (true)`. Its own comment called that "still broad", and it is: every
-- signed-up user can read every row, and the table carries `gross_margin`,
-- `total_cogs` and `floor_price` — commercial-confidential figures that say
-- exactly what the platform's costs and margins are on every corridor.
--
-- The grant turns out to be pure surplus. Verified at 20260906:
--
--   * `apps/web` never reads `pricing_quotes` — 0 references anywhere in the
--     app, so no page depends on a user-scoped read.
--   * `apps/api` reads it in exactly three places, all in
--     `pricing.repository.impl.ts`, and all through `this.supabase.admin`.
--     Service-role bypasses RLS, so the API is unaffected by any policy here.
--   * the public pricing page reaches this data through `GET /pricing/quotes`,
--     which is served by that same service-role path.
--
-- So the policy authorises a read that no code performs, on data no user needs.
-- Dropping it leaves the table service-role-only, which is what every consumer
-- already assumes.
--
-- To restore (see rollback/), recreate the policy exactly as SEC-4092 had it.

drop policy if exists quotes_read on public.pricing_quotes;

-- RLS stays enabled: with no policy and no bypass, the table denies all
-- non-service-role access, which is the intended end state.
