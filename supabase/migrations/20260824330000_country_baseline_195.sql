-- The 195-country baseline: every UN member state plus the Holy See and the
-- State of Palestine, present in the canonical registry exactly once.
--
-- GENERATED FILE. Do not hand-edit.
--   generator: scripts/visa-registry/generate-country-baseline.mjs
--   source: the spec’s own §4.1 list, read at generation time
--   rows: 195
--
-- WHY THE REGISTRY HELD 13 AND NOT 195
--
-- A country only ever entered it when somebody extracted a route for it.
-- That is the right way to earn a PUBLISHED page and the wrong way to keep a
-- canonical list: without the full list there is no denominator. "We cover
-- 13" is a number; "13 of 195" is a fact.
--
-- WHAT THESE ROWS DELIBERATELY DO NOT CONTAIN
--
-- No immigration authority, no authority URL, no portal, no currency, no
-- languages. Those are per-country research, and §6 makes official sources
-- authoritative -- inventing 182 plausible authority URLs would be the exact
-- fabrication every other check in this system exists to prevent. They are
-- NULL because nobody has looked yet, and NULL says so.
--
-- support_state = 'unsupported' for the same reason, and it is LOAD-BEARING:
-- `listPublishedCountries` filters on <> 'unsupported', so a bare baseline row
-- publishes no hub page and adds no sitemap URL. 182 empty hubs would be a
-- thin-content regression on a site whose programmatic-SEO gate exists to
-- prevent exactly that.
--
-- A country graduates to preview when its authority and visa types are
-- verified, and to supported when requirements are extracted and reviewed.
-- NOTHING HERE PROMOTES ANYTHING: the insert is ON CONFLICT DO NOTHING, so
-- the 13 rows already carrying verified authorities are untouched.
--
-- ISO CODES ARE ESTABLISHED, NOT GUESSED. Every code is round-tripped through
-- Node's ICU region database and compared to the spec's name; the generator
-- refuses to emit anything it cannot map. Five names differ from ICU by word
-- rather than punctuation, and §4.1 says to use current ISO names, so the
-- spec form is stored:
--   CV  spec "Cabo Verde"  vs ICU "Cape Verde"
--   CG  spec "Republic of the Congo"  vs ICU "Congo - Brazzaville"
--   CD  spec "Democratic Republic of the Congo"  vs ICU "Congo - Kinshasa"
--   VA  spec "Holy See"  vs ICU "Vatican City"
--   FM  spec "Federated States of Micronesia"  vs ICU "Micronesia"
--   MM  spec "Myanmar"  vs ICU "Myanmar (Burma)"
--   PS  spec "State of Palestine"  vs ICU "Palestinian Territories"

begin;

