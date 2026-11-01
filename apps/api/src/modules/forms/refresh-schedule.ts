/**
 * When each country's forms and documents are re-checked.
 *
 * WHY PER COUNTRY AND NOT ONE GLOBAL RUN
 *
 * A single nightly UTC pass meant an applicant could open the app at 08:00 in
 * Sydney and be looking at a cache last confirmed 20 hours earlier, while the
 * authority had published a revision in the meantime. Refreshing each country
 * in ITS OWN morning means the copy an applicant sees was confirmed against
 * that government's site hours ago, in that government's day — the freshest
 * point at which a revision published overnight has actually landed.
 *
 * It also spreads the load: instead of ~140 entries hitting five governments in
 * one minute, each authority sees only its own country's handful, at a local
 * hour when its site is up and not in a maintenance window.
 *
 * HOUR
 *
 * 09:00 local, matching the operator's instruction to refresh "in the morning
 * as per country". Overridable with TEMPLATE_REFRESH_HOUR for an operator who
 * wants it earlier or later without a deploy.
 */
export const DEFAULT_REFRESH_HOUR = 9;

export function refreshHour(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TEMPLATE_REFRESH_HOUR;
  if (!raw) return DEFAULT_REFRESH_HOUR;
  const n = Number(raw);
  // A bad value must not silently become 00:00 (Number('') === 0) or crash the
  // scheduler at boot — fall back to the documented default.
  if (!Number.isInteger(n) || n < 0 || n > 23) return DEFAULT_REFRESH_HOUR;
  return n;
}

/**
 * Country code → IANA timezone used for that country's 09:00.
 *
 * One representative zone per country, deliberately. Several of these countries
 * span many zones (Canada has six), and the choice does not need to be exact:
 * it decides which hour of a ~24-hour window the check runs in, and every zone
 * within a country puts 09:00 in the morning. The capital's zone is the
 * defensible pick because it is where the issuing authority sits.
 *
 * A country missing from this map is NOT skipped — it falls back to UTC, so a
 * newly registered country still gets refreshed daily without anyone having to
 * remember this file.
 */
export const COUNTRY_TIMEZONES: Record<string, string> = {
  CA: 'America/Toronto', // IRCC heaquarters, Ottawa
  US: 'America/New_York', // USCIS, Washington DC
  GB: 'Europe/London',
  AU: 'Australia/Sydney', // Home Affairs, Canberra shares this zone
  SCHENGEN: 'Europe/Brussels',
  // Schengen members, capital zones.
  AT: 'Europe/Vienna',
  BE: 'Europe/Brussels',
  BG: 'Europe/Sofia',
  HR: 'Europe/Zagreb',
  CZ: 'Europe/Prague',
  DK: 'Europe/Copenhagen',
  EE: 'Europe/Tallinn',
  FI: 'Europe/Helsinki',
  FR: 'Europe/Paris',
  DE: 'Europe/Berlin',
  GR: 'Europe/Athens',
  HU: 'Europe/Budapest',
  IS: 'Atlantic/Reykjavik',
  IT: 'Europe/Rome',
  LV: 'Europe/Riga',
  LI: 'Europe/Vaduz',
  LT: 'Europe/Vilnius',
  LU: 'Europe/Luxembourg',
  MT: 'Europe/Malta',
  NL: 'Europe/Amsterdam',
  NO: 'Europe/Oslo',
  PL: 'Europe/Warsaw',
  PT: 'Europe/Lisbon',
  RO: 'Europe/Bucharest',
  SK: 'Europe/Bratislava',
  SI: 'Europe/Ljubljana',
  ES: 'Europe/Madrid',
  SE: 'Europe/Stockholm',
  CH: 'Europe/Zurich',
  // Registry-sourced destinations (strategies/country/registry-destinations.ts),
  // capital / issuing-authority zones.
  AE: 'Asia/Dubai', // ICP, Abu Dhabi
  CN: 'Asia/Shanghai', // NIA, Beijing — the PRC observes a single zone
  EG: 'Africa/Cairo',
  HK: 'Asia/Hong_Kong',
  IE: 'Europe/Dublin',
  JO: 'Asia/Amman',
  JP: 'Asia/Tokyo', // Immigration Services Agency, Tokyo
  LB: 'Asia/Beirut',
  MY: 'Asia/Kuala_Lumpur',
  NZ: 'Pacific/Auckland', // INZ, Wellington shares this zone
  OM: 'Asia/Muscat',
  QA: 'Asia/Qatar',
  SG: 'Asia/Singapore',
  TH: 'Asia/Bangkok',
  TR: 'Europe/Istanbul',
};

export function timezoneFor(countryCode: string): string {
  return COUNTRY_TIMEZONES[countryCode.toUpperCase()] ?? 'UTC';
}

export interface CountrySchedule {
  countryCode: string;
  timezone: string;
  /** Cron pattern in that country's local time. */
  pattern: string;
  jobId: string;
}

/**
 * One entry per country, spread across the hour.
 *
 * The minute is derived from the country code rather than fixed at :00 so the
 * 27 Schengen members — which mostly share one or two UTC offsets — do not all
 * fire in the same minute and re-create the thundering herd that got us
 * rate-limited by the European Commission on 2026-08-13. Deterministic, so a
 * given country always runs at the same minute and a log is easy to read.
 */
export function scheduleFor(
  countryCode: string,
  queuePrefix: string,
  env: NodeJS.ProcessEnv = process.env,
): CountrySchedule {
  const code = countryCode.toUpperCase();
  let hash = 0;
  for (const ch of code) hash = (hash * 31 + ch.charCodeAt(0)) % 60;
  return {
    countryCode: code,
    timezone: timezoneFor(code),
    pattern: `${hash} ${refreshHour(env)} * * *`,
    jobId: `${queuePrefix}:${code}`,
  };
}
