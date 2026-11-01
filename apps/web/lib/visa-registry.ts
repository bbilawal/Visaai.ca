import { createClient } from '@supabase/supabase-js'
import { isCountryInSiteScope } from '@/lib/site-config'

/**
 * Read side of the visa registry, for the PUBLIC visa pages.
 *
 * WHY NOT lib/supabase/server.ts
 *
 * That client is built on `cookies()`, which opts the calling route out of
 * static rendering entirely. These pages have no user, no session and no
 * personalization — they are the same bytes for every visitor and for
 * Googlebot — so reading cookies would cost every one of them its cache for
 * nothing.
 *
 * This client uses the anon key with no cookie store, so the pages can be
 * statically generated and revalidated. Everything it reads is already
 * anon-SELECTable by RLS policy
 * (supabase/migrations/20260820120000_visa_registry_core.sql): countries, visa
 * types, active requirements and active sources. There is no path from here to
 * a user row.
 */

function publicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export interface VisaCountry {
  code: string
  slug: string
  name: string
  immigration_authority: string | null
  immigration_authority_url: string | null
  official_visa_url: string | null
  evisa_portal_url: string | null
  last_verified_at: string | null
}

export interface VisaType {
  visaai_id: string
  slug: string
  category: string
  official_name: string
  official_code: string | null
  purpose: string | null
  last_verified_at: string | null
}

export interface VisaSource {
  role: string
  authority: string
  canonical_url: string
  title: string | null
  last_success_at: string | null
}

export interface VisaRequirement {
  requirement_code: string
  kind: string
  officially_required: boolean
  label: string
  description: string | null
  official_form_code: string | null
  official_form_url: string | null
  rule: unknown
  /**
   * Structured values extracted alongside the quote — chiefly fee amounts and
   * currencies, but also maintenance thresholds.
   *
   * This was selected but never read, so every amount stored here was invisible
   * on the public pages. Canada's visitor fee appeared only because the figure
   * happened to be repeated in `description` prose; New Zealand's NZD 441 and
   * Sweden's EUR 90 did not appear at all. A visa page that cannot say what the
   * visa costs is missing the fact people came for.
   */
  parameters: Record<string, unknown> | null
  /**
   * The authority's own words for this requirement, with their own
   * capitalisation — the evidence the whole registry is built to carry.
   *
   * NOT `source_excerpt`. That column is lowercased and whitespace-collapsed by
   * the monitor's normalizer, because a CMS restyling "Fees" to "FEES" has not
   * changed the law. Rendering it inside quotation marks would attribute our
   * processing artifacts to a government — BUG_LOG D-11.
   *
   * NULL is a real state: the authority's wording could not be established for
   * this line. Render no quotation. Never fall back to `source_excerpt`.
   */
  source_excerpt_display: string | null
  display_order: number
}

/**
 * Countries with something worth publishing.
 *
 * `support_state <> 'unsupported'` rather than `= 'supported'`: a country in
 * `preview` has verified authorities, verified visa types and verified
 * official source links, which is a genuinely useful hub page even before its
 * requirements have been extracted and reviewed. What `preview` may NOT do is
 * claim requirements — and it cannot, because there are none to render.
 */
export async function listPublishedCountries(): Promise<VisaCountry[]> {
  const { data, error } = await publicClient()
    .from('visa_countries')
    .select(
      'code, slug, name, immigration_authority, immigration_authority_url, official_visa_url, evisa_portal_url, last_verified_at',
    )
    .neq('support_state', 'unsupported')
    .order('name')
  // A LIST that cannot be read degrades to empty rather than throwing. The
  // index page then says "no destinations are published yet", which is a
  // truthful rendering of "we cannot see any" and keeps the route — and the
  // sitemap that calls this — alive through a database problem. Throwing here
  // produced a 500 whose error document had no <title> and no lang.
  if (error) {
    console.error(`[visa-registry] visa_countries: ${error.message}`)
    return []
  }
  return (data ?? []).filter((country) => isCountryInSiteScope(country.code)) as VisaCountry[]
}

