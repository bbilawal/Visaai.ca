-- Let a source check say "this page is rendered by script" instead of calling
-- it a parser failure.
--
-- `visa_source_checks.status` allowed ok / changed / unavailable / blocked /
-- parse_error / redirected. A 200 response whose body is a script mount point
-- and nothing else had only one bucket to fall into: parse_error — which the
-- coverage matrix defines as "sources are reachable but the extractor could not
-- produce usable text. This IS a VisaAI bug and belongs in the parser backlog."
--
-- `esta.cbp.dhs.gov` filed exactly that on every run, 34 times in a week, for a
-- page whose body is one `<app-root>` element and three script tags. Nothing in
-- the parser backlog can fix a page that has no text to parse.
--
-- The cost is that a permanently-red signal stops being read, and parse_error is
-- the same bucket that carried the eight genuine New Zealand failures behind
-- B-23. A status that cannot distinguish "we are broken" from "there is nothing
-- here to read" makes both invisible.

alter table public.visa_source_checks
  drop constraint if exists visa_source_checks_status_check;

alter table public.visa_source_checks
  add constraint visa_source_checks_status_check
  check (status = any (array[
    'ok', 'changed', 'unavailable', 'blocked',
    'parse_error', 'redirected', 'client_rendered'
  ]));

comment on column public.visa_source_checks.status is
  'ok | changed | unavailable | blocked | parse_error | redirected | client_rendered. '
  'parse_error means WE could not read a page that has text; client_rendered means '
  'the page has no server-rendered text to read. Keeping them apart is what stops a '
  'permanently-red signal from burying the fixable failures.';

-- Historical rows are NOT rewritten. They record what the system believed at
-- the time, and editing that away would make the change invisible in exactly
-- the data someone would use to understand it.

do $$
declare allowed integer;
begin
  select count(*) into allowed
    from pg_constraint
   where conrelid = 'public.visa_source_checks'::regclass
     and conname = 'visa_source_checks_status_check'
     and pg_get_constraintdef(oid) like '%client_rendered%';

  if allowed <> 1 then
    raise exception 'client_rendered was not added to the status constraint';
  end if;

  raise notice 'visa_source_checks.status now accepts client_rendered';
end $$;
