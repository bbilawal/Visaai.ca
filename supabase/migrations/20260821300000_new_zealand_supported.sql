-- Move New Zealand from 'preview' to 'supported'.
--
-- I set it to 'preview' one migration ago, reasoning that one visa type is not
-- a supported destination. Checking how the flag is actually used across the
-- registry shows that is not the distinction it draws:
--
--   AU  preview     10 types,  0 with requirements
--   CA  supported    7 types,  7 with requirements
--   GB  supported    6 types,  6 with requirements
--   US  supported    9 types,  3 with requirements
--   NZ  preview      1 type,   1 with requirements
--
-- The line is "does this country have ANY sourced requirements", not "is
-- coverage broad". The United States is supported on 3 of 9. New Zealand is at
-- 1 of 1 — proportionally the most complete country in the registry.
--
-- Breadth is already handled, and handled better, by the view itself:
-- `visa_publishable_pages` requires each page to have at least one active
-- officially-required requirement AND at least one active source, so a visa
-- type with nothing behind it simply does not publish. Gating the whole COUNTRY
-- on top of that suppresses a page that is, per-page, exactly as well-sourced
-- as any Canadian one — 16 requirements, every excerpt verified verbatim
-- against the live INZ page.
--
-- Being cautious in a way that hides verified work is not caution, it is just
-- inconsistency with a cost.

update public.visa_countries
set support_state = 'supported',
    last_verified_at = '2026-08-21'::timestamptz
where code = 'NZ';

do $$
declare n int;
begin
  select count(*) into n from public.visa_publishable_pages where country_code = 'NZ';
  if n <> 1 then
    raise exception 'Expected New Zealand to publish exactly 1 page, found %.', n;
  end if;
end $$;
