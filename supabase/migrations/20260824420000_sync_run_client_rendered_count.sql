-- Record how many sources served a 200 with no server-rendered text.
--
-- Without its own column these fall into `parse_error_count`, which the
-- coverage matrix reports as "sources are reachable but the extractor could not
-- produce usable text. This IS a VisaAI bug and belongs in the parser backlog."
-- A page whose body is one `<app-root>` element and three script tags will never
-- be fixed by a parser change, and leaving it in that count means the number
-- never reaches zero — so nobody reads it, including on the runs when it is
-- carrying a real regression.

alter table public.visa_sync_runs
  add column if not exists client_rendered_count integer not null default 0;

comment on column public.visa_sync_runs.client_rendered_count is
  'Sources that returned 200 with no server-rendered text. Separate from '
  'parse_error_count: that one means our parser failed on a page that HAS text, '
  'this one means the page has none to read.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'visa_sync_runs' and column_name = 'client_rendered_count'
  ) then
    raise exception 'client_rendered_count was not added to visa_sync_runs';
  end if;
  raise notice 'visa_sync_runs.client_rendered_count is present';
end $$;
