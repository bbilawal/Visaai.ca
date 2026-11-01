import { CA_BUSINESS_VISITOR_VISAAI_ID } from './business-visitor'
import { CA_ETA_VISAAI_ID } from './canada-eta'
import { CA_EE_VISAAI_ID } from './canada-express-entry'
import { CA_SPOUSAL_VISAAI_ID } from './canada-spousal-sponsorship'
import { CA_STUDY_VISAAI_ID } from './canada-study-permit'
import { CA_WORK_VISAAI_ID } from './canada-work-permit'
import { SUPER_VISA_ID } from './super-visa'

/**
 * Which generated letters a route uses.
 *
 * WHY THIS EXISTS
 *
 * The Generate stage offered — and progress REQUIRED — a letter of explanation
 * and a cover letter for every application (`REQUIRED_GEN_TYPES` in the API and
 * a copy in the web). Dry run 2026-10-16: a Canada eTA applicant was offered an
 * LOE, itinerary and cover letter for a CAD 7 online form that accepts no
 * attachments, the LOE said "applying for a visitor visa", and the stage could
 * never complete because nothing would ever be approved.
 *
 * Configuration, keyed like ROUTE_FACTS: a route with no entry keeps today's
 * behaviour. Pure — shared by the API (progress, narrative) and the web app.
 */

export type LetterType = 'loe' | 'itinerary' | 'cover_letter' | 'invitation_letter'

/** Every letter the Generate step can draft and store. */
export const LETTER_TYPES: readonly LetterType[] = [
  'loe',
  'itinerary',
  'cover_letter',
  'invitation_letter',
]

/** What a route with no entry below is offered — the original three. */
export const ALL_LETTER_TYPES: readonly LetterType[] = ['loe', 'itinerary', 'cover_letter']
/** Itinerary stays optional, as it always was. */
export const DEFAULT_REQUIRED_LETTERS: readonly LetterType[] = ['loe', 'cover_letter']

interface RouteLetters {
  country: string
  visaaiIds: readonly string[]
  /** Letters the Generate page offers. */
  offered: readonly LetterType[]
  /** Letters the Generate stage needs approved to be complete. Subset of offered. */
  required: readonly LetterType[]
}

export const ROUTE_LETTERS: readonly RouteLetters[] = [
  {
    // IRCC's eTA is a short online form with no document upload at
    // submission; a letter has nowhere to go.
    country: 'CA',
    visaaiIds: [CA_ETA_VISAAI_ID],
    offered: [],
    required: [],
  },
  {
    // An Express Entry profile takes no attachments, and nothing is decided
    // on a letter. Not even the letter of explanation is offered: the
    // Generate brief is a visitor's (purpose of travel, ties to home,
    // intent to return), a self-contradicting statement on a permanent
    // residence file. Offer one once it has a permanent-residence brief.
    country: 'CA',
    visaaiIds: [CA_EE_VISAAI_ID],
    offered: [],
    required: [],
  },
  {
    // Spousal sponsorship: the same reason. The Generate briefs argue a
    // visit (purpose of travel, ties to home, intent to return), which
    // contradicts a permanent-residence file built on a relationship.
    country: 'CA',
    visaaiIds: [CA_SPOUSAL_VISAAI_ID],
    offered: [],
    required: [],
  },
  {
    // A study permit is decided on the study plan: IRCC recommends a letter
    // of explanation saying why this program, why Canada, how it is paid
    // for and that the applicant will leave when it ends. The visitor
    // itinerary does not apply; the letters use the study briefs
    // (draft-document.ts).
    country: 'CA',
    visaaiIds: [CA_STUDY_VISAAI_ID],
    offered: ['loe', 'cover_letter'],
    required: ['loe'],
  },
  {
    // A work permit is decided on the job: the LMIA or offer of employment,
    // the contract and the applicant's qualifications. IRCC prescribes no
    // letter for it, so neither is required; a letter of explanation and a
    // cover letter are offered, written from the work briefs
    // (draft-document.ts) so neither says "visitor visa". No itinerary:
    // there is no trip.
    country: 'CA',
    visaaiIds: [CA_WORK_VISAAI_ID],
    offered: ['cover_letter', 'loe'],
    required: [],
  },
  {
    // A super visa is decided on the host's letter of invitation — IRCC makes
    // it mandatory and prescribes what it must say — so it is offered first
    // and required.
    country: 'CA',
    visaaiIds: [SUPER_VISA_ID],
    offered: ['invitation_letter', 'cover_letter', 'loe', 'itinerary'],
    required: ['invitation_letter', 'loe', 'cover_letter'],
  },
  {
    // A business visitor is decided on what they will do in Canada and who
    // pays them. The Canadian company's letter of invitation is offered but
    // not required: IRCC lists it as supporting evidence, and not every trip
    // (buying goods, a public trade fair) has an inviting company.
    country: 'CA',
    visaaiIds: [CA_BUSINESS_VISITOR_VISAAI_ID],
    offered: ['loe', 'cover_letter', 'invitation_letter', 'itinerary'],
    required: ['loe', 'cover_letter'],
  },
]

interface RouteCtx {
  country?: string | null
  visaaiId?: string | null
}

function entryFor(ctx: RouteCtx): RouteLetters | undefined {
  const country = ctx.country?.trim().toUpperCase() ?? ''
  const id = ctx.visaaiId?.trim() ?? ''
  if (!id) return undefined
  return ROUTE_LETTERS.find(
    (r) => (!country || r.country === country) && r.visaaiIds.includes(id),
  )
}

/** Letters the route offers on the Generate page. */
export function offeredGenTypesForRoute(ctx: RouteCtx = {}): LetterType[] {
  return [...(entryFor(ctx)?.offered ?? ALL_LETTER_TYPES)]
}

/** Letters the route needs approved before Generate is complete. Empty = nothing to do. */
export function requiredGenTypesForRoute(ctx: RouteCtx = {}): LetterType[] {
  return [...(entryFor(ctx)?.required ?? DEFAULT_REQUIRED_LETTERS)]
}

/** Letters offered for a registry route id, when only the id is known. */
export function lettersForRoute(visaaiId: string | null | undefined): LetterType[] {
  return offeredGenTypesForRoute({ visaaiId })
}
