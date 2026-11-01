/**
 * IRCC tr-rt work history: the two selects of the "Add" dialog on /activities,
 * recorded on the live portal 2026-10-18.
 *
 * `#activtyOccupation_select` takes one of these groups; `#jobTitleActivity_select`
 * offers 208 NOC-style titles (civilian and Canadian Armed Forces). A free-text
 * job title from VisaAI ("Software Engineer", "School teacher") is matched to a
 * title only by the rules below; anything else is left for the applicant —
 * a wrong occupation on a visa application is worse than a blank one.
 */

/** `#activtyOccupation_select` options as shown. */
export const IRCC_ACTIVITY = {
  art: 'Art, culture, recreation and sport occupations',
  business: 'Business, finance and administration occupations',
  education:
    'Education, law and social, community and government services occupations',
  government: 'Government Position',
  health: 'Health occupations',
  homemaker: 'Homemaker',
  management: 'Management occupations',
  manufacturing: 'Manufacturing and utilities occupations',
  science: 'Natural and applied sciences and related occupations',
  resources:
    'Natural resources, agriculture and related production occupations',
  retired: 'Retired',
  sales: 'Sales and service occupations',
  trades: 'Trades, transport and equipment operators and related occupations',
  unemployed: 'Unemployed',
} as const;

export interface IrccOccupation {
  /** `#activtyOccupation_select` option text. */
  activity: string;
  /** `#jobTitleActivity_select` option text, exactly as IRCC shows it. */
  title: string;
}

const A = IRCC_ACTIVITY;

/**
 * Ordered: the first rule whose pattern matches the applicant's job title
 * wins, so specific titles come before general ones ("software engineer"
 * before "engineer", "bank manager" before "manager").
 */
