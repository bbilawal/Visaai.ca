-- Retire `fee_work_residence_category_1`, which is now published twice.
--
-- It quoted the fee schedule's ROW LABEL — "annual work residence permit
-- (category 1) and family members" — as its own requirement, sitting next to
-- `fee_work_residence_category_1_amount`, which quoted the bare figure on the
-- next line. Neither was adequate on its own: the label names a thing with no
-- price, the figure names a price with no thing.
--
-- The amount requirement now quotes BOTH, joined by the declared elision, so
-- this row's entire content is contained in its sibling. Leaving it would
-- publish the same table row twice with the weaker half presented as a separate
-- requirement.
--
-- Retired rather than deleted: `status = 'retired'` is how this registry
-- withdraws a claim without erasing that it was made.

update public.visa_requirements r
   set status = 'retired', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'lb-annual-residence'
   and r.requirement_code = 'fee_work_residence_category_1'
   and r.status <> 'retired';

do $$
declare n_left integer; n_pair integer;
begin
  select count(*) into n_left from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-annual-residence'
     and r.requirement_code = 'fee_work_residence_category_1'
     and r.status <> 'retired';
  if n_left <> 0 then
    raise exception 'The redundant row-label fee is still live (found %)', n_left;
  end if;

  -- And the requirement that replaces it must carry both halves, or retiring
  -- this one loses the category name from the registry altogether.
  select count(*) into n_pair from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-annual-residence'
     and r.requirement_code = 'fee_work_residence_category_1_amount'
     and r.source_excerpt like '%annual work residence permit (category 1)%'
     and r.source_excerpt like '%108,000,000%';
  if n_pair <> 1 then
    raise exception 'The category-1 fee must quote both its label and its amount before the label row is retired (found %)', n_pair;
  end if;

  raise notice 'Retired the duplicated category-1 fee row label';
end $$;
