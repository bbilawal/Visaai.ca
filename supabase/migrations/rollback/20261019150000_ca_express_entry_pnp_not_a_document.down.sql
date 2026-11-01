-- Rollback for 20261019150000_ca_express_entry_pnp_not_a_document.sql
-- Restores the row's extracted kind and description. Deleted checklist rows
-- are NOT restored: a rebuild recreates them from the restored requirement.
begin;

update public.visa_requirements r
   set kind = 'recommended',
       description = 'IRCC presents this as an option, not a requirement: a candidate eligible for one of the three Express Entry programs may also apply through Express Entry for the Provincial Nominee Program, and a nomination earns extra points. PNP criteria are set by each province and were not read.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-express-entry'
   and r.requirement_code = 'provincial_nominee_program';

commit;
