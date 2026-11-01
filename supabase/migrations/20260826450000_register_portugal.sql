-- Portugal: half open, and the half that opened was a bug we fixed rather than
-- a block anyone imposed.
--
-- WHAT WAS MISFILED
--
-- Portugal was recorded as `blocked_by_our_egress` on both its authorities.
-- Re-diagnosed 2026-08-26, and the two turned out to be different problems:
--
--   vistos.mne.gov.pt — TCP connects on 80 and 443 and the connection then
--   dies. RST after ClientHello, identical for bare openssl with no SNI, for
--   forced TLS 1.2, for a browser User-Agent and for full browser headers.
--   Nothing about our request shapes the outcome, so it is a decision about
--   our source address. HTTP 200 from a second egress. Not fixable by us.
--
--   aima.gov.pt — NEVER an egress block. The host sends exactly ONE
--   certificate and omits the intermediate, so the chain cannot be built and
--   curl reports error 60. Browsers hide this by chasing the leaf's AIA
--   extension, which is why it looked fine to a human and dead to the VPS —
--   and why "works in my browser, dies in production" read as an IP block.
--   `apps/api/src/modules/visa-sync/tls-chain.ts` now completes the chain from
--   the certificate's own AIA URI. AIMA answers 200 from production egress.
--
-- Recording both under one conclusion hid a bug we could fix behind a block we
-- cannot. That is the reason this migration exists at all.
--
-- WHAT THIS DESTINATION IS AND IS NOT
--
-- AIMA is the Agency for Integration, Migration and Asylum. It decides
-- RESIDENCE PERMITS. It does not issue visas — the MFA visa portal does, and
-- that is the host that drops our packets. So every route below describes how
-- to obtain or convert a residence permit, and several of them require a
-- residence visa the applicant must have obtained through a portal we cannot
-- read. The dependency is stated on each route rather than implied.
--
-- Portugal is the second destination in this registry admitted on a
-- permit-granting authority while its visa authority stays unread; Thailand is
-- the mirror image, admitted on its visa authority while its immigration
-- bureau stays unread. Both are recorded as partial rather than presented as
-- whole.
--
-- SIXTEEN OF ROUGHLY THIRTY
--
-- AIMA publishes about thirty substantive residence-permit pages, each named
-- by its article of the REPSAE (Lei de Estrangeiros). Sixteen are registered
-- here; the remainder are named in the coverage exceptions ledger as
-- enumerated-but-not-extracted. The catalogue is known and published, the
-- extraction is partial, and it says so.
--
-- REGISTERED AT `preview`.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, official_visa_url, official_languages,
  support_state, data_quality, jurisdiction_note, last_verified_at
) values (
  'PT', 'Portugal', 'portugal',
  'AIMA — Agência para a Integração, Migrações e Asilo',
  'https://aima.gov.pt/pt',
  'Ministério dos Negócios Estrangeiros (Portal dos Vistos)',
  'https://aima.gov.pt/pt/viver',
  array['pt','en'],
  'preview',
  'unverified',
  'AIMA decides RESIDENCE PERMITS and publishes these sources. It does not issue visas. '
  'The MFA visa portal (vistos.mne.gov.pt) drops our production source address at the TCP '
  'level — the connection is reset after ClientHello and behaves identically for every '
  'request shape we can offer, so it is a decision about our address rather than about our '
  'request. It answers 200 from a second egress. It is not registered and is not read. '
  'Several routes below therefore require a residence visa whose own conditions we cannot '
  'publish. Sources are Portuguese; AIMA publishes an English FAQ for the investment route '
  'only. The Azores and Madeira are covered by these routes; Portuguese consular posts abroad '
  'are not an AIMA competence.',
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

-- official_name is each page's own H1, read 2026-08-24, including its article
-- citation. The article number IS part of the name AIMA gives the route, and
-- dropping it would merge routes the law keeps apart — Art. 88.º n.º 1 and
-- n.º 2 are the same job with and without a residence visa.
insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'PT'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-24'::timestamptz
from (values
  ('pt-autorizacao-residencia-geral', 'other',
   'Autorização de Residência (Regime e Requisitos Gerais) – Art.º 77.º, n.º 1', 'autorizacao-residencia-geral',
   'The general residence permit regime and its baseline requirements, which every other route builds on.'),
  ('pt-trabalho-subordinado-com-visto', 'work',
   'Autorização de Residência para Exercício de Atividade Profissional Subordinada, com Visto de Residência – Art. 88.º, n.º 1', 'trabalho-subordinado-com-visto',
   'Residence permit for employed work, for a holder of a residence visa for subordinate professional activity.'),
  ('pt-trabalho-subordinado-sem-visto', 'work',
   'Autorização de Residência para Exercício de Atividade Profissional Subordinada, com Dispensa de Visto de Residência – Art. 88.º, n.º 2', 'trabalho-subordinado-sem-visto',
   'Residence permit for employed work where the residence visa requirement is waived.'),
  ('pt-trabalho-visto-procura-emprego', 'other',
   'Autorização de Residência para Exercício de Atividade Profissional Subordinada, com Visto para Procura de Trabalho – Art. 88.º, n.º 7', 'trabalho-visto-procura-emprego',
   'Residence permit for employed work for a holder of a job-seeker visa.'),
  ('pt-trabalho-independente-com-visto', 'entrepreneur',
   'Autorização de Residência para Exercício de Atividade Profissional Independente com Visto de Residência – Art. 89.º, n.º 1', 'trabalho-independente-com-visto',
   'Residence permit for self-employed professional activity, with a residence visa.'),
  ('pt-startup-visa', 'entrepreneur',
   'Autorização de Residência para Imigrantes Empreendedores – "StartUP Visa" – Art. 89.º, n.º 4', 'startup-visa',
   'Residence permit for entrepreneur immigrants creating an innovative business inside a certified incubator.'),
  ('pt-atividade-altamente-qualificada', 'skilled_worker',
   'Autorização de Residência para Atividade Altamente Qualificada – Art. 90.º', 'atividade-altamente-qualificada',
   'Residence permit for highly qualified activity.'),
  ('pt-tech-visa', 'skilled_worker',
   'Autorização de Residência para Atividade Altamente Qualificada Exercida para Empresa Certificada – Art. 90.º – "Tech Visa"', 'tech-visa',
   'Residence permit for highly qualified activity performed for a company certified under the Tech Visa programme.'),
  ('pt-nomadas-digitais', 'other',
   'Autorização de Residência para o Exercício de atividade profissional prestada de forma remota – Art. 88.º, n.º 1 "Nómadas Digitais"', 'nomadas-digitais',
   'Residence permit for professional activity performed remotely for an employer or client outside Portugal.'),
  ('pt-cartao-azul-ue', 'skilled_worker',
   'Concessão de «Cartão Azul UE» e Autorização de Residência para Titulares de «Cartão Azul UE» Noutro Estado-Membro – Art. 121.º-A e seguintes', 'cartao-azul-ue',
   'The EU Blue Card, and the residence permit for holders of an EU Blue Card issued by another member state.'),
  ('pt-autorizacao-residencia-investimento', 'investor',
   'Autorização de Residência para Investimento – Art. 90.º-A', 'autorizacao-residencia-investimento',
   'The residence permit for investment activity (ARI), commonly called the golden visa.'),
  ('pt-estudantes-ensino-superior', 'student',
   'Autorização de Residência Emitida a Estudantes do Ensino Superior – Art. 91.º', 'estudantes-ensino-superior',
   'Residence permit for higher education students.'),
  ('pt-reagrupamento-familiar-fora', 'family_reunification',
   'Reagrupamento Familiar, com Familiar Fora de Território Nacional – Art. 98.º, n.º 1', 'reagrupamento-familiar-fora',
   'Family reunification where the family member is outside Portugal.'),
  ('pt-reagrupamento-familiar-em-territorio', 'family_reunification',
   'Reagrupamento Familiar, com Familiar em Território Nacional – Art. 98.º, n.º 2', 'reagrupamento-familiar-em-territorio',
   'Family reunification where the family member is already in Portugal.'),
  ('pt-autorizacao-residencia-permanente', 'permanent_residence',
   'Autorização de Residência Permanente – Art. 80.º', 'autorizacao-residencia-permanente',
   'The permanent residence permit.'),
  ('pt-estatuto-residente-longa-duracao', 'permanent_residence',
   'Aquisição do Estatuto de Residente de Longa Duração (ERLD) – Art. 125.º', 'estatuto-residente-longa-duracao',
   'Acquisition of EU long-term resident status.')
) as v(visaai_id, category, official_name, slug, purpose)
on conflict (visaai_id) do nothing;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'AIMA — Agência para a Integração, Migrações e Asilo', 1,
  v.url, v.url, v.title, 'pt',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('pt-autorizacao-residencia-geral', 'https://aima.gov.pt/pt/viver/autorizacao-de-residencia-regime-e-requisitos-gerais-art-o-77-o-n-o-1', 'Autorização de Residência (Regime e Requisitos Gerais)'),
  ('pt-trabalho-subordinado-com-visto', 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-exercicio-de-atividade-profissional-subordinada-com-visto-de-residencia-art-88-o-n-o-1', 'Atividade Profissional Subordinada, com Visto de Residência'),
  ('pt-trabalho-subordinado-sem-visto', 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-exercicio-de-atividade-profissional-subordinada-com-dispensa-de-visto-de-residencia-art-88-o-n-o-', 'Atividade Profissional Subordinada, com Dispensa de Visto'),
  ('pt-trabalho-visto-procura-emprego', 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-exercicio-de-atividade-profissional-subordinada-com-visto-para-procura-de-trabalho-art-88-o-n-o7', 'Atividade Profissional Subordinada, com Visto para Procura de Trabalho'),
  ('pt-trabalho-independente-com-visto', 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-exercicio-de-atividade-profissional-independente-com-visto-de-residencia-art-89-o-n-o1', 'Atividade Profissional Independente com Visto de Residência'),
  ('pt-startup-visa', 'https://aima.gov.pt/pt/viver/autorizacao-de-residencia-para-imigrantes-empreendedores-startup-visa-art-89-o-n-o-4', 'Imigrantes Empreendedores — StartUP Visa'),
  ('pt-atividade-altamente-qualificada', 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-atividade-altamente-qualificada-art-90-o', 'Atividade Altamente Qualificada'),
  ('pt-tech-visa', 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-atividade-altamente-qualificada-exercida-para-empresa-certificada-art-90-o-tech-visa', 'Atividade Altamente Qualificada para Empresa Certificada — Tech Visa'),
  ('pt-nomadas-digitais', 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-o-exercicio-de-atividade-profissional-prestada-de-forma-remota-com-visto-de-residencia-para-o-exe', 'Atividade Profissional Prestada de Forma Remota — Nómadas Digitais'),
  ('pt-cartao-azul-ue', 'https://aima.gov.pt/pt/viver/concessao-de-cartao-azul-ue-e-autorizacao-de-residencia-para-titulares-de-cartao-azul-ue-noutro-estado-membro-art-121-o-a-e-segu', 'Concessão de «Cartão Azul UE»'),
  ('pt-autorizacao-residencia-investimento', 'https://aima.gov.pt/pt/viver/autorizacao-de-residencia-para-investimento-art-90-o-a', 'Autorização de Residência para Investimento'),
  ('pt-estudantes-ensino-superior', 'https://aima.gov.pt/pt/estudar/autorizacao-de-residencia-emitida-a-estudantes-do-ensino-superior-art-o-91', 'Estudantes do Ensino Superior'),
  ('pt-reagrupamento-familiar-fora', 'https://aima.gov.pt/pt/viver/reagrupamento-familiar-com-familiar-fora-de-territorio-nacional-art-98-o-n-o-1', 'Reagrupamento Familiar, com Familiar Fora de Território Nacional'),
  ('pt-reagrupamento-familiar-em-territorio', 'https://aima.gov.pt/pt/viver/reagrupamento-familiar-com-familiar-em-territorio-nacional-art-98-o-n-o-2', 'Reagrupamento Familiar, com Familiar em Território Nacional'),
  ('pt-autorizacao-residencia-permanente', 'https://aima.gov.pt/pt/viver/autorizacao-de-residencia-permanente-art-80-o', 'Autorização de Residência Permanente'),
  ('pt-estatuto-residente-longa-duracao', 'https://aima.gov.pt/pt/viver/aquisicao-do-estatuto-de-residente-de-longa-duracao-erld-art-125-o', 'Estatuto de Residente de Longa Duração (ERLD)')
) as v(visaai_id, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

-- The investment route also has an ENGLISH FAQ on the same host. Registered as
-- a second source rather than substituted for the Portuguese page: it is the
-- only English page AIMA publishes on any of these routes, and pretending it
-- is the general case would misdescribe the destination.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'eligibility',
  'AIMA — Agência para a Integração, Migrações e Asilo', 1,
  u.url, u.url, 'FAQ Residence Permit for Investment Activity (ARI)', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (select 'https://aima.gov.pt/pt/a-aima/perguntas-frequentes-faqs/autorizacao-de-residencia-para-investimento-ari/faq-residence-permit-for-investment-activity-ari' as url) u
join public.visa_types t on t.visaai_id = 'pt-autorizacao-residencia-investimento'
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n_types integer; n_src integer; n_state text; n_reqs integer;
begin
  select count(*) into n_types from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'PT' and t.lifecycle_state = 'active';
  if n_types <> 16 then raise exception 'Expected 16 Portuguese routes, found %', n_types; end if;

  select count(*) into n_src from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id where c.code = 'PT';
  if n_src <> 17 then raise exception 'Expected 17 Portuguese sources, found %', n_src; end if;

  -- vistos.mne.gov.pt drops our source address. Registering it would queue a
  -- source the monitor can only fail on.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'PT' and s.source_url like '%vistos.mne.gov.pt%') then
    raise exception 'vistos.mne.gov.pt drops our source address and must not be registered';
  end if;

  -- Art. 88 n.1 and n.2 are the same job with and without a residence visa,
  -- and they must never be merged into one route.
  if (select count(*) from public.visa_types where visaai_id in
       ('pt-trabalho-subordinado-com-visto','pt-trabalho-subordinado-sem-visto')) <> 2 then
    raise exception 'The with-visa and without-visa employed-work routes must both exist';
  end if;

  select support_state into n_state from public.visa_countries where code = 'PT';
  select count(*) into n_reqs from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id where c.code = 'PT';
  if n_state <> 'preview' or n_reqs <> 0 then
    raise exception 'Portugal must register at preview with zero requirements; got % / %', n_state, n_reqs;
  end if;

  raise notice 'Portugal registered: % routes, % sources, support_state=preview', n_types, n_src;
end $$;
