-- France: admitted after being refused, and the refusal was about the wrong host.
--
-- WHY IT WAS REFUSED
--
-- `GLOBAL_COVERAGE_EXCEPTIONS.md` recorded France as `blocked_by_authority` on
-- solid evidence: france-visas.gouv.fr returns HTTP 403 on robots.txt from the
-- VPS and from a second egress. Identical from two paths means policy, not IP
-- reputation. That finding stands and that host stays unread.
--
-- WHY THAT WAS NOT THE END OF FRANCE
--
-- Re-probed 2026-08-24 from the VPS (docs/visa-data/BLOCKED_COUNTRY_REPROBE.md).
-- www.service-public.fr redirects to www.service-public.gouv.fr, whose
-- robots.txt returns 200 and ALLOWS the path. It is operated by DILA, the
-- Direction de l'information légale et administrative — a service of the Prime
-- Minister — and it publishes the complete foreign-nationals tree.
--
-- THE NEAR-MISS IS THE LESSON. An earlier pass did probe service-public.fr,
-- using node `N19806`. That node is "Travail - Formation" — the general
-- employment theme for everyone in France. The foreign-nationals tree is
-- `N19804`, "Étranger - Europe". One digit, an entirely different subject, and
-- a null read as absence. This is the Sweden `/English/` mistake wearing new
-- clothes: the probe found nothing because it looked in the wrong place, and
-- the nothing was recorded as a fact about the country.
--
-- WHAT KIND OF SOURCE THIS IS, STATED PLAINLY
--
-- Service-Public is the French State's official public-service publisher, not
-- the deciding authority. Préfectures decide residence permits; France-Visas
-- (Ministère de l'Europe et des Affaires étrangères) issues visas. So this is
-- an official publisher describing another body's rules, which is a weaker
-- position than the Danish Immigration Service describing its own — and it is
-- recorded in `jurisdiction_note` rather than glossed, because a reader who
-- thinks they are reading the préfecture will write to the wrong office.
--
-- Every page is server-rendered French at 8,000 to 186,000 characters, each
-- carries an `?lang=en` English variant, and every URL below was read off the
-- N19804 / N105 / N107 / N110 index pages rather than constructed.
--
-- REGISTERED AT `preview`, DELIBERATELY. Eighteen routes and eighteen sources,
-- and not one requirement yet. Promotion to `supported` happens after
-- extraction or not at all — this is the discipline `check-support-state.ts`
-- exists to enforce after Finland was marked supported on exactly this much.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, official_visa_url, official_languages,
  support_state, data_quality, jurisdiction_note, last_verified_at
) values (
  'FR', 'France', 'france',
  'Ministère de l''Intérieur (préfectures)',
  'https://www.service-public.gouv.fr/particuliers/vosdroits/N19804',
  'Ministère de l''Europe et des Affaires étrangères (France-Visas)',
  'https://www.service-public.gouv.fr/particuliers/vosdroits/N105',
  array['fr','en'],
  'preview',
  'unverified',
  'Sources are published by Service-Public.gouv.fr (DILA, a service of the Prime Minister), '
  'the French State''s official public-service publisher. DILA describes the rules; it does not '
  'decide applications. A visa is issued by France-Visas (Ministère de l''Europe et des Affaires '
  'étrangères) and a residence permit is decided by the préfecture of the applicant''s department. '
  'france-visas.gouv.fr returns HTTP 403 on robots.txt to our monitor from two separate egress '
  'paths, so it is not registered and is not read. Overseas territories (outre-mer) have entry '
  'rules of their own and are not covered by these routes.',
  '2026-08-24'::timestamptz
)
on conflict (code) do update set
  immigration_authority     = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  foreign_affairs_authority = excluded.foreign_affairs_authority,
  official_visa_url         = excluded.official_visa_url,
  official_languages        = excluded.official_languages,
  support_state             = excluded.support_state,
  jurisdiction_note         = excluded.jurisdiction_note,
  last_verified_at          = excluded.last_verified_at;