export async function getCountryBySlug(slug: string): Promise<VisaCountry | null> {
  const { data, error } = await publicClient()
    .from('visa_countries')
    .select(
      'code, slug, name, immigration_authority, immigration_authority_url, official_visa_url, evisa_portal_url, last_verified_at',
    )
    .eq('slug', slug)
    .neq('support_state', 'unsupported')
    .maybeSingle()
  // A single-record lookup DOES throw on a query error, deliberately. The
  // caller turns `null` into a 404, and a 404 tells a crawler the page is gone
  // — the wrong thing to say during a database outage. A thrown error becomes
  // a 500, which says "try later". The distinction only matters because these
  // pages are indexed.
  if (error) throw new Error(`visa_countries(${slug}): ${error.message}`)
  const country = (data as VisaCountry) ?? null
  return country && isCountryInSiteScope(country.code) ? country : null
}

export async function listVisaTypes(countryCode: string): Promise<VisaType[]> {
  const client = publicClient()
  const { data: country } = await client
    .from('visa_countries')
    .select('id')
    .eq('code', countryCode)
    .maybeSingle()
  if (!country) return []

  const { data, error } = await client
    .from('visa_types')
    .select(
      'visaai_id, slug, category, official_name, official_code, purpose, last_verified_at',
    )
    .eq('country_id', (country as { id: string }).id)
    .eq('lifecycle_state', 'active')
    .order('category')
  if (error) {
    console.error(`[visa-registry] visa_types(${countryCode}): ${error.message}`)
    return []
  }
  return (data ?? []) as VisaType[]
}

export async function getVisaType(
  countryCode: string,
  visaSlug: string,
): Promise<VisaType | null> {
  const types = await listVisaTypes(countryCode)
  return types.find((t) => t.slug === visaSlug) ?? null
}

/**
 * Official sources for a visa type, plus its country's own index pages.
 *
 * These are what makes a page citable rather than an opinion: every claim on a
 * visa page is either quoted government wording or a link to the page that
 * says it.
 */
export async function listSources(
  countryCode: string,
  visaaiId?: string,
): Promise<VisaSource[]> {
  const client = publicClient()
  const { data: country } = await client
    .from('visa_countries')
    .select('id')
    .eq('code', countryCode)
    .maybeSingle()
  if (!country) return []

  let query = client
    .from('visa_sources')
    .select('role, authority, canonical_url, title, last_success_at, visa_type_id')
    .eq('country_id', (country as { id: string }).id)
    .eq('active', true)

  if (visaaiId) {
    const { data: vt } = await client
      .from('visa_types')
      .select('id')
      .eq('visaai_id', visaaiId)
      .maybeSingle()
    if (!vt) return []
    query = query.eq('visa_type_id', (vt as { id: string }).id)
  } else {
    query = query.is('visa_type_id', null)
  }

  const { data, error } = await query
  if (error) {
    console.error(`[visa-registry] visa_sources: ${error.message}`)
    return []
  }
  return (data ?? []) as VisaSource[]
}

/**
 * Active requirements for a visa type.
 *
 * Only `status = 'active'` rows are readable by anon — the RLS policy enforces
 * it, not this query — so a draft extraction can never reach a page even if
 * this code forgot to filter. Belt and braces on purpose: the thing being
 * prevented is publishing an unreviewed claim about a government's rules.
 */
export async function listRequirements(visaaiId: string): Promise<VisaRequirement[]> {
  const client = publicClient()
  const { data: vt } = await client
    .from('visa_types')
    .select('id')
    .eq('visaai_id', visaaiId)
    .maybeSingle()
  if (!vt) return []

  const { data, error } = await client
    .from('visa_requirements')
    .select(
      'requirement_code, kind, officially_required, label, description, official_form_code, official_form_url, rule, parameters, source_excerpt_display, display_order',
    )
    .eq('visa_type_id', (vt as { id: string }).id)
    .eq('status', 'active')
    .order('display_order')
  // Degrades to empty, which renders "Requirements not yet published" — the
  // same honest state as a visa whose requirements have genuinely not been
  // extracted. It must never render a partial list as if it were complete.
  if (error) {
    console.error(`[visa-registry] visa_requirements(${visaaiId}): ${error.message}`)
    return []
  }
  return (data ?? []) as VisaRequirement[]
}

export interface PublishablePage {
  country_code: string
  country_slug: string
  country_name: string
  visa_slug: string
  visaai_id: string
  official_name: string
  category: string
  official_requirement_count: number
  source_count: number
  last_verified_at: string | null
}

