-- Promote Norway's skilled worker permit: 14 requirements. Norway has 3 pages.
--
-- THE NEAR-MISS WORTH RECORDING
--
-- This page is 30,600 characters describing FIVE worker categories behind a
-- selector — skilled workers, athletes and coaches, seafarers, assignment
-- workers, seasonal workers — which the normalizer flattens into one stream.
--
-- The first salary figure in that stream is NOK 341,373 per year. It belongs to
-- ATHLETES AND COACHES. Recording it as the skilled worker pay threshold would
-- have been verbatim, would have passed scripts/verify-excerpts.ts, and would
-- have been wrong.
--
-- That is the limit of the excerpt check, stated plainly because it is easy to
-- over-trust: it proves a quote is ON the page. It cannot prove the quote is
-- about the right subject. Only bounding the section does that, and the
-- extraction file records the exact character range used.
--
-- Within the skilled worker block there is NO salary figure. UDI states the
-- rule qualitatively — "the pay and working conditions must not be poorer than
-- is normal in norway" — and that is what is recorded.
--
-- ONE ENTRY IS NOT A REQUIREMENT AND IS RECORDED ANYWAY
--
-- `documentation_scrutiny_warning` quotes UDI saying it is difficult to obtain
-- this permit at vocational level in the restaurant, automotive and
-- construction industries, following fraudulent documentation. It names
-- specific trades and issuing countries.
--
-- It is officially_required = false because nobody can satisfy it — it
-- describes how applications are assessed, not a condition. It is recorded
-- because a carpenter or chef from one of those countries deserves to know
-- before paying a non-refundable fee. Omitting it would make the checklist
-- read easier than the process is.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'no-skilled-worker' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'no-skilled-worker'
  and exists (select 1 from public.visa_requirements r
              where r.visa_type_id = t.id and r.status = 'active');

do $$
declare bad int;
begin
  select count(*) into bad from public.visa_requirements
  where status = 'active'
    and (source_version_id is null or source_excerpt is null or source_excerpt = ''
         or (kind = 'recommended' and officially_required));
  if bad > 0 then raise exception '% active requirement(s) lack provenance.', bad; end if;
end $$;

commit;
