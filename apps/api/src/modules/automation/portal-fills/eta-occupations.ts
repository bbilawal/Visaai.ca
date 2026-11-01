import { IRCC_ACTIVITY, irccOccupationFor } from './ircc-occupations';

/**
 * The IRCC eTA form's marital-status and occupation selects, recorded live on
 * 2026-10-18 (GBR persona). Both are REQUIRED on the form; option values are
 * list indexes, so every answer is the option TEXT below.
 *
 * Every reading here is deliberately narrow: an answer that does not name one
 * option unambiguously resolves to nothing and the applicant chooses. A wrong
 * occupation or marital status on a travel authorization is worse than a blank.
 */

/** `personalDetails_maritalStatus` options, as shown. */
export const ETA_MARITAL_OPTIONS = [
  'Married',
  'Legally Separated',
  'Divorced',
  'Annulled Marriage',
  'Widowed',
  'Common-Law',
  'Never Married/Single',
] as const;

/**
 * A marital-status answer → the eTA option. Same reading as the IRCC tr-rt
 * mapping (canada-ircc.ts `maritalStatus`), with the eTA's own wording:
 * "Separated" is "Legally Separated", "Single" is "Never Married/Single".
 * Anything else (engaged, "it's complicated", a blank) answers nothing.
 */
export function etaMaritalOption(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return undefined;
  const exact = ETA_MARITAL_OPTIONS.find((o) => o.toLowerCase() === s);
  if (exact) return exact;
  // "not married", "not yet divorced", "no longer separated": a negation
  // says what the status is NOT. The applicant chooses.
  if (/\b(not|no longer)\b/.test(s)) return undefined;
  if (/annul/.test(s)) return 'Annulled Marriage';
  if (/common[- ]?law/.test(s)) return 'Common-Law';
  // Before "divorc": "separated, divorce pending" is not yet divorced.
  if (/separat/.test(s)) return 'Legally Separated';
  if (/divorc/.test(s)) return 'Divorced';
  if (/widow/.test(s)) return 'Widowed';
  if (/^(single|never married|unmarried|never married ?\/ ?single)$/.test(s))
    return 'Never Married/Single';
  if (/^married$/.test(s)) return 'Married';
  return undefined;
}

/** `employmentDetails_occupation` options, as shown. */
export const ETA_OCCUPATION = {
  art: IRCC_ACTIVITY.art,
  business: IRCC_ACTIVITY.business,
  education: IRCC_ACTIVITY.education,
  health: IRCC_ACTIVITY.health,
  homemaker: 'Homemaker',
  management: IRCC_ACTIVITY.management,
  manufacturing: IRCC_ACTIVITY.manufacturing,
  military: 'Military/armed forces',
  science: IRCC_ACTIVITY.science,
  resources: IRCC_ACTIVITY.resources,
  retired: 'Retired',
  sales: IRCC_ACTIVITY.sales,
  student: 'Student',
  trades: IRCC_ACTIVITY.trades,
  unemployed: 'Unemployed',
} as const;

const O = ETA_OCCUPATION;

/** Every option of the occupation select, in the form's order. */
export const ETA_OCCUPATION_OPTIONS: readonly string[] = [
  O.art,
  O.business,
  O.education,
  O.health,
  O.homemaker,
  O.management,
  O.manufacturing,
  O.military,
  O.science,
  O.resources,
  O.retired,
  O.sales,
  O.student,
  O.trades,
  O.unemployed,
];

/** Categories that open no follow-up question. */
export const ETA_NO_FOLLOW_UP: readonly string[] = [
  O.retired,
  O.homemaker,
  O.unemployed,
];

/**
 * Categories that open the job-title select (every working category). The
 * title list of Military/armed forces is 68 Canadian Armed Forces trades: it
 * is never mapped, the applicant chooses.
 */
export const ETA_WORKING: readonly string[] = [
  O.art,
  O.business,
  O.education,
  O.health,
  O.management,
  O.manufacturing,
  O.military,
  O.science,
  O.resources,
  O.sales,
  O.trades,
];

/** Working categories whose title the assistant may choose (not military). */
export const ETA_TITLED: readonly string[] = ETA_WORKING.filter(
  (c) => c !== O.military,
);

/** Categories that open employer/school name, country, city and since-year. */
export const ETA_WITH_DETAILS: readonly string[] = [...ETA_WORKING, O.student];

/**
 * `employmentDetails_title` options per category, as recorded. The list is
 * loaded asynchronously 1–5 s after the category changes.
 */
