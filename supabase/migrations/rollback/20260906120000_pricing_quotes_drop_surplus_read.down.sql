-- Rollback SEC-4092b: restore the authenticated read policy exactly as
-- SEC-4092 (20260816120000) left it.
create policy quotes_read on public.pricing_quotes
  for select to authenticated
  using (true);