/**
 * The publication gate, read from the database view rather than reimplemented.
 *
 * `visa_publishable_pages` is the ONLY definition of "this visa page may be
 * indexed": supported country, active visa type, at least one active OFFICIAL
 * requirement, at least one active official source. The sitemap, the page
 * renderer and the data-quality report all read this same view, so they cannot
 * drift into disagreeing about which pages exist.
 */
export async function listPublishableVisaPages(): Promise<PublishablePage[]> {
  const { data, error } = await publicClient()
    .from('visa_publishable_pages')
    .select('*')
  // Empty means "publish nothing", which is the safe direction: a database
  // problem must not cause pages to be indexed, only to be withheld.
  if (error) {
    console.error(`[visa-registry] visa_publishable_pages: ${error.message}`)
    return []
  }
  return (data ?? []).filter((page) => isCountryInSiteScope(page.country_code)) as PublishablePage[]
}

/** Human labels for the normalized categories. */
export const CATEGORY_LABELS: Record<string, string> = {
  visitor: 'Visitor',
  tourism: 'Tourism',
  business: 'Business',
  transit: 'Transit',
  student: 'Student',
  work: 'Work',
  skilled_worker: 'Skilled worker',
  temporary_worker: 'Temporary worker',
  seasonal_work: 'Seasonal work',
  working_holiday: 'Working holiday',
  youth_mobility: 'Youth mobility',
  digital_nomad: 'Digital nomad',
  investor: 'Investor',
  entrepreneur: 'Entrepreneur',
  family: 'Family',
  spouse_partner: 'Spouse or partner',
  parent: 'Parent',
  dependant: 'Dependant',
  family_reunification: 'Family reunification',
  research: 'Research',
  academic: 'Academic',
  exchange: 'Exchange',
  medical: 'Medical',
  religious: 'Religious',
  volunteer: 'Volunteer',
  diplomatic: 'Diplomatic',
  official: 'Official',
  media: 'Media',
  crew: 'Crew',
  performer: 'Performer',
  cultural_sport: 'Cultural or sport',
  humanitarian: 'Humanitarian',
  permanent_residence: 'Permanent residence',
  evisa: 'eVisa',
  eta: 'Travel authorisation',
  other: 'Other',
}

export const SOURCE_ROLE_LABELS: Record<string, string> = {
  index: 'Official visa index',
  landing: 'Official page',
  eligibility: 'Eligibility',
  requirements: 'Requirements',
  documents: 'Document checklist',
  forms: 'Official form',
  fees: 'Fees',
  processing_times: 'Processing times',
  application: 'How to apply',
  policy: 'Policy',
  news: 'Updates',
}

/**
 * How many of a visa type's requirements are documents the APPLICANT uploads.
 *
 * Exists to tell two empty checklists apart, which look identical to the intake
 * sidebar and mean opposite things:
 *
 *   * no route chosen yet — documents genuinely will appear once one is;
 *   * a route chosen whose requirements contain NO applicant documents.
 *
 * The second is real. The Dutch highly skilled migrant permit has fourteen
 * requirements and zero uploads: only an IND-recognised sponsor can lodge it,
 * and IND publishes no applicant-facing document list. Telling that person
 * "documents will appear here" is a promise nothing will ever keep.
 *
 * `evidence` and `recommended` are the document kinds — the same pair
 * `registry-to-framework.ts` uses to build a checklist. Conditions, steps and
 * fees are requirements too, but they are not things you put in a folder.
 *
 * Returns null when the answer is unknown (no route, or the read failed), which
 * the caller must treat as "say nothing" rather than "zero".
 */
export async function countApplicantDocuments(
  visaTypeId: string | null,
): Promise<{ documents: number; total: number } | null> {
  if (!visaTypeId) return null

  const { data, error } = await publicClient()
    .from('visa_requirements')
    .select('kind')
    .eq('visa_type_id', visaTypeId)
    .eq('status', 'active')

  if (error || !data) {
    console.error(
      `[visa-registry] countApplicantDocuments: ${error?.message ?? 'no rows'}`,
    )
    return null
  }
  if (data.length === 0) return null

  const documents = data.filter(
    (r) => r.kind === 'evidence' || r.kind === 'recommended',
  ).length
  return { documents, total: data.length }
}