export const ETA_TITLES: Readonly<Record<string, readonly string[]>> = {
  [O.art]: [
    'Announcers and other performers',
    'Athletes, coaches, referees and related occupations',
    'Creative and performing artists',
    'Creative designers and craftspersons',
    'Librarian, archivist, conservator or curator',
    'Photographers, graphic arts technicians, technical and coordinating occupations in motion pictures, broadcasting and the performing arts',
    'Technical occupations in libraries, public archives, museums and art galleries',
    'Writing, translating and related communications professionals',
  ],
  [O.business]: [
    'Administrative and regulatory occupations',
    'Administrative services supervisors',
    'Auditors, accountants and investment professionals',
    'Court reporters, transcriptionists, records management technicians and statistical officers',
    'Finance, insurance and related business administrative occupations',
    'Financial, insurance and related administrative support workers',
    'General office workers',
    'Human resources and business service professionals',
    'Library, correspondence and other clerks',
    'Mail and message distribution occupations',
    'Office administrative assistants - general, legal and medical',
    'Office equipment operators',
    'Supply chain logistics, tracking and scheduling coordination occupations',
  ],
  [O.education]: [
    'College and other vocational instructors',
    'Home care providers and educational support occupations',
    'Judges, lawyers and notaries',
    'Legal and public protection support occupations',
    'Occupations in front-line public protection services',
    'Paraprofessional occupations in legal, social, community and education services',
    'Policy and program researchers, consultants and officers',
    'Secondary and elementary school teachers and educational counsellors',
    'Social and community service professionals',
    'University professors and post-secondary assistants',
  ],
  [O.health]: [
    'Assisting occupations in support of health services',
    'Medical technologists and technicians',
    'Optometrists, chiropractors, other health diagnosing and treating professionals',
    'Other technical occupations in health care',
    'Pharmacists, dieticians and nutritionists',
    'Physicians, dentists and veterinarians',
    'Professional occupations in nursing',
    'Technical occupations in dental health care',
    'Therapy and assessment professionals',
  ],
  [O.management]: [
    'Administrative services managers',
    'Corporate sales managers',
    'Legislators and senior management, including political officials',
    'Managers in agriculture, horticulture and aquaculture',
    'Managers in art, culture, recreation and sport',
    'Managers in communication',
    'Managers in construction, facility operation and maintenance',
    'Managers in customer and personal services',
    'Managers in education and social and community services',
    'Managers in engineering, architecture, science and information systems',
    'Managers in financial and business services',
    'Managers in food service and accommodation',
    'Managers in health care',
    'Managers in manufacturing and utilities',
    'Managers in natural resources production and fishing',
    'Managers in public administration',
    'Managers in public protection services',
    'Managers in transportation',
    'Retail and wholesale trade managers',
  ],
  [O.manufacturing]: [
    'Central control and process operators in processing and manufacturing',
    'Labourers in processing, manufacturing and utilities',
    'Machine operators and related workers in chemical, plastic and rubber processing',
    'Machine operators and related workers in food, beverage and associated products processing',
    'Machine operators and related workers in mineral and metal products processing and manufacturing',
    'Machine operators and related workers in pulp and paper production and wood processing and manufacturing',
    'Machine operators and related workers in textile, fabric, fur and leather products processing and manufacturing',
    'Mechanical, electrical and electronics assemblers',
    'Other assembly and related occupations',
    'Printing equipment operators and related occupations',
    'Supervisors in assembly and fabrication',
    'Supervisors in processing and manufacturing occupations',
    'Utilities equipment operators and controllers',
  ],
  [O.science]: [
    'Architects, urban planners and land surveyors',
    'Civil, mechanical, electrical and chemical engineers',
    'Computer and information systems professionals',
    'Life science professionals',
    'Mathematicians, statisticians and actuaries',
    'Other engineers',
    'Other technical inspectors and regulatory officers',
    'Physical science professionals',
    'Technical occupations in architecture, drafting, surveying, geomatics and meteorology',
    'Technical occupations in civil, mechanical and industrial engineering',
    'Technical occupations in computer and information systems',
    'Technical occupations in electronics and electrical engineering',
    'Technical occupations in life sciences',
    'Technical occupations in physical science',
    'Transportation officers and controllers',
  ],
  [O.resources]: [
    'Agriculture and horticulture workers',
    'Contractors and supervisors in agriculture, horticulture and related operations and services',
    'Contractors and supervisors in mining, oil and gas',
    'Fishing vessel masters and fishermen/fisherwomen',
    'Harvesting, landscaping and natural resources labourers',
    'Logging and forestry workers',
    'Logging machinery operators',
    'Mine service workers and operators in oil and gas drilling',
    'Other workers in fishing and trapping and hunting occupations',
    'Supervisors, logging and forestry',
    'Underground miners, oil and gas drillers and related occupations',
  ],
  [O.sales]: [
    'Butchers and bakers',
    'Cashiers',
    'Chefs and cooks',
    'Cleaners',
    'Customer and information services representatives',
    'Food counter attendants, kitchen helpers and related support occupations',
    'Insurance, real estate and financial sales occupations',
    'Occupations in food and beverage services',
    'Occupations in travel and accommodation',
    'Other occupations in personal services',
    'Other sales support and related occupations',
    'Other service support and related occupations',
    'Retail sales supervisors',
    'Retail salespersons',
    'Sales and account representatives',
    'Security guards and related security service occupations',
    'Service supervisors',
    'Specialized occupations in personal and customer services',
    'Support occupations in accommodation, travel and amusement services',
    'Technical sales specialists in wholesale trade and retail and wholesale buyers',
    'Tourism and amusement services occupations',
  ],
  [O.trades]: [
    'Automotive service technicians',
    'Carpenters and cabinetmakers',
    'Contractors and supervisors in industrial, electrical and construction trades and related workers',
    'Contractors and supervisors in maintenance trades and heavy equipment and transport operators',
    'Crane operators, drillers and blasters',
    'Electrical trades and electrical power line and telecommunications workers',
    'Heavy equipment operators',
    'Longshore workers and material handlers',
    'Machinery and transportation equipment mechanics',
    'Machining, metal forming, shaping and erecting trades',
    'Masonry and plastering trades',
    'Motor vehicle and transit drivers',
    'Other construction trades',
    'Other installers, repairers and servicers',
    'Other mechanics and related repairers',
    'Other transport equipment operators and related maintenance workers',
    'Plumbers, pipefitters and gas fitters',
    'Printing press operators, other trades and related occupations',
    'Public works and other labourers',
    'Trades helpers and labourers',
    'Train crew operating occupations',
  ],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The option whose text this answer IS (case and spacing aside). */
export function exactOption(
  raw: string | undefined,
  options: readonly string[],
): string | undefined {
  if (!raw) return undefined;
  const s = norm(raw);
  return options.find((o) => norm(o) === s);
}

/** What an employment answer says about working, anywhere in it. */
export interface EtaStatusReading {
  /** Non-working statuses it names (Retired, Homemaker, Student, Unemployed). */
  statuses: string[];
  /** It names a FORMER job ("former teacher", "ex-police", "used to be"). */
  past: boolean;
  /** Part-way statuses no single option covers ("semi-retired"). */
  unsure: boolean;
}

const STATUS_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\b(retired|retiree|pensioner)\b/, O.retired],
  [
    /\b(home ?maker|house ?wife|house ?husband|stay[- ]at[- ]home)\b/,
    O.homemaker,
  ],
  // "student counsellor", "student services officer"… are jobs.
  [
    /\bstudent\b(?!\s+(counsell?or|advis[eo]r|affairs|services?|officer|coordinator|support|recruit\w*|loans?|union))/,
    O.student,
  ],
  [
    /\b(unemployed|jobless|job ?seeker|between jobs|out of work|not (currently )?(employed|working)|looking for (a )?(job|work))\b/,
    O.unemployed,
  ],
];

