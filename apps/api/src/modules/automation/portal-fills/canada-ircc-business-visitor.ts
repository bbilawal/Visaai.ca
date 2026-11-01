import { intakeAnswerIsYes } from '@visaai/types';
import { NO_HOST_NOTE_LABEL } from './canada-ircc'; // registers the visitor mapping this one extends
import {
  registerPortalFillVariant,
  resolvePortalFill,
  resolvePortalFillExtras,
  type FillFieldMapping,
  type ManualFieldNote,
  type PortalPageInfo,
} from '../../../strategies/portal-integration/portal-fill.registry';
import { declared, pickText, type Profile } from './ircc-profile';
import { composePurposeOfVisit } from '../../shared/profile/purpose-description';

/**
 * Canada business visitor (registry `ca-business-visitors`) on IRCC tr-rt.
 *
 * A business visitor who needs a visa applies in the same Portal
 * temporary-residence application as any visitor: "I want to apply for:
 * Visitor visa" (464), then the visa type "Business" (473, recorded live
 * 2026-10-18 in the /purpose radio list). The form has no business-only
 * page. So this is the visitor mapping (canada-ircc.ts), every write
 * unchanged, plus:
 *
 *  - /purpose: the visitor mapping derives the visa type from the stated
 *    purpose and the host, so "meeting my brother's company" or a host who is
 *    a relative turned a business trip into a family visit (or nothing). Here
 *    it is always Business.
 *  - /purpose text: when the applicant typed no real description (nothing,
 *    or "Business"), one is composed from the business answers (company,
 *    activity) plus the dates; tr-rt caps it at 475 characters
 *    (`max475Chars`).
 *  - /inviter-info: the inviter is the contact at a Canadian company or the
 *    organiser of an event, so the relationship is "Organization" (or
 *    "Conference" for a conference, trade fair or convention) unless the
 *    profile says otherwise — and never the relative being visited or the
 *    hotel, which the visitor mapping falls back to.
 *    IRCC then asks the organization's or conference's name
 *    (`#nameOfOrgInviter_input`, required, live 2026-10-19): the Canadian
 *    business, or the event's name for a conference.
 *  - /special-event-code (business route only, right after /inviter-info,
 *    live 2026-10-19): "Do you have a special event code?" — No when the
 *    trip is not for an event or the applicant has no code, Yes with a code.
 *    Yes reveals "Enter the special event code" (`#codeIRCC_input`,
 *    required, live 2026-10-19), filled with the code.
 *  - Documents (/doc-upload) are the applicant's: listed in coverage — the
 *    Canadian company's invitation, the employer's letter, event
 *    registration, and the warranty or service contract for after-sales work.
 */

const PURPOSE = '/purpose';
const INVITER = '/inviter-info';
const DOCS = '/doc-upload';
const SPECIAL_EVENT = '/special-event-code';

export const BUSINESS_VISITOR_ID = 'ca-business-visitors';

/** tr-rt's `visitDetails` limit (validation `max475Chars`). */
const PURPOSE_MAX = 475;

const activity = (p: Profile) =>
  pickText(p, 'business_activity', 'business_activities', 'business_purpose');

const company = (p: Profile) =>
  pickText(
    p,
    'canadian_business_name',
    'canadian_company_name',
    'host_company_name',
    'inviting_company_name',
    'event_name',
  );

/** The Canadian business itself (not an event), from the business answers. */
const businessName = (p: Profile) =>
  pickText(
    p,
    'canadian_business_name',
    'canadian_company_name',
    'host_company_name',
    'inviting_company_name',
    'inviter_organization',
    'inviter_organization_name',
    'inviter_company',
    'inviter_company_name',
  );

const eventName = (p: Profile) =>
  pickText(p, 'event_name', 'conference_name', 'business_event_name');

/**
 * "No", "none", "n/a", "I don't have one": the interview asks the event code
 * with "say 'no' if there is none", so a negative is no code, not the code
 * "no" (audit 2026-10-19: the applicant was told to "enter your IRCC event
 * code no").
 */
