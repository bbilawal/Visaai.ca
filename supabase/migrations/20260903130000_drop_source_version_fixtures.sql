-- Remove the replay-only fixtures now that the last requirement migration has
-- run.
--
-- 20260820170000_visa_source_versions_bootstrap.sql installs a fixture table and
-- an AFTER INSERT trigger on visa_sources so that a database replaying the chain
-- from empty can satisfy visa_requirements.source_version_id. Both exist only
-- for the duration of the chain.
--
-- Dropping them matters in production. Left installed, the trigger would fire
-- when the SYNC registers a genuinely new source, and if that source's URL
-- happened to match a fixture it would be given a version dated 2026-08-25 that
-- nobody fetched in this deployment. The fixtures are evidence of what
-- production once fetched; they are not a substitute for fetching.
--
-- The versions the trigger planted stay. They are real fetch records, and the
-- sync supersedes them on its next run the moment the page differs.

begin;

drop trigger if exists visa_sources_plant_fixture_tg on public.visa_sources;
drop function if exists public.plant_source_version_fixture_tg();
drop function if exists public.plant_source_version_fixture(uuid);
drop table if exists public.visa_source_version_fixtures;

-- The skip trigger goes too, for the same reason: outside a replay, a
-- requirement with no source version must fail loudly, not be filed away.
drop trigger if exists visa_requirements_skip_unbindable_tg on public.visa_requirements;
drop function if exists public.record_unbindable_requirement();

-- public.visa_requirement_bootstrap_skips is deliberately KEPT. It is empty in
-- production and it is the only place a fresh database records which routes are
-- silent because an authority blocks our egress.

do $$
begin
  if exists (select 1 from pg_trigger
              where tgname = 'visa_sources_plant_fixture_tg'
                and not tgisinternal) then
    raise exception 'fixture trigger survived its own drop';
  end if;

  raise notice 'source version fixtures removed; % sources, % with a version',
    (select count(*) from public.visa_sources),
    (select count(distinct source_id) from public.visa_source_versions);

  raise notice 'requirements skipped for want of a fetched source: % across % visa types',
    (select count(*) from public.visa_requirement_bootstrap_skips),
    (select count(distinct visa_type_id) from public.visa_requirement_bootstrap_skips);
end $$;

commit;