const PAST_JOB =
  /\b(former(ly)?|ex-|previously|used to|retired from|worked as)\b/;

/**
 * Read an employment answer for statuses ANYWHERE in it, not only as the
 * whole answer: "Retired school teacher", "unemployed (former engineer)" and
 * "Student, part-time cashier" all name a status beside a job, and a keyword
 * match on the job alone would put a retired teacher in Education.
 * "Retirement planner" names no status (the word is "retirement").
 */
export function etaStatusesIn(raw: string | undefined): EtaStatusReading {
  if (!raw) return { statuses: [], past: false, unsure: false };
  const s = norm(raw);
  return {
    statuses: STATUS_WORDS.filter(([re]) => re.test(s)).map(([, o]) => o),
    past: PAST_JOB.test(s),
    unsure: /\b(semi-?retired|partly retired|part-retired)\b/.test(s),
  };
}

const ARMED_SERVICE =
  /\b(armed forces|military|soldier|marine corps|air force|airman|airwoman)\b/;
const ARMY_OR_NAVY_ROLE =
  /\b(army|navy|naval)\s+(officer|soldier|captain|major|colonel|lieutenant|sergeant|corporal|private|general|commander|commodore|admiral|personnel|serviceman|servicewoman|engineer|doctor|pilot|cadet|nurse)\b|\b(officer|soldier|captain|major|colonel|lieutenant|sergeant|corporal|cadet|serving)\s+(in|with) the (army|navy)\b/;

/**
 * Armed-forces service named in a job title. Category only, never a title.
 * A bare "army" or "navy" is not enough ("navy blue", "Salvation Army").
 */
export function isMilitary(raw: string | undefined): boolean {
  if (!raw) return false;
  const s = norm(raw);
  if (/\bsalvation army\b/.test(s)) return false;
  return ARMED_SERVICE.test(s) || ARMY_OR_NAVY_ROLE.test(s);
}

/**
 * A free-text job title → the eTA working category and (when the recorded
 * list has it) title. Reuses the IRCC tr-rt rules in ircc-occupations.ts:
 * their groups are the same option texts on the eTA; a title the eTA list
 * does not carry keeps the category and leaves the title to the applicant.
 */
export function etaWorkFor(
  jobTitle: string | undefined,
): { category: string; title?: string } | undefined {
  if (!jobTitle) return undefined;
  if (isMilitary(jobTitle)) return { category: O.military };
  const occ = irccOccupationFor(jobTitle);
  if (!occ || !ETA_TITLED.includes(occ.activity)) return undefined;
  const title = ETA_TITLES[occ.activity]?.includes(occ.title)
    ? occ.title
    : undefined;
  return { category: occ.activity, ...(title ? { title } : {}) };
}
