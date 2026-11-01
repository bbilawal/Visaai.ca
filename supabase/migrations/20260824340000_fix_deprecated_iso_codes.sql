-- Correct four countries stored under ISO codes that no longer exist.
--
-- WHAT WENT WRONG
--
-- `generate-country-baseline.mjs` built its name -> code index by walking every
-- alpha-2 combination and asking `Intl.DisplayNames` what it meant. ICU answers
-- for FORMERLY-USED codes exactly as confidently as for current ones:
--
--   DY -> "Benin"          (Dahomey)
--   HV -> "Burkina Faso"   (Upper Volta)
--   FX -> "France"         (France, Metropolitan -- a subdivision)
--   YU -> "Serbia"         (Yugoslavia)
--
-- Each dead code sorts AFTER the live one, so it overwrote it, and four
-- countries entered the registry -- and production -- under the code of a state
-- that no longer exists.
--
-- WHY THE VERIFICATION DID NOT CATCH IT
--
-- The generator round-trips every code back through ICU and compares the name.
-- `DY` -> "Benin" round-trips perfectly. It is the WRONG CODE FOR THE RIGHT
-- NAME, which is exactly the class of error a self-consistency check cannot
-- see: the check and the bug shared an assumption.
--
-- What catches it now is a different question asked of the same data -- "does
-- any name resolve to more than one code?" -- with an explicit list of the 16
-- codes ISO no longer assigns, and a refusal to build the index if any
-- ambiguity survives. The list's completeness is not asserted by inspection;
-- the no-ambiguity check is the guarantee.
--
-- SAFE TO RUN
--
-- These four rows carry a name, a code and a slug and nothing else -- no
-- authority, no sources, no visa types, no requirements, and
-- `support_state = 'unsupported'` so none was ever published. Nothing
-- references them, so the correction is an update with no fan-out.

begin;

update public.visa_countries set code = 'BJ' where code = 'DY' and name = 'Benin';
update public.visa_countries set code = 'BF' where code = 'HV' and name = 'Burkina Faso';
update public.visa_countries set code = 'FR' where code = 'FX' and name = 'France';
update public.visa_countries set code = 'RS' where code = 'YU' and name = 'Serbia';

do $$
declare dead int; live int; attached int;
begin
  select count(*) into dead from public.visa_countries
   where code in ('DY', 'HV', 'FX', 'YU', 'AN', 'BU', 'CS', 'DD', 'NH', 'RH', 'SU', 'TP', 'VD', 'YD', 'ZR');
  if dead > 0 then
    raise exception '% country row(s) still use an ISO code that is no longer assigned.', dead;
  end if;

  select count(*) into live from public.visa_countries where code in ('BJ', 'BF', 'FR', 'RS');
  if live <> 4 then
    raise exception 'Expected Benin, Burkina Faso, France and Serbia under their current codes, found %.', live;
  end if;

  -- If any of the four had acquired a visa type or a source under the wrong
  -- code, an UPDATE would not be the right fix and this would say so.
  select count(*) into attached from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code in ('BJ', 'BF', 'FR', 'RS');
  if attached > 0 then
    raise notice '% visa type(s) are attached to the corrected countries; verify them.', attached;
  end if;
end $$;

commit;