const RULES: ReadonlyArray<[RegExp, string, string]> = [
  [
    /\b(software|web|mobile|full[- ]?stack|back[- ]?end|front[- ]?end)\b.*\b(engineer|developer)\b|\b(programmer|software developer|developer|data scientist|it (manager|specialist|officer|consultant)|systems? (analyst|administrator)|network (engineer|administrator))\b/,
    A.science,
    'Computer and information systems professionals',
  ],
  [
    /\b(computer|it) (technician|support)\b|\bhelp ?desk\b/,
    A.science,
    'Technical occupations in computer and information systems',
  ],
  [
    /\b(civil|mechanical|electrical|chemical|structural) engineer\b/,
    A.science,
    'Civil, mechanical, electrical and chemical engineers',
  ],
  [/\barchitect\b/, A.science, 'Architects, urban planners and land surveyors'],
  [/\bengineer\b/, A.science, 'Other engineers'],
  [
    /\b(statistician|actuary|mathematician|data analyst)\b/,
    A.science,
    'Mathematicians, statisticians and actuaries',
  ],
  [
    /\b(professor|lecturer|university teacher)\b/,
    A.education,
    'University professors and post-secondary assistants',
  ],
  [
    /\b(college|vocational) (teacher|instructor)\b/,
    A.education,
    'College and other vocational instructors',
  ],
  [
    /\b(teacher|school ?teacher|headmaster|headmistress|principal|educational counsell?or)\b/,
    A.education,
    'Secondary and elementary school teachers and educational counsellors',
  ],
  [
    /\b(lawyer|advocate|attorney|barrister|solicitor|judge|notary)\b/,
    A.education,
    'Judges, lawyers and notaries',
  ],
  [
    /\b(police|constable)\b/,
    A.education,
    'Occupations in front-line public protection services',
  ],
  [
    /\bsocial worker\b/,
    A.education,
    'Social and community service professionals',
  ],
  [
    /\b(physician|doctor|surgeon|dentist|veterinar(ian|y)|general practitioner|medical officer)\b/,
    A.health,
    'Physicians, dentists and veterinarians',
  ],
  [/\bnurse\b/, A.health, 'Professional occupations in nursing'],
  [
    /\b(pharmacist|dietitian|dietician|nutritionist)\b/,
    A.health,
    'Pharmacists, dieticians and nutritionists',
  ],
  [
    /\b(lab(oratory)?|medical) (technician|technologist)\b/,
    A.health,
    'Medical technologists and technicians',
  ],
  [
    /\b(physiotherapist|occupational therapist|speech therapist)\b/,
    A.health,
    'Therapy and assessment professionals',
  ],
  [
    /\b(accountant|auditor|chartered accountant|cpa|acca|investment (analyst|advisor|adviser))\b/,
    A.business,
    'Auditors, accountants and investment professionals',
  ],
  [
    /\b(bank|finance|financial) manager\b/,
    A.management,
    'Managers in financial and business services',
  ],
  [
    /\b(human resources?|hr) (manager|officer|specialist|executive)\b|\bbusiness consultant\b/,
    A.business,
    'Human resources and business service professionals',
  ],
  [
    /\b(bank (officer|teller|clerk)|teller|cashier officer)\b/,
    A.business,
    'Financial, insurance and related administrative support workers',
  ],
  [
    /\b(secretary|administrative assistant|office assistant|personal assistant)\b/,
    A.business,
    'Office administrative assistants - general, legal and medical',
  ],
  [
    /\b(clerk|office worker|receptionist|data entry)\b/,
    A.business,
    'General office workers',
  ],
  [
    /\b(journalist|writer|editor|translator|interpreter)\b/,
    A.art,
    'Writing, translating and related communications professionals',
  ],
  [
    /\b(graphic|fashion|interior) designer\b|\bdesigner\b/,
    A.art,
    'Creative designers and craftspersons',
  ],
  [
    /\b(photographer|camera ?man|videographer)\b/,
    A.art,
    'Photographers, graphic arts technicians, technical and coordinating occupations in motion pictures, broadcasting and the performing arts',
  ],
  // Traders and merchants (live 2026-10-19: "scrap metal trader" placed
  // nothing, so the current-job row was never written). One who owns, runs or
  // manages the trade is a trade manager; a trader by itself buys and sells.
  // A stock / forex / day trader is not wholesale trade and is not guessed.
  [
    /^(?!.*\b(stock|stocks|share|shares|forex|fx|currency|crypto|securities|equity|equities|day|options|futures|bond|bonds)\s+(trader|traders|trading|dealer|dealers)\b)(?=.*\b(owner|co-?owner|proprietor|partner|manag(er|ing)|director|ceo|head)\b)(?=.*\b(trad(er|ers|ing)|merchants?|wholesale(rs?)?|dealers?|dealership|import(er|ers)?|export(er|ers)?)\b)/,
    A.management,
    'Retail and wholesale trade managers',
  ],
  // The owner of a factory or manufacturing business, or a plant / production
  // manager (live 2026-10-19: "owner and manager of a concrete block
  // manufacturing company" placed nothing, so the earlier-job row was never
  // written). Not any manager who works at a factory — "sales manager at a
  // manufacturing company" or "head of HR at a factory" names another job — and
  // not a bare CEO / managing director, who is senior management below. A
  // director or partner OF a manufacturing business is its manager (live
  // 2026-10-30: "Director" of a concrete block manufacturer, the trade named
  // only in the duties, placed nothing) — but not a sales / marketing / HR …
  // director there, and not a CEO ("CEO of a steel mill" stays senior
  // management).
  [
    /(?=.*\b(owner|proprietor|partner|(?<!\b(sales|marketing|hr|human resources|finance|financial|technical|creative|art|it|operations|non-executive)\s)director)\b)(?=.*\b(manufactur(e|er|ers|ing)|factory|factories|mills?)\b)|\b(factory|mill|plant|production|manufacturing|works) (manager|superintendent)\b/,
    A.management,
    'Managers in manufacturing and utilities',
  ],
  [
    /\b(shopkeeper|shop owner|store owner|retailer|wholesaler|retail manager|store manager)\b/,
    A.management,
    'Retail and wholesale trade managers',
  ],
  // The head of a company. A generic "business owner", "proprietor" or
  // "entrepreneur" names no sector and is left for the applicant: senior
  // management is a screening-relevant answer, and a wrong occupation is
  // worse than a blank one. An owner of a named trade is matched above.
  [
    /\b(managing director|chief executive( officer)?|ceo)\b/,
    A.management,
    'Legislators and senior management, including political officials',
  ],
  [
    /^(?!.*\b(stock|stocks|share|shares|forex|fx|currency|crypto|securities|equity|equities|day|options|futures|bond|bonds)\s+(trader|traders|trading|dealer|dealers)\b).*\b(trader|merchant|dealer|wholesale|importer|exporter|commission agent)s?\b/,
    A.sales,
    'Technical sales specialists in wholesale trade and retail and wholesale buyers',
  ],
  [
    /\b(sales (representative|executive|officer|agent|manager)|account (manager|executive)|salesman|saleswoman|salesperson)\b/,
    A.sales,
    'Sales and account representatives',
  ],
  [/\b(cashier)\b/, A.sales, 'Cashiers'],
  [/\b(chef|cook)\b/, A.sales, 'Chefs and cooks'],
  [
    /\b(waiter|waitress|server|bartender)\b/,
    A.sales,
    'Occupations in food and beverage services',
  ],
  [
    /\b(security guard|guard|watchman)\b/,
    A.sales,
    'Security guards and related security service occupations',
  ],
  [/\b(cleaner|janitor|housekeeper)\b/, A.sales, 'Cleaners'],
  [
    /\b(farmer|agricultur(ist|e owner)|landlord farmer)\b/,
    A.management,
    'Managers in agriculture, horticulture and aquaculture',
  ],
  [
    /\b(farm (worker|labou?rer)|agricultural worker)\b/,
    A.resources,
    'Agriculture and horticulture workers',
  ],
  [
    /\belectrician\b/,
    A.trades,
    'Electrical trades and electrical power line and telecommunications workers',
  ],
  [
    /\b(plumber|pipefitter|gas fitter)\b/,
    A.trades,
    'Plumbers, pipefitters and gas fitters',
  ],
  [/\b(carpenter|cabinet ?maker)\b/, A.trades, 'Carpenters and cabinetmakers'],
  [
    /\b(car|auto(motive)?) mechanic\b/,
    A.trades,
    'Automotive service technicians',
  ],
  [
    /\bmechanic\b/,
    A.trades,
    'Machinery and transportation equipment mechanics',
  ],
  // The owner or manager of a named service business (E2E 2026-10-29:
  // "Proprietor, car wash and auto detailing" placed nothing, so the
  // current-job row was never written). Only when that is the applicant's own
  // role — the title is headed by it ("Proprietor, Max Care car wash", "car
  // wash owner") — not a worker who reports to one (review of 4a13b7cb).
  [
    /^(?!.*\b(reports? to|my (father|mother|brother|sister|uncle|family)'?s?|employee|employed (at|by)|works? (at|for))\b)(?:(co-?owner|owner|proprietor|managing partner|manager)\b[^.]*?\b(car ?wash(es)?|(auto|car|vehicle) detailing|salons?|laundry|laundromat|dry clean(ers|ing)|repair shops?)\b|[^,]*?\b(car ?wash|(auto|car|vehicle) detailing|salon|laundry|laundromat|dry cleaning|repair shop) (co-?owner|owner|proprietor|manager)\b)/,
    A.management,
    'Managers in customer and personal services',
  ],
  [
    /\b(driver|chauffeur|taxi|truck(er)?|bus driver)\b/,
    A.trades,
    'Motor vehicle and transit drivers',
  ],
  [
    /\b(labou?rer|construction worker|helper)\b/,
    A.trades,
    'Trades helpers and labourers',
  ],
];

/** The IRCC activity and job title for a free-text job title, or undefined. */
export function irccOccupationFor(
  jobTitle: string | undefined,
): IrccOccupation | undefined {
  const t = (jobTitle ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  for (const [re, activity, title] of RULES) {
    if (re.test(t)) return { activity, title };
  }
  return undefined;
}

// ── manufacturing named only in the duties ──────────────────────────────────
/**
 * The applicant heads the business: owner, proprietor, partner, director,
 * manager, CEO, founder — not a function or unit head ("Sales director",
 * "Division manager"), who manages part of it.
 */
const OWN_ROLE =
  /\b(owner|co-?owner|proprietor|partner|director|manager|ceo|chief executive|founder)\b/;
const FUNCTION_ROLE =
  /\b(sales|marketing|hr|human resources|finance|financial|technical|creative|art|it|operations|account|accounts|project|product|office|non-executive|regional|area|branch)\s+(director|manager|head)\b|\b(department|division)\b/;

/** A word naming goods: never an article, preposition or verb of doing. */
const GOODS =
  "(?!(?:a|an|the|to|for|from|with|at|in|on|by|of|and|or|sell|sells|selling|sold|supply|supplies|supplying|supplied|deliver|delivers|delivering|advise|advising|visit|visiting|consult|consulting|supervise|supervising|manage|manages|managed|managing|oversee|overseeing|oversaw|run|runs|ran|running|lead|leading|led|handle|handled|handling|head|heading)\\b)[a-z]+";

/**
 * A duties clause that is exactly "<goods> manufacturing" ("concrete block
 * manufacturing") or "manufacturing of <goods>", with one to three goods
 * words. Nothing else in the duties places an occupation.
 */
const MANUFACTURING_CLAUSE = new RegExp(
  `^(?:${GOODS} ){1,3}manufacturing$|^manufacturing of(?: ${GOODS}){1,3}$`,
);

/**
 * "Managers in manufacturing and utilities" from the duties ALONE, for one
 * who heads the business (live 2026-10-30: "Director" whose duties were
 * "concrete block manufacturing, managed production and sales"). Only that
 * one shape of clause: a wrong occupation is worse than a blank one, so a
 * factory, mill, truck or cook mentioned in passing places nothing, and the
 * trade and service sectors come from the title and employer only (review of
 * 508e7812 / 65fe65a5).
 */
export function irccOccupationFromDuties(
  jobTitle: string | undefined,
  duties: string | undefined,
): IrccOccupation | undefined {
  const t = (jobTitle ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!OWN_ROLE.test(t) || FUNCTION_ROLE.test(t)) return undefined;
  const clauses = (duties ?? '')
    .toLowerCase()
    .split(/[,;.\n]|\band\b/)
    .map((c) => c.replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return clauses.some((c) => MANUFACTURING_CLAUSE.test(c))
    ? {
        activity: IRCC_ACTIVITY.management,
        title: 'Managers in manufacturing and utilities',
      }
    : undefined;
}