-- official_name is each page's own H1, read on 2026-08-24, never a paraphrase.
insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'FR'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-24'::timestamptz
from (values
  ('fr-visa-court-sejour', 'visitor',
   'Visa de court séjour Schengen (étranger en France pour 3 mois maximum)', 'visa-court-sejour',
   'The Schengen short-stay visa allowing up to three months in France.'),
  ('fr-visa-long-sejour', 'other',
   'Visa de long séjour (séjour de plus de 3 mois à 1 an)', 'visa-long-sejour',
   'The long-stay visa for a stay of more than three months and up to one year, including the VLS-TS which serves as a residence permit.'),
  ('fr-transit-visa', 'other',
   'Un étranger en transit en France doit-il demander un visa ?', 'transit',
   'Whether an airport or territorial transit visa is required to pass through France.'),
  ('fr-autorisation-travail-salarie', 'work',
   'Autorisation de travail d''un salarié étranger en France', 'autorisation-travail-salarie',
   'The work authorisation an employer must obtain before a foreign employee may work in France — a precondition of several residence permits rather than a permit itself.'),
  ('fr-carte-sejour-salarie', 'skilled_worker',
   'Travail d''un étranger en France : carte de séjour - salarié/travailleur temporaire', 'carte-sejour-salarie',
   'The "salarié" and "travailleur temporaire" residence permits for employed work in France.'),
  ('fr-carte-sejour-talent', 'skilled_worker',
   'Carte talent : carte de séjour pluriannuelle d''un étranger en France', 'carte-sejour-talent',
   'The multi-year "talent" residence permit, covering several distinct qualifying profiles including the EU Blue Card.'),
  ('fr-carte-sejour-talent-famille', 'dependant',
   'Carte de séjour pluriannuelle "talent-famille"', 'carte-sejour-talent-famille',
   'The derivative multi-year permit for the family of a "talent" permit holder.'),
  ('fr-carte-sejour-entrepreneur', 'entrepreneur',
   'Carte de séjour "entrepreneur/profession libérale" d''un étranger en France', 'carte-sejour-entrepreneur',
   'Residence permit for a foreign national running a business or practising a liberal profession in France.'),
  ('fr-carte-sejour-etudiant', 'student',
   'Étudiant étranger en France : visa de long séjour ou titre de séjour', 'carte-sejour-etudiant',
   'The student long-stay visa and student residence permit.'),
  ('fr-carte-sejour-stagiaire', 'exchange',
   'Stagiaire étranger en France : visa de long séjour ou carte de séjour', 'carte-sejour-stagiaire',
   'Long-stay visa and residence permit for an intern in France.'),
  ('fr-carte-sejour-recherche-emploi', 'other',
   'Carte de séjour ou VLS-TS - Recherche d''emploi/création d''entreprise', 'carte-sejour-recherche-emploi',
   'The post-study permit allowing a graduate to look for work or start a business in France.'),
  ('fr-carte-sejour-travailleur-saisonnier', 'temporary_worker',
   'Étranger en France : carte de séjour pluriannuelle - travailleur saisonnier', 'carte-sejour-travailleur-saisonnier',
   'The multi-year seasonal worker residence permit.'),
  ('fr-carte-sejour-salarie-detache-ict', 'temporary_worker',
   'Étranger en France : carte de séjour pluriannuelle - salarié détaché ICT', 'carte-sejour-salarie-detache-ict',
   'The intra-corporate transferee residence permit for an employee posted to France within a group.'),
  ('fr-carte-sejour-visiteur', 'visitor',
   'Carte de séjour temporaire "visiteur" d''un étranger en France', 'carte-sejour-visiteur',
   'The "visiteur" residence permit for a stay of more than three months without working.'),
  ('fr-carte-sejour-vie-privee-familiale', 'family',
   'Carte de séjour "vie privée et familiale" d''un étranger en France', 'carte-sejour-vie-privee-familiale',
   'The "private and family life" residence permit, covering several distinct family and personal circumstances.'),
  ('fr-carte-sejour-pluriannuelle-generale', 'other',
   'Carte de séjour pluriannuelle', 'carte-sejour-pluriannuelle-generale',
   'The general multi-year residence permit issued after a first year of temporary residence.'),
  ('fr-carte-resident', 'permanent_residence',
   'Carte de résident de 10 ans d''un étranger en France', 'carte-resident',
   'The ten-year resident card.'),
  ('fr-carte-resident-longue-duree-ue', 'permanent_residence',
   'Carte de résident de longue durée-UE (étranger en France depuis 5 ans)', 'carte-resident-longue-duree-ue',
   'The EU long-term residence card, available after five years of residence in France.')
) as v(visaai_id, category, official_name, slug, purpose)
on conflict (visaai_id) do nothing;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'Service-Public.gouv.fr — Direction de l''information légale et administrative (DILA)', 1,
  u.url, u.url, v.title, 'fr',
  -- robots.txt is HTTP 200 on this host and the path is ALLOWED for our UA.
  -- Recorded as the measurement, not as an assumption.
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('fr-visa-court-sejour', 'F16146', 'Visa de court séjour Schengen (étranger en France pour 3 mois maximum)'),
  ('fr-visa-long-sejour', 'F16162', 'Visa de long séjour (séjour de plus de 3 mois à 1 an)'),
  ('fr-transit-visa', 'F2672', 'Un étranger en transit en France doit-il demander un visa ?'),
  ('fr-autorisation-travail-salarie', 'F2728', 'Autorisation de travail d''un salarié étranger en France'),
  ('fr-carte-sejour-salarie', 'F15898', 'Travail d''un étranger en France : carte de séjour - salarié/travailleur temporaire'),
  ('fr-carte-sejour-talent', 'F16922', 'Carte talent : carte de séjour pluriannuelle d''un étranger en France'),
  ('fr-carte-sejour-talent-famille', 'F35792', 'Carte de séjour pluriannuelle "talent-famille"'),
  ('fr-carte-sejour-entrepreneur', 'F35795', 'Carte de séjour "entrepreneur/profession libérale" d''un étranger en France'),
  ('fr-carte-sejour-etudiant', 'F2231', 'Étudiant étranger en France : visa de long séjour ou titre de séjour'),
  ('fr-carte-sejour-stagiaire', 'F17312', 'Stagiaire étranger en France : visa de long séjour ou carte de séjour'),
  ('fr-carte-sejour-recherche-emploi', 'F17319', 'Carte de séjour ou VLS-TS - Recherche d''emploi/création d''entreprise'),
  ('fr-carte-sejour-travailleur-saisonnier', 'F21516', 'Étranger en France : carte de séjour pluriannuelle - travailleur saisonnier'),
  ('fr-carte-sejour-salarie-detache-ict', 'F33952', 'Étranger en France : carte de séjour pluriannuelle - salarié détaché ICT'),
  ('fr-carte-sejour-visiteur', 'F302', 'Carte de séjour temporaire "visiteur" d''un étranger en France'),
  ('fr-carte-sejour-vie-privee-familiale', 'F2209', 'Carte de séjour "vie privée et familiale" d''un étranger en France'),
  ('fr-carte-sejour-pluriannuelle-generale', 'F35799', 'Carte de séjour pluriannuelle'),
  ('fr-carte-resident', 'F2208', 'Carte de résident de 10 ans d''un étranger en France'),
  ('fr-carte-resident-longue-duree-ue', 'F17359', 'Carte de résident de longue durée-UE (étranger en France depuis 5 ans)')
) as v(visaai_id, node, title)
cross join lateral (select 'https://www.service-public.gouv.fr/particuliers/vosdroits/' || v.node as url) u
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare
  n_types integer; n_src integer; n_state text; n_reqs integer;
begin
  select count(*) into n_types from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'FR' and t.lifecycle_state = 'active';
  if n_types <> 18 then raise exception 'Expected 18 French routes, found %', n_types; end if;

  select count(*) into n_src from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id where c.code = 'FR';
  if n_src <> 18 then raise exception 'Expected 18 French sources, found %', n_src; end if;

  -- france-visas.gouv.fr refuses us. Registering it would queue a source the
  -- monitor can only fail on, and a failure streak is not evidence of anything
  -- once we already know the answer.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'FR' and s.source_url like '%france-visas.gouv.fr%') then
    raise exception 'france-visas.gouv.fr refuses our monitor at robots.txt and must not be registered';
  end if;

  -- preview means registered, not published. Assert it rather than trust it:
  -- Finland was marked supported on exactly this much evidence.
  select support_state into n_state from public.visa_countries where code = 'FR';
  select count(*) into n_reqs from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id where c.code = 'FR';
  if n_state <> 'preview' or n_reqs <> 0 then
    raise exception 'France must register at preview with zero requirements; got % / % requirement(s)', n_state, n_reqs;
  end if;

  raise notice 'France registered: % routes, % sources, support_state=preview', n_types, n_src;
end $$;
