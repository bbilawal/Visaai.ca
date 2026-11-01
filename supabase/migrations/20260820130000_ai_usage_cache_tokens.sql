-- Record cache token counts on every metered AI call.
--
-- WHY
--
-- ai_usage_events records input_tokens / output_tokens and a derived
-- request_cost_usd. That was complete when every call ran on gpt-4o, where a
-- cached token is simply a cheaper input token and a cache write is free.
--
-- It is no longer complete. On the GPT-5.6 family:
--   - a cached input token costs 10% of an uncached one (a 90% discount, vs
--     50% on gpt-4o), and
--   - WRITING to the cache is billed, at 1.25x the uncached input rate — a
--     line item that did not previously exist.
--
-- Without these two columns, two things are impossible:
--   1. Pricing a call correctly. request_cost_usd would treat every cached
--      token as full price, overstating spend on cache-heavy paths and hiding
--      the cache-write cost on cache-cold ones.
--   2. Answering "did prompt caching pay for itself?" — the question the whole
--      caching design turns on. Cache hit ratio needs a numerator.
--
-- Both columns are nullable with a 0 default so every existing row and every
-- provider that does not report cache detail (Azure DI, per-page OCR vendors)
-- stays valid. NULL would have been the more honest "not reported", but this
-- column is summed in cost dashboards, and a NULL that silently drops rows
-- from a SUM is a worse failure than a 0 that is visibly zero.

alter table public.ai_usage_events
  add column if not exists cached_input_tokens integer not null default 0
    check (cached_input_tokens >= 0),
  add column if not exists cache_write_tokens integer not null default 0
    check (cache_write_tokens >= 0);

comment on column public.ai_usage_events.cached_input_tokens is
  'Input tokens served FROM the prompt cache. A SUBSET of input_tokens, not an '
  'addition to it — the provider reports it that way, and adding them would '
  'double-count every cached call.';

comment on column public.ai_usage_events.cache_write_tokens is
  'Tokens WRITTEN to the prompt cache. Billed separately on GPT-5.6+ '
  '(1.25x the uncached input rate); zero on earlier models.';

-- A cached count larger than the input count it is drawn from is not a small
-- error: it makes a call look cheaper than free once the discount is applied.
alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_cached_within_input;
alter table public.ai_usage_events
  add constraint ai_usage_events_cached_within_input
  check (cached_input_tokens <= input_tokens);

-- Cache-effectiveness reporting. Partial index: rows with no cache activity
-- are the majority today and are never the subject of this question.
create index if not exists ai_usage_events_cache_idx
  on public.ai_usage_events (created_at desc)
  where cached_input_tokens > 0 or cache_write_tokens > 0;
