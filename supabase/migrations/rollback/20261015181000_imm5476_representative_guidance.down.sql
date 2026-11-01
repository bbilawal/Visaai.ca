-- Rollback for 20261015180000_imm5476_representative_guidance.sql
-- Restores description NULL on exactly the rows that migration filled.
update public.visa_requirements r
   set description = null
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id in (
     'ca-visitor-visa-temporary-resident-visa',
     'ca-study-permit',
     'ca-work-permit'
   )
   and r.requirement_code = 'imm5476'
   and r.description like 'Required when anyone — paid or unpaid, including a friend or relative — represents you on this application.%';
