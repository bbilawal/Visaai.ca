begin;

-- Retire one published US requirement, because the authority withdrew the text
-- it quotes. This is the change monitor doing its job on a route nobody was
-- editing.
--
-- WHAT HAPPENED
--
-- `us-temporary-worker-visas` carried a requirement `h2b_single_petition_only`
-- quoting an alert on the Form I-129 page:
--
--   "alert: if you are filing a form i-129 h-2b petition, send only one
--    petition with supporting documents. do not send extra copies of the form,
--    supporting documents, or payment authorization. sending duplicates may
--    result in them being treated as separate petitions."
--
-- A full verify-excerpts run on 2026-08-25 reported it NOT VERBATIM, and a
-- re-fetch confirms why: the current I-129 page mentions H-2B only in the
-- classification list and in a link to an optional filing checklist PDF. The
-- alert is gone. USCIS withdrew it.
--
-- WHY RETIRED AND NOT REWRITTEN
--
-- There is no replacement text on the page to quote. Rewriting the requirement
-- to say the same thing in our own words would publish VisaAI's advice as a
-- government rule, which is the one thing the `recommended` kind exists to
-- prevent and which no kind permits for an authority that has stopped saying
-- it. A published requirement that misquotes its authority is worse than one
-- that is absent, because the citation makes it look checked.
--
-- ALERTS ARE TRANSIENT BY NATURE and this is the first one in the registry to
-- expire. Worth remembering when extracting: an `alert:` block is the most
-- likely thing on any government page to vanish between one sync and the next,
-- and quoting one buys a requirement with a shorter half-life than the page
-- around it.

update public.visa_requirements r
   set status = 'retired', last_verified_at = '2026-08-25'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'us-temporary-worker-visas'
   and r.requirement_code = 'h2b_single_petition_only'
   and r.status <> 'retired';

do $$
declare n_retired integer; n_active integer;
begin
  select count(*) into n_retired from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'us-temporary-worker-visas'
     and r.requirement_code = 'h2b_single_petition_only'
     and r.status = 'retired';
  if n_retired <> 1 then
    raise exception 'The withdrawn H-2B alert was not retired (found % retired row(s))', n_retired;
  end if;

  -- The route must still publish. Retiring its only remaining requirement would
  -- leave a live page with nothing on it.
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'us-temporary-worker-visas' and r.status = 'active';
  if n_active < 1 then
    raise exception 'us-temporary-worker-visas has no active requirements left';
  end if;

  raise notice 'Retired the withdrawn H-2B alert; % requirement(s) still active on the route', n_active;
end $$;

commit;