const NO_EVENT_CODE =
  /^(no(ne| code| event code)?|n\/?a|nil|nothing|not applicable|not given|(i )?(don'?t|do not) have( one| a code| any( code)?)?)[.!]?$/i;

/**
 * The applicant's event-code answer: a real code, "no code" (`none`), a bare
 * "yes" with no code given (`has`), or nothing stated.
 */
function eventCodeAnswer(p: Profile): {
  code?: string;
  none?: boolean;
  has?: boolean;
} {
  for (const k of ['event_code', 'special_event_code', 'ircc_event_code']) {
    const v = p[k];
    if (typeof v === 'boolean') return v ? { has: true } : { none: true };
    // A number is a code (12345), not a yes/no.
    const t = pickText(p, k);
    if (!t) continue;
    if (typeof v === 'string') {
      if (NO_EVENT_CODE.test(t) || intakeAnswerIsYes(t) === false)
        return { none: true };
      if (intakeAnswerIsYes(t) === true) return { has: true };
    }
    return { code: t };
  }
  return {};
}

const eventCode = (p: Profile) => eventCodeAnswer(p).code;

/** A conference, convention or trade fair, from the activity or the event answers. */
export function isBusinessEvent(p: Profile): boolean {
  if (declared(p, 'attending_business_event') === 'Yes') return true;
  if (declared(p, 'attending_business_event') === 'No') return false;
  return /\b(conference|convention|trade (show|fair)|exhibition|expo|summit)\b/i.test(
    activity(p) ?? '',
  );
}

/**
 * The short phrase a business description starts from, only from what was
 * answered: "Business visit to Maple Robotics Inc. for contract meetings".
 * The universal composition (purpose-description.ts) then adds the dates.
 */
export function businessPurposePhrase(p: Profile): string | undefined {
  const what = activity(p)?.replace(/[.\s]+$/, '');
  // The company keeps its own period ("Inc."); only the comparison drops it.
  const who = company(p)?.trim();
  if (!what && !who) return undefined;
  const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  const bare = who?.replace(/[.\s]+$/, '').toLowerCase();
  const named = !!what && !!bare && what.toLowerCase().includes(bare);
  if (!what) return `Business visit to ${who}`;
  // "meet suppliers" reads "to meet suppliers"; "contract meetings" reads
  // "for contract meetings".
  const verb =
    /^(meet|attend|negotiate|visit|buy|purchase|install|repair|service|train|inspect|sign|discuss|explore|present|exhibit|tour|deliver|consult|review|sell)\b/i.test(
      what,
    );
  const join = verb ? 'to' : 'for';
  if (!who || named) return `Business visit ${join} ${lower(what)}`;
  return `Business visit to ${who} ${join} ${lower(what)}`;
}

/**
 * A typed purpose too thin to describe the trip ("Business", "meeting"):
 * three words or fewer. A real description is kept as written.
 */
const thinPurpose = (v: unknown): boolean =>
  v == null ||
  (typeof v === 'string' &&
    v.trim() !== '' &&
    v.trim().split(/\s+/).length <= 3);

/**
 * The description IRCC receives: the applicant's own when it says something,
 * otherwise composed from the business answers. A blank someone left on the
 * form stays blank.
 */
function normalizeBusiness(p: Profile, raw: Profile): Profile {
  if (!thinPurpose(raw.purpose_of_visit)) return p;
  const phrase = businessPurposePhrase(p);
  if (!phrase) return p;
  const text = composePurposeOfVisit(p, phrase) ?? phrase;
  return text.length > PURPOSE_MAX ? p : { ...p, purpose_of_visit: text };
}

/** The visitor mapping's visa purpose, answered "Business" (473, live 2026-10-18). */
const BUSINESS_PURPOSE_ANSWER = (f: FillFieldMapping): FillFieldMapping => ({
  ...f,
  label: 'Visa type: business',
  derive: () => 'Business',
});

/**
 * The visitor mapping finds the inviter in the family being visited and the
 * accommodation provider when no inviter is named; on a business trip that
 * made a brother in Canada, or the hotel, the inviter (review 2026-10-18).
 * Here only the inviter / host / business contact answers count.
 */
const withoutVisitedFamily = (p: Profile): Profile => ({
  ...p,
  family_in_destination: false,
  family_member_name: undefined,
  relationship_to_family_in_destination: undefined,
  accommodation_provider_name: undefined,
  inviter_name: p.inviter_name ?? p.business_contact_name,
  inviter_phone: p.inviter_phone ?? p.business_contact_phone,
  inviter_email: p.inviter_email ?? p.business_contact_email,
  inviter_address:
    p.inviter_address ?? p.canadian_business_address ?? p.company_address,
});

function businessInviter(f: FillFieldMapping): FillFieldMapping {
  const base = f.derive;
  if (!base) return f;
  return { ...f, derive: (p) => base(withoutVisitedFamily(p)) };
}

/** A business visitor's inviter is a company or an event, not a relative. */
function withHostIsOrganization(f: FillFieldMapping): FillFieldMapping {
  const base = f.derive;
  return {
    ...f,
    derive: (p) =>
      base?.(withoutVisitedFamily(p)) ??
      (isBusinessEvent(p) ? 'Conference' : 'Organization'),
  };
}

/**
 * "Name of organization or conference": the event for a Conference, the
 * Canadian business for an Organization — a name the profile gives the
 * inviter's organization first.
 */
function organizationName(
  f: FillFieldMapping,
  relation: (p: Profile) => unknown,
): FillFieldMapping {
  const base = f.derive;
  return {
    ...f,
    derive: (p) => {
      const raw = base?.(withoutVisitedFamily(p));
      const stated = raw != null && raw !== '' ? raw : undefined;
      // A conference is named by its event, before any company answer.
      return relation(p) === 'Conference'
        ? (eventName(p) ?? stated ?? businessName(p))
        : (stated ?? businessName(p));
    },
  };
}

/**
 * "Do you have a special event code?" only on an explicit answer: No when
 * the applicant has no code ("no" to the event-code question) or is not
 * attending a business event; Yes when they gave a code or said they have
 * one. Nothing stated is the applicant's answer. The code goes in the box
 * Yes reveals (SPECIAL_EVENT_CODE_VALUE).
 */
export function specialEventCodeAnswer(p: Profile): 'Yes' | 'No' | undefined {
  const said = declared(p, 'has_special_event_code', 'has_event_code');
  if (said) return said;
  const answer = eventCodeAnswer(p);
  if (answer.code || answer.has) return 'Yes';
  if (answer.none) return 'No';
  return declared(p, 'attending_business_event') === 'No' ? 'No' : undefined;
}

const SPECIAL_EVENT_CODE: FillFieldMapping = {
  page: SPECIAL_EVENT,
  profileKey: 'has_special_event_code',
  selector: '[name="hasSpecialEventCode"]',
  choices: {
    Yes: '#hasSpecialEventCode_radio-button-01-input',
    No: '#hasSpecialEventCode_radio-button-02-input',
  },
  op: 'radio',
  action: 'fill',
  label: 'Special event code',
  category: 'travel_history',
  derive: specialEventCodeAnswer,
  // Listed by businessNotes when unanswered.
  silent: true,
};

/** "Enter the special event code" (#codeIRCC_input, live 2026-10-19). */
const SPECIAL_EVENT_CODE_VALUE: FillFieldMapping = {
  page: SPECIAL_EVENT,
  // Its own key: `event_code` may hold true / "yes", never a code to type.
  profileKey: 'ircc_special_event_code',
  selector: '#codeIRCC_input',
  action: 'fill',
  label: 'Special event code — the code',
  category: 'travel_history',
  derive: eventCode,
  reveal: true,
  parent: SPECIAL_EVENT_CODE.profileKey,
  parentValue: 'Yes',
  // A Yes with no code is listed by businessNotes.
  silent: true,
};

function buildMapping(visitor: FillFieldMapping[]): FillFieldMapping[] {
  const relationField = visitor.find(
    (f) => f.page === INVITER && f.profileKey === 'inviter_relationship',
  );
  const relation = relationField
    ? withHostIsOrganization(relationField).derive!
    : () => undefined;
  const out = visitor.map((f) => {
    if (f.page === PURPOSE && f.profileKey === 'purpose_of_visit')
      return { ...f, maxLength: PURPOSE_MAX };
    if (f.page === PURPOSE && f.profileKey === 'ircc_visa_purpose')
      return BUSINESS_PURPOSE_ANSWER(f);
    if (f.page === INVITER && f.profileKey === 'inviter_relationship')
      return withHostIsOrganization(f);
    if (f.page === INVITER && f.profileKey === 'inviter_organization_name')
      return organizationName(f, relation);
    if (f.page === INVITER && f.profileKey.startsWith('inviter_'))
      return businessInviter(f);
    return f;
  });
  // The special-event-code page follows the invitation page.
  let at = -1;
  out.forEach((f, i) => {
    if (f.page === INVITER) at = i;
  });
  if (at === -1) out.push(SPECIAL_EVENT_CODE, SPECIAL_EVENT_CODE_VALUE);
  else out.splice(at + 1, 0, SPECIAL_EVENT_CODE, SPECIAL_EVENT_CODE_VALUE);
  return out;
}

// ── what the applicant does: documents the portal asks them to upload ───────
function businessNotes(
  p: Profile,
  exclude: ReadonlySet<string>,
): ManualFieldNote[] {
  const who = company(p) ?? 'the Canadian company or organization';
  const notes: ManualFieldNote[] = [];
  const codeAnswer = specialEventCodeAnswer(p);
  if (exclude.has(SPECIAL_EVENT_CODE.profileKey)) {
    // The consultant took the question out of the fill: nothing is written.
  } else if (!codeAnswer) {
    notes.push({
      page: SPECIAL_EVENT,
      label: 'Special event code',
      reason: 'needs_your_answer',
      note: 'If the event organiser gave you an IRCC special event code, choose Yes and enter it; otherwise choose No.',
    });
  } else if (codeAnswer === 'Yes' && !eventCode(p)) {
    // Yes is written and the code goes in the box it reveals; without the
    // code that box is the applicant's.
    notes.push({
      page: SPECIAL_EVENT,
      label: 'Special event code — the code',
      reason: 'not_in_profile',
      note: 'Type the IRCC event code the organiser gave you in the box under "Yes".',
    });
  }
  notes.push(
    {
      page: DOCS,
      label: 'Letter of invitation from the Canadian business',
      reason: 'fill_yourself',
      note: `From ${who}: your contact's name, phone and email, the dates and purpose of your visit, and who pays for the trip.`,
    },
    {
      page: DOCS,
      label: 'Letter from your employer outside Canada',
      reason: 'fill_yourself',
      note: 'Confirming your job, that your employer pays you during the trip, and that you return to your job afterwards. A business visitor must not enter the Canadian labour market.',
    },
  );
  if (isBusinessEvent(p))
    notes.push({
      page: DOCS,
      label: 'Event registration',
      reason: 'fill_yourself',
      note: eventCode(p)
        ? `Your registration, and the IRCC event code ${eventCode(p)} where the portal asks for it.`
        : 'Your registration or badge confirmation; if the organiser gave an IRCC event code, enter it where the portal asks.',
    });
  if (
    /\b(after-?sales|warranty|repair|servic(e|ing)|install)\w*/i.test(
      activity(p) ?? '',
    )
  )
    notes.push({
      page: DOCS,
      label: 'Warranty or service contract',
      reason: 'fill_yourself',
      note: 'The original sales agreement, warranty or service contract that covers the equipment you will install or repair.',
    });
  return notes;
}

function pagesWith(visitor: PortalPageInfo[]): PortalPageInfo[] {
  const pages = visitor.some((v) => v.page === DOCS)
    ? [...visitor]
    : [...visitor, { page: DOCS, title: 'Documents' }];
  if (!pages.some((v) => v.page === SPECIAL_EVENT)) {
    const at = pages.findIndex((v) => v.page === INVITER);
    pages.splice(at === -1 ? pages.length : at + 1, 0, {
      page: SPECIAL_EVENT,
      title: 'Special event code',
    });
  }
  return pages;
}

const visitor = resolvePortalFill('ircc');
const visitorExtras = resolvePortalFillExtras('ircc');
if (!visitor) throw new Error('canada-ircc must register the ircc mapping');

export const IRCC_BUSINESS_VISITOR_MAPPING = buildMapping(visitor);

registerPortalFillVariant(
  'ircc',
  BUSINESS_VISITOR_ID,
  IRCC_BUSINESS_VISITOR_MAPPING,
  {
    ...visitorExtras,
    pages: pagesWith(visitorExtras.pages ?? []),
    normalize: (p, raw) =>
      normalizeBusiness(visitorExtras.normalize?.(p, raw) ?? p, raw),
    left: (p, exclude) => [
      // The host (children, the Canadian business) is always the inviter
    // here: the visitor's no-host note does not apply.
    ...(visitorExtras.left?.(p, exclude) ?? []).filter(
      (n) => n.label !== NO_HOST_NOTE_LABEL,
    ),
      ...businessNotes(p, exclude ?? new Set()),
    ],
  },
);