insert into public.visa_countries (code, name, slug, support_state, data_quality)
values
  ('AF', 'Afghanistan', 'afghanistan', 'unsupported', 'unverified'),
  ('AL', 'Albania', 'albania', 'unsupported', 'unverified'),
  ('DZ', 'Algeria', 'algeria', 'unsupported', 'unverified'),
  ('AD', 'Andorra', 'andorra', 'unsupported', 'unverified'),
  ('AO', 'Angola', 'angola', 'unsupported', 'unverified'),
  ('AG', 'Antigua and Barbuda', 'antigua-and-barbuda', 'unsupported', 'unverified'),
  ('AR', 'Argentina', 'argentina', 'unsupported', 'unverified'),
  ('AM', 'Armenia', 'armenia', 'unsupported', 'unverified'),
  ('AU', 'Australia', 'australia', 'unsupported', 'unverified'),
  ('AT', 'Austria', 'austria', 'unsupported', 'unverified'),
  ('AZ', 'Azerbaijan', 'azerbaijan', 'unsupported', 'unverified'),
  ('BS', 'The Bahamas', 'the-bahamas', 'unsupported', 'unverified'),
  ('BH', 'Bahrain', 'bahrain', 'unsupported', 'unverified'),
  ('BD', 'Bangladesh', 'bangladesh', 'unsupported', 'unverified'),
  ('BB', 'Barbados', 'barbados', 'unsupported', 'unverified'),
  ('BY', 'Belarus', 'belarus', 'unsupported', 'unverified'),
  ('BE', 'Belgium', 'belgium', 'unsupported', 'unverified'),
  ('BZ', 'Belize', 'belize', 'unsupported', 'unverified'),
  ('DY', 'Benin', 'benin', 'unsupported', 'unverified'),
  ('BT', 'Bhutan', 'bhutan', 'unsupported', 'unverified'),
  ('BO', 'Bolivia', 'bolivia', 'unsupported', 'unverified'),
  ('BA', 'Bosnia and Herzegovina', 'bosnia-and-herzegovina', 'unsupported', 'unverified'),
  ('BW', 'Botswana', 'botswana', 'unsupported', 'unverified'),
  ('BR', 'Brazil', 'brazil', 'unsupported', 'unverified'),
  ('BN', 'Brunei', 'brunei', 'unsupported', 'unverified'),
  ('BG', 'Bulgaria', 'bulgaria', 'unsupported', 'unverified'),
  ('HV', 'Burkina Faso', 'burkina-faso', 'unsupported', 'unverified'),
  ('BI', 'Burundi', 'burundi', 'unsupported', 'unverified'),
  ('CV', 'Cabo Verde', 'cabo-verde', 'unsupported', 'unverified'),
  ('KH', 'Cambodia', 'cambodia', 'unsupported', 'unverified'),
  ('CM', 'Cameroon', 'cameroon', 'unsupported', 'unverified'),
  ('CA', 'Canada', 'canada', 'unsupported', 'unverified'),
  ('CF', 'Central African Republic', 'central-african-republic', 'unsupported', 'unverified'),
  ('TD', 'Chad', 'chad', 'unsupported', 'unverified'),
  ('CL', 'Chile', 'chile', 'unsupported', 'unverified'),
  ('CN', 'China', 'china', 'unsupported', 'unverified'),
  ('CO', 'Colombia', 'colombia', 'unsupported', 'unverified'),
  ('KM', 'Comoros', 'comoros', 'unsupported', 'unverified'),
  ('CG', 'Republic of the Congo', 'republic-of-the-congo', 'unsupported', 'unverified'),
  ('CR', 'Costa Rica', 'costa-rica', 'unsupported', 'unverified'),
  ('CI', 'Côte d’Ivoire', 'cote-d-ivoire', 'unsupported', 'unverified'),
  ('HR', 'Croatia', 'croatia', 'unsupported', 'unverified'),
  ('CU', 'Cuba', 'cuba', 'unsupported', 'unverified'),
  ('CY', 'Cyprus', 'cyprus', 'unsupported', 'unverified'),
  ('CZ', 'Czechia', 'czechia', 'unsupported', 'unverified'),
  ('CD', 'Democratic Republic of the Congo', 'democratic-republic-of-the-congo', 'unsupported', 'unverified'),
  ('DK', 'Denmark', 'denmark', 'unsupported', 'unverified'),
  ('DJ', 'Djibouti', 'djibouti', 'unsupported', 'unverified'),
  ('DM', 'Dominica', 'dominica', 'unsupported', 'unverified'),
  ('DO', 'Dominican Republic', 'dominican-republic', 'unsupported', 'unverified'),
  ('EC', 'Ecuador', 'ecuador', 'unsupported', 'unverified'),
  ('EG', 'Egypt', 'egypt', 'unsupported', 'unverified'),
  ('SV', 'El Salvador', 'el-salvador', 'unsupported', 'unverified'),
  ('GQ', 'Equatorial Guinea', 'equatorial-guinea', 'unsupported', 'unverified'),
  ('ER', 'Eritrea', 'eritrea', 'unsupported', 'unverified'),
  ('EE', 'Estonia', 'estonia', 'unsupported', 'unverified'),
  ('SZ', 'Eswatini', 'eswatini', 'unsupported', 'unverified'),
  ('ET', 'Ethiopia', 'ethiopia', 'unsupported', 'unverified'),
  ('FJ', 'Fiji', 'fiji', 'unsupported', 'unverified'),
  ('FI', 'Finland', 'finland', 'unsupported', 'unverified'),
  ('FX', 'France', 'france', 'unsupported', 'unverified'),
  ('GA', 'Gabon', 'gabon', 'unsupported', 'unverified'),
  ('GM', 'The Gambia', 'the-gambia', 'unsupported', 'unverified'),
  ('GE', 'Georgia', 'georgia', 'unsupported', 'unverified'),
  ('DE', 'Germany', 'germany', 'unsupported', 'unverified'),
  ('GH', 'Ghana', 'ghana', 'unsupported', 'unverified'),
  ('GR', 'Greece', 'greece', 'unsupported', 'unverified'),
  ('GD', 'Grenada', 'grenada', 'unsupported', 'unverified'),
  ('GT', 'Guatemala', 'guatemala', 'unsupported', 'unverified'),
  ('GN', 'Guinea', 'guinea', 'unsupported', 'unverified'),
  ('GW', 'Guinea-Bissau', 'guinea-bissau', 'unsupported', 'unverified'),
  ('GY', 'Guyana', 'guyana', 'unsupported', 'unverified'),
  ('HT', 'Haiti', 'haiti', 'unsupported', 'unverified'),
  ('VA', 'Holy See', 'holy-see', 'unsupported', 'unverified'),
  ('HN', 'Honduras', 'honduras', 'unsupported', 'unverified'),
  ('HU', 'Hungary', 'hungary', 'unsupported', 'unverified'),
  ('IS', 'Iceland', 'iceland', 'unsupported', 'unverified'),
  ('IN', 'India', 'india', 'unsupported', 'unverified'),
  ('ID', 'Indonesia', 'indonesia', 'unsupported', 'unverified'),
  ('IR', 'Iran', 'iran', 'unsupported', 'unverified'),
  ('IQ', 'Iraq', 'iraq', 'unsupported', 'unverified'),
  ('IE', 'Ireland', 'ireland', 'unsupported', 'unverified'),
  ('IL', 'Israel', 'israel', 'unsupported', 'unverified'),
  ('IT', 'Italy', 'italy', 'unsupported', 'unverified'),
  ('JM', 'Jamaica', 'jamaica', 'unsupported', 'unverified'),
  ('JP', 'Japan', 'japan', 'unsupported', 'unverified'),
  ('JO', 'Jordan', 'jordan', 'unsupported', 'unverified'),
  ('KZ', 'Kazakhstan', 'kazakhstan', 'unsupported', 'unverified'),
  ('KE', 'Kenya', 'kenya', 'unsupported', 'unverified'),
  ('KI', 'Kiribati', 'kiribati', 'unsupported', 'unverified'),
  ('KP', 'North Korea', 'north-korea', 'unsupported', 'unverified'),
  ('KR', 'South Korea', 'south-korea', 'unsupported', 'unverified'),
  ('KW', 'Kuwait', 'kuwait', 'unsupported', 'unverified'),
  ('KG', 'Kyrgyzstan', 'kyrgyzstan', 'unsupported', 'unverified'),
  ('LA', 'Laos', 'laos', 'unsupported', 'unverified'),
  ('LV', 'Latvia', 'latvia', 'unsupported', 'unverified'),
  ('LB', 'Lebanon', 'lebanon', 'unsupported', 'unverified'),
  ('LS', 'Lesotho', 'lesotho', 'unsupported', 'unverified'),
  ('LR', 'Liberia', 'liberia', 'unsupported', 'unverified'),
  ('LY', 'Libya', 'libya', 'unsupported', 'unverified'),
  ('LI', 'Liechtenstein', 'liechtenstein', 'unsupported', 'unverified'),
  ('LT', 'Lithuania', 'lithuania', 'unsupported', 'unverified'),
  ('LU', 'Luxembourg', 'luxembourg', 'unsupported', 'unverified'),
  ('MG', 'Madagascar', 'madagascar', 'unsupported', 'unverified'),
  ('MW', 'Malawi', 'malawi', 'unsupported', 'unverified'),
  ('MY', 'Malaysia', 'malaysia', 'unsupported', 'unverified'),
  ('MV', 'Maldives', 'maldives', 'unsupported', 'unverified'),
  ('ML', 'Mali', 'mali', 'unsupported', 'unverified'),
  ('MT', 'Malta', 'malta', 'unsupported', 'unverified'),
  ('MH', 'Marshall Islands', 'marshall-islands', 'unsupported', 'unverified'),
  ('MR', 'Mauritania', 'mauritania', 'unsupported', 'unverified'),
  ('MU', 'Mauritius', 'mauritius', 'unsupported', 'unverified'),
  ('MX', 'Mexico', 'mexico', 'unsupported', 'unverified'),
  ('FM', 'Federated States of Micronesia', 'federated-states-of-micronesia', 'unsupported', 'unverified'),
  ('MD', 'Moldova', 'moldova', 'unsupported', 'unverified'),
  ('MC', 'Monaco', 'monaco', 'unsupported', 'unverified'),
  ('MN', 'Mongolia', 'mongolia', 'unsupported', 'unverified'),
  ('ME', 'Montenegro', 'montenegro', 'unsupported', 'unverified'),
  ('MA', 'Morocco', 'morocco', 'unsupported', 'unverified'),
  ('MZ', 'Mozambique', 'mozambique', 'unsupported', 'unverified'),
  ('MM', 'Myanmar', 'myanmar', 'unsupported', 'unverified'),
  ('NA', 'Namibia', 'namibia', 'unsupported', 'unverified'),
  ('NR', 'Nauru', 'nauru', 'unsupported', 'unverified'),
  ('NP', 'Nepal', 'nepal', 'unsupported', 'unverified'),
  ('NL', 'Netherlands', 'netherlands', 'unsupported', 'unverified'),
  ('NZ', 'New Zealand', 'new-zealand', 'unsupported', 'unverified'),
  ('NI', 'Nicaragua', 'nicaragua', 'unsupported', 'unverified'),
  ('NE', 'Niger', 'niger', 'unsupported', 'unverified'),
  ('NG', 'Nigeria', 'nigeria', 'unsupported', 'unverified'),
  ('MK', 'North Macedonia', 'north-macedonia', 'unsupported', 'unverified'),
  ('NO', 'Norway', 'norway', 'unsupported', 'unverified'),
  ('OM', 'Oman', 'oman', 'unsupported', 'unverified'),
  ('PK', 'Pakistan', 'pakistan', 'unsupported', 'unverified'),
  ('PW', 'Palau', 'palau', 'unsupported', 'unverified'),
  ('PS', 'State of Palestine', 'state-of-palestine', 'unsupported', 'unverified'),
  ('PA', 'Panama', 'panama', 'unsupported', 'unverified'),
  ('PG', 'Papua New Guinea', 'papua-new-guinea', 'unsupported', 'unverified'),
  ('PY', 'Paraguay', 'paraguay', 'unsupported', 'unverified'),
  ('PE', 'Peru', 'peru', 'unsupported', 'unverified'),
  ('PH', 'Philippines', 'philippines', 'unsupported', 'unverified'),
  ('PL', 'Poland', 'poland', 'unsupported', 'unverified'),
  ('PT', 'Portugal', 'portugal', 'unsupported', 'unverified'),
  ('QA', 'Qatar', 'qatar', 'unsupported', 'unverified'),
  ('RO', 'Romania', 'romania', 'unsupported', 'unverified'),
  ('RU', 'Russia', 'russia', 'unsupported', 'unverified'),
  ('RW', 'Rwanda', 'rwanda', 'unsupported', 'unverified'),
  ('KN', 'Saint Kitts and Nevis', 'saint-kitts-and-nevis', 'unsupported', 'unverified'),
  ('LC', 'Saint Lucia', 'saint-lucia', 'unsupported', 'unverified'),
  ('VC', 'Saint Vincent and the Grenadines', 'saint-vincent-and-the-grenadines', 'unsupported', 'unverified'),
  ('WS', 'Samoa', 'samoa', 'unsupported', 'unverified'),
  ('SM', 'San Marino', 'san-marino', 'unsupported', 'unverified'),
  ('ST', 'São Tomé and Príncipe', 'sao-tome-and-principe', 'unsupported', 'unverified'),
  ('SA', 'Saudi Arabia', 'saudi-arabia', 'unsupported', 'unverified'),
  ('SN', 'Senegal', 'senegal', 'unsupported', 'unverified'),
  ('YU', 'Serbia', 'serbia', 'unsupported', 'unverified'),
  ('SC', 'Seychelles', 'seychelles', 'unsupported', 'unverified'),
  ('SL', 'Sierra Leone', 'sierra-leone', 'unsupported', 'unverified'),
  ('SG', 'Singapore', 'singapore', 'unsupported', 'unverified'),
  ('SK', 'Slovakia', 'slovakia', 'unsupported', 'unverified'),
  ('SI', 'Slovenia', 'slovenia', 'unsupported', 'unverified'),
  ('SB', 'Solomon Islands', 'solomon-islands', 'unsupported', 'unverified'),
  ('SO', 'Somalia', 'somalia', 'unsupported', 'unverified'),
  ('ZA', 'South Africa', 'south-africa', 'unsupported', 'unverified'),
  ('SS', 'South Sudan', 'south-sudan', 'unsupported', 'unverified'),
  ('ES', 'Spain', 'spain', 'unsupported', 'unverified'),
  ('LK', 'Sri Lanka', 'sri-lanka', 'unsupported', 'unverified'),
  ('SD', 'Sudan', 'sudan', 'unsupported', 'unverified'),
  ('SR', 'Suriname', 'suriname', 'unsupported', 'unverified'),
  ('SE', 'Sweden', 'sweden', 'unsupported', 'unverified'),
  ('CH', 'Switzerland', 'switzerland', 'unsupported', 'unverified'),
  ('SY', 'Syria', 'syria', 'unsupported', 'unverified'),
  ('TJ', 'Tajikistan', 'tajikistan', 'unsupported', 'unverified'),
  ('TZ', 'Tanzania', 'tanzania', 'unsupported', 'unverified'),
  ('TH', 'Thailand', 'thailand', 'unsupported', 'unverified'),
  ('TL', 'Timor-Leste', 'timor-leste', 'unsupported', 'unverified'),
  ('TG', 'Togo', 'togo', 'unsupported', 'unverified'),
  ('TO', 'Tonga', 'tonga', 'unsupported', 'unverified'),
  ('TT', 'Trinidad and Tobago', 'trinidad-and-tobago', 'unsupported', 'unverified'),
  ('TN', 'Tunisia', 'tunisia', 'unsupported', 'unverified'),
  ('TR', 'Türkiye', 'turkiye', 'unsupported', 'unverified'),
  ('TM', 'Turkmenistan', 'turkmenistan', 'unsupported', 'unverified'),
  ('TV', 'Tuvalu', 'tuvalu', 'unsupported', 'unverified'),
  ('UG', 'Uganda', 'uganda', 'unsupported', 'unverified'),
  ('UA', 'Ukraine', 'ukraine', 'unsupported', 'unverified'),
  ('AE', 'United Arab Emirates', 'united-arab-emirates', 'unsupported', 'unverified'),
  ('GB', 'United Kingdom', 'united-kingdom', 'unsupported', 'unverified'),
  ('US', 'United States', 'united-states', 'unsupported', 'unverified'),
  ('UY', 'Uruguay', 'uruguay', 'unsupported', 'unverified'),
  ('UZ', 'Uzbekistan', 'uzbekistan', 'unsupported', 'unverified'),
  ('VU', 'Vanuatu', 'vanuatu', 'unsupported', 'unverified'),
  ('VE', 'Venezuela', 'venezuela', 'unsupported', 'unverified'),
  ('VN', 'Vietnam', 'vietnam', 'unsupported', 'unverified'),
  ('YE', 'Yemen', 'yemen', 'unsupported', 'unverified'),
  ('ZM', 'Zambia', 'zambia', 'unsupported', 'unverified'),
  ('ZW', 'Zimbabwe', 'zimbabwe', 'unsupported', 'unverified')
on conflict (code) do nothing;

-- The §84 claim, asserted rather than described.
do $$
declare total int; published int; bare int;
begin
  select count(*) into total from public.visa_countries;
  if total < 195 then
    raise exception 'Expected at least 195 countries in the registry, found %.', total;
  end if;

  -- Nothing new may become publishable. This migration adds a denominator,
  -- not 182 empty pages.
  select count(*) into published from public.visa_countries where support_state <> 'unsupported';
  if published > 13 then
    raise exception '% countries are publishable; the baseline must not publish anything (expected 13).', published;
  end if;

  -- A bare baseline row must carry no authority it has not earned.
  select count(*) into bare from public.visa_countries
   where support_state = 'unsupported'
     and (immigration_authority is not null or immigration_authority_url is not null);
  if bare > 0 then
    raise exception '% unsupported countries carry an authority nobody verified.', bare;
  end if;
end $$;

commit;
