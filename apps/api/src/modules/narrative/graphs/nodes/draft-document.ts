import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { NarrativeState, DocType } from '../narrative.state';
import { resolveCountryName } from '../../../../strategies/country-context';
import { languageDirective } from '../../../../i18n/language';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../../shared/ai/untrusted';
import { stripMetaCommentary } from './strip-meta';
import { evidenceDirective } from './document-evidence';
import { restoreIdentifiers } from './restore-identifiers';
import type { NarrativeContext } from '../narrative.state';
import { findByName, personName } from '../../../shared/profile/family-members';
import {
  isBusinessVisitorRoute,
  isStudyPermitRoute,
  isSuperVisaRoute,
  isWorkPermitRoute,
  MINIMUM_NECESSARY_INCOME_UPDATED,
  stayLengthPhrase,
  superVisaHousehold,
  superVisaIncomeCheck,
  superVisaInsuranceCheck,
  SUPER_VISA_YEARS_PER_ENTRY,
} from '@visaai/types';

const DOC_INSTRUCTIONS: Record<DocType, string> = {
  loe: `Write a Letter of Explanation (LOE) for a visa application. Address the visa officer professionally.
Explain the applicant's purpose of travel, ties to their home country, financial capacity, and intent to return.
Keep it factual, concise (3-4 paragraphs), and based ONLY on the provided profile data. Never invent facts.
A refusal of a family member (for example the spouse's visa refusal) is theirs, not the applicant's: never write or imply that the applicant was refused unless the profile says the applicant themself was refused.`,
  itinerary: `Write a realistic travel itinerary for a visa application. Include arrival, planned activities aligned with the stated purpose,
accommodation approach, and departure. Format as a day-by-day or phase-by-phase plan. Base duration and activities ONLY on the provided profile.`,
  cover_letter: `Write a visa application cover letter summarizing the submission. List the purpose, key supporting documents,
and a brief statement of the applicant's eligibility. Keep it professional and under one page. Base it ONLY on the provided profile.`,
  invitation_letter: `Write a letter of invitation written BY THE HOST — the person in the destination country who is inviting the applicant — in the first person ("I, <host name>, invite my mother ..."), addressed to the visa officer.
State the host's full name, date of birth, address, telephone and status in the country; the applicant's full name, date of birth and relationship to the host; the purpose and dates of the stay; where the applicant will live; and who pays for the stay. End with the host's signature block (name, date, signature line).
Base it ONLY on the provided profile. Never invent a fact; leave a clearly marked blank such as [host's telephone] for anything the profile does not give.`,
};

/**
 * A business visitor is invited by a Canadian company, not a relative: the
 * family-host brief above ("I, <host name>, invite my mother ...") would have
 * the model write a family letter for a sales meeting.
 */
const BUSINESS_INVITATION_INSTRUCTION = `Write a business letter of invitation written BY THE CANADIAN COMPANY OR ORGANIZATION that is inviting the applicant, on its behalf, by its contact person, addressed to the visa officer.
State the company's name and full address in Canada; the contact person's name, position (if given), telephone and email; the applicant's full name, date of birth, employer and position; the business purpose of the visit and the activities planned; the dates of the visit; and who pays for the travel and stay. End with the contact person's signature block (name, position, company, date, signature line).
It is a company letter: never write in a family or personal voice, never describe a relationship such as son, daughter or friend, and never promise to house the applicant in a home.
Base it ONLY on the provided profile. Never invent a fact; leave a clearly marked blank such as [contact's position] for anything the profile does not give.`;

/**
 * A study permit is not a visit: the visitor brief ("purpose of travel ...
 * intent to return") would have the model write a holiday letter for a
 * two-year program. IRCC's letter of explanation for a study permit is the
 * study plan; the cover letter lists the study documents.
 */
const STUDY_INSTRUCTIONS: Partial<Record<DocType, string>> = {
  loe: `Write a Letter of Explanation (study plan) for a Canadian study permit application, in the applicant's own first-person voice, addressed to the visa officer.
Cover, in this order: the program, school and its dates; why this program (how it follows from the applicant's education and work); why in Canada and at this school rather than at home; how tuition and living costs are paid; the applicant's ties to their home country and their plan to leave Canada when the studies end, with what they will do afterwards.
Keep it factual, about one page, and based ONLY on the provided profile data. Never invent a fact, a school, a score or an amount; leave a clearly marked blank such as [tuition amount] for anything the profile does not give.
A refusal of a family member is theirs, not the applicant's: never write or imply that the applicant was refused unless the profile says the applicant themself was refused. If they were, say so plainly in one sentence and what has changed since.`,
  cover_letter: `Write a cover letter for a Canadian study permit application. Name the school, its DLI number, the program and its dates, then list the documents enclosed: the letter of acceptance, the provincial or territorial attestation letter (or the exception that applies, or the CAQ for Quebec), proof of funds (for example a GIC, bank statements, a scholarship), proof of tuition paid, the passport and photographs, the study plan, and academic records. Keep it professional and under one page. Base it ONLY on the provided profile.`,
};

/**
 * A work permit is not a visit either: the visitor brief would have the model
 * write "applying for a visitor visa" and a holiday purpose for a job offer.
 * Its letters are about the job, the employer, the LMIA or offer of
 * employment, the applicant's qualifications and the temporary stay.
 */
const WORK_INSTRUCTIONS: Partial<Record<DocType, string>> = {
  loe: `Write a Letter of Explanation for a Canadian work permit application made from outside Canada, in the applicant's own first-person voice, addressed to the visa officer.
Cover, in this order: the kind of work permit as the applicant's documents describe it (employer-specific with an LMIA, employer-specific LMIA-exempt with an offer of employment number, or an open work permit and whose family member the applicant is); the employer, the job title, the duties, where the work is and its dates; how the applicant's education, work experience and any licence or certification meet the job's requirements; how they will support themself and any family until the first pay; and that the stay is temporary, with their plan to leave Canada when the permit ends.
Keep it factual, about one page, and based ONLY on the provided profile data. Never invent a fact, an employer, a number or an amount; leave a clearly marked blank such as [LMIA number] for anything the profile does not give. Never state that the applicant is eligible, exempt from an LMIA, or will be approved: describe only what their documents say.
A refusal of a family member is theirs, not the applicant's: never write or imply that the applicant was refused unless the profile says the applicant themself was refused. If they were, say so plainly in one sentence and what has changed since.`,
  cover_letter: `Write a cover letter for a Canadian work permit application made from outside Canada (IMM 1295). Name the kind of work permit as the applicant's documents describe it, the employer, the job title and the work dates, and the LMIA number or the offer of employment number when the profile gives one; then list the documents enclosed: the passport and photograph, the LMIA copy or the offer of employment number, the employment contract or job offer letter, proof of meeting the job's requirements (education, licence or certification), a résumé and proof of past work experience, the Quebec acceptance certificate (CAQ) when the job is in Quebec and needs an LMIA, the family information form, and, for an open work permit, proof of the relationship and of the family member's permit in Canada. Keep it professional and under one page. Base it ONLY on the provided profile, and never call it a visitor visa.`,
};

/** The letter's general brief, with a route's own brief where it has one. */
export function docInstruction(
  ctx: NarrativeContext,
  docType: DocType,
): string {
  if (docType === 'invitation_letter' && isBusinessVisitorRoute(ctx.visaaiId)) {
    return BUSINESS_INVITATION_INSTRUCTION;
  }
  if (isStudyPermitRoute(ctx.visaaiId) && STUDY_INSTRUCTIONS[docType]) {
    return STUDY_INSTRUCTIONS[docType];
  }
  if (isWorkPermitRoute(ctx.visaaiId) && WORK_INSTRUCTIONS[docType]) {
    return WORK_INSTRUCTIONS[docType];
  }
  return DOC_INSTRUCTIONS[docType];
}

/** What IRCC calls the business visitor route; the registry's "Business visitors" is a page title. */
const BUSINESS_VISITOR_VISA_NAME = 'Temporary Resident Visa (business visitor)';

const OUTPUT_RULES = `Output ONLY the document itself, exactly as the visa officer will read it, in clean markdown.
Never address the applicant or talk about the document: never write "Here is", "Below is", "Sure", "Certainly", "I have drafted", and never add a "Note:", disclaimer, tip, placeholder explanation, or offer to make changes before or after the document.
Do not use markdown tables; use headings, short paragraphs and lists.`;

/**
 * The route, named exactly. The letter must call the application by this name
 * and no other — with an empty name the model wrote "visitor visa" for a Canada
 * eTA (dry run 2026-10-16).
 */
export function visaLine(ctx: NarrativeContext): string {
  const name = isBusinessVisitorRoute(ctx.visaaiId)
    ? BUSINESS_VISITOR_VISA_NAME
    : ctx.visaType?.trim();
  const purpose = ctx.purpose?.trim();
  if (!name) {
    return 'Visa: not specified. Do not name a visa type or category anywhere in the document; refer only to "this application".';
  }
  return `Visa: ${name}${purpose ? ` (${purpose})` : ''}. Refer to the application by exactly this name; never call it a different visa or permit (for example never "visitor visa" unless that is the name above).`;
}

/** The authoritative trip length line, or '' when the dates are unknown. */
export function stayDirective(ctx: NarrativeContext): string {
  const s = ctx.stay;
  if (!s) return '';
  const phrase = stayLengthPhrase(s.entryDate, s.departureDate);
  // A long stay is stated in months. A letter that calls a year with family
  // "a visit of 365 days" reads as a tourist trip (dry run 2026-10-16).
  if (phrase && !phrase.endsWith('days') && !phrase.endsWith('day')) {
    return `\n\nTrip dates (authoritative): entering ${s.entryDate}, departing ${s.departureDate} — a stay of ${phrase}. Whenever the length of stay is mentioned, describe it as ${phrase} with these dates; never describe the stay as a visit of ${s.days} days, and never use any other figure from the profile.`;
  }
  return `\n\nTrip dates (authoritative): entering ${s.entryDate}, departing ${s.departureDate} — a stay of ${s.days} days (counting both the entry and the departure day). Whenever the length of stay is mentioned, use exactly ${s.days} days and these dates; never use any other figure from the profile.`;
}

/**
 * A long stay's itinerary is a residence, not a holiday: the model padded a
 * 12-month super visa itinerary with "shared meals and conversations" for
 * every quarter (dry run 2026-10-16).
 */
export function longStayDirective(
  ctx: NarrativeContext,
  docType: DocType,
): string {
  if (docType !== 'itinerary' || !ctx.stay) return '';
  const phrase = stayLengthPhrase(ctx.stay.entryDate, ctx.stay.departureDate);
  if (!phrase || phrase.endsWith('days') || phrase.endsWith('day')) return '';
  return `\n\nThis is a ${phrase} stay. Keep the itinerary short and factual — arrival, accommodation, purpose and departure, with the dates — and add no filler: no invented activities, outings or month-by-month descriptions.`;
}

const cad = (n: number) => `CAD ${n.toLocaleString('en-US')}`;

function text(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function pick(p: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const t = text(p[k]);
    if (t) return t;
  }
  return null;
}

/** What each letter must say on a super visa, beyond its general brief. */
const SUPER_VISA_LETTER: Record<DocType, string> = {
  invitation_letter: `This is the super visa letter of invitation. It is written BY THE HOST (the applicant's child or grandchild in Canada), in the host's own first-person voice, and signed by the host — never by the applicant. IRCC requires it to contain:
- a promise of financial support for the whole stay in Canada (the host's own words: "I promise to provide financial support for my mother for the entire duration of her stay in Canada");
- the list of the people in the host's household counted in the family size, giving each person's name and date of birth;
- the total number of people in that household (the family size) and the host's income against the minimum necessary income for that size, with the tax year;
- that a copy of the host's Canadian citizenship or permanent resident document is enclosed;
- the dates and length of the stay, and that the applicant will live with the host.
If a co-signer is listed below, add their signature block next to the host's; otherwise sign for the host alone.`,
  cover_letter: `List the super visa documents enclosed: the host's signed letter of invitation; proof of the host's Canadian citizenship or permanent resident status; proof of the parent/grandparent relationship (the host's birth certificate); proof of the host's income (CRA Notice of Assessment) for the tax year below; the private medical insurance policy; proof of the immigration medical exam; the passport and photographs.`,
  loe: `Explain, in the applicant's own voice, why they are coming to Canada on a super visa (to live with their child's family for the stated period), how the stay is funded (by the host, as promised in the invitation letter), the medical insurance that covers them, and the ties that will bring them home at the end of the stay.`,
  itinerary: `A super visa stay is a long residence with family, not a sightseeing trip: keep it short and factual — arrival, accommodation, purpose and departure — never a day-by-day or quarter-by-quarter tourist schedule.`,
};

/**
 * Route-specific facts and rules for the letter, or '' for a route that has
 * none. Every figure here is computed (household size, minimum necessary
 * income, insurance minimums), so the writer quotes it instead of guessing.
 */
export function routeDirective(
  ctx: NarrativeContext,
  docType: DocType,
): string {
  if (isBusinessVisitorRoute(ctx.visaaiId)) {
    return businessVisitorDirective(ctx, docType);
  }
  if (isStudyPermitRoute(ctx.visaaiId)) return studyPermitDirective(ctx);
  if (isWorkPermitRoute(ctx.visaaiId)) return workPermitDirective(ctx);
  if (!isSuperVisaRoute(ctx.visaaiId)) return '';
  const p = ctx.profile ?? {};
  const lines: string[] = [];

  lines.push(
    `- This is a Parent and Grandparent Super Visa (IRCC), not a regular visitor visa: the holder may stay up to ${SUPER_VISA_YEARS_PER_ENTRY} years per entry. Never call it a tourist or short visit, and never say the applicant must leave within 6 months.`,
    `- Call it a "Parent and Grandparent Super Visa application" in the subject line and the body; do not title it a "Temporary Resident Visa application". Its basis: the applicant is the parent or grandparent of a Canadian citizen or permanent resident host, who invites them with a promise of financial support, meets the minimum necessary income, and the applicant holds Canadian medical insurance (at least CAD 100,000, valid at least 1 year from entry) and takes an immigration medical exam.`,
  );

  const host = pick(p, ['inviter_name', 'host_name', 'host_full_name']);
  if (host) {
    const rel = pick(p, [
      'inviter_relationship',
      'host_relationship',
      'relationship_to_host',
    ]);
    const status = pick(p, [
      'inviter_status',
      'host_status',
      'host_immigration_status',
    ]);
    const dob = pick(p, ['inviter_date_of_birth', 'host_date_of_birth']);
    const addr = pick(p, ['inviter_address', 'host_address']);
    lines.push(
      `- Host: ${host}${rel ? `, the applicant's ${rel}` : ''}${status ? `, ${status}` : ''}${dob ? `, born ${dob}` : ''}${addr ? `, living at ${addr}` : ''}.`,
    );
  }

  const household = superVisaHousehold(p);
  const income = superVisaIncomeCheck(p);
  if (income.familySize !== null) {
    const who = household
      .map((m) => {
        const name = text(m.name) ?? '[name]';
        const dob = text(m.date_of_birth) ?? '[date of birth]';
        const rel = text(m.relationship_to_host ?? m.relationship);
        return `${name} (born ${dob}${rel ? `, ${rel}` : ''})`;
      })
      .join('; ');
    lines.push(
      `- Host's family size: ${income.familySize}${who ? ` — ${who}` : ''}.`,
    );
  }
  if (income.required !== null) {
    lines.push(
      `- Minimum necessary income for a family of ${income.familySize}: ${cad(income.required)} (IRCC table updated ${MINIMUM_NECESSARY_INCOME_UPDATED}).`,
    );
  }
  if (income.hostIncome !== null) {
    const year = income.taxYear ? ` for the ${income.taxYear} tax year` : '';
    const co =
      income.coSignerIncome > 0
        ? ` plus the co-signer's ${cad(income.coSignerIncome)} (${pick(p, ['co_signer_name']) ?? 'co-signer'})`
        : '';
    lines.push(
      `- Host's income${year}: ${cad(income.hostIncome)}${co}; total ${cad(income.total!)}.`,
    );
  }
  if (income.meets === true) {
    lines.push(
      `- That income meets the minimum necessary income for the family size.`,
    );
  } else if (income.meets === false) {
    lines.push(
      `- That income does NOT meet the minimum necessary income for the family size. Never claim it does: state the figures as they are and leave the shortfall for the applicant to address.`,
    );
  }
  if (income.coSignerIneligible) {
    lines.push(
      `- A co-signer was named who is not the host's spouse. IRCC accepts only the host's spouse or common-law partner as a co-signer, so that person's income is not counted and they must not sign as co-signer.`,
    );
  }

  // The uploaded policy, when there is one, outranks what was declared: it
  // is stated by evidenceDirective, and the declaration is not repeated here.
  const policy = ctx.evidence?.insurance ?? null;
  if (policy) {
    if (policy.coversStay === false)
      lines.push(
        `- Medical insurance: the uploaded policy does not cover the planned stay (see the verified documents below); a policy covering the whole stay is still needed.`,
      );
  } else {
    const ins = superVisaInsuranceCheck(p);
    if (ins.has === true || ins.provider || ins.coverageCad !== null) {
      const parts = [
        ins.provider ? `issued by ${ins.provider}` : null,
        ins.coverageCad !== null
          ? `${cad(ins.coverageCad)} emergency cover`
          : null,
        ins.months !== null ? `valid ${ins.months} months from entry` : null,
        ins.paid ? ins.paid : null,
      ].filter(Boolean);
      lines.push(
        `- Private medical insurance (declared by the applicant, no policy uploaded yet)${parts.length ? `: ${parts.join(', ')}` : ' is held'}.`,
      );
    }
    for (const problem of ins.problems)
      lines.push(`- Insurance problem: ${problem}`);
  }

  const imeDate = pick(p, [
    'immigration_medical_exam_date',
    'ime_date',
    'medical_exam_date',
  ]);
  if (imeDate) {
    lines.push(
      `- Immigration medical exam completed with an IRCC panel physician on ${imeDate}.`,
    );
  } else {
    lines.push(
      `- The immigration medical exam is not recorded as done: never say it has been done. If the profile says it is planned (for example "upfront"), say it is planned.`,
    );
  }

  return `\n\nSUPER VISA — authoritative facts and rules (use these figures exactly; never invent any other):\n${lines.join('\n')}\n\nFor this ${docType}: ${SUPER_VISA_LETTER[docType]}`;
}

/** What each letter must say for a business visitor, beyond its general brief. */
const BUSINESS_VISITOR_LETTER: Record<DocType, string> = {
  loe: `Explain, in the applicant's own voice, the business activity they will carry out in Canada, the Canadian company or organization they are visiting (and the event, with its event code, if they are attending one), who pays for the trip, and the ties (employment, business, family, property) that will bring them home at the end of the trip.`,
  cover_letter: `List the business visitor documents enclosed, naming only those that fit this trip: the Canadian company's letter of invitation; a letter of support from the applicant's employer (or parent company) confirming their position and the purpose of the trip (and, if the letter says so, that they remain on its payroll); the event registration or confirmation (with the event code) when attending a conference, convention or trade fair; the sales, service or warranty contract when the trip is after-sales service; proof of funds for the trip; the passport and photographs.`,
  invitation_letter: `This is the Canadian company's letter of invitation. It is written BY THE CANADIAN COMPANY OR ORGANIZATION, signed by its contact person — never by the applicant, and never in a family voice. It must give the company's name and address, the contact person's name, telephone and email, the business purpose and dates of the visit, and who pays for the travel and stay.`,
  itinerary: `A business trip itinerary: arrival, the business activities or event days with their dates, accommodation and departure. No sightseeing or invented activities.`,
};

const NONE_ANSWER = /^(no|none|n\/?a|nil|not applicable)\.?$/i;

/**
 * The business visitor's facts, as the intake collected them (#185). Read
 * through the same aliases the intake accepts, so an older profile that used
 * `host_name` or `company_address` still reaches the letter.
 */
function businessVisitorDirective(
  ctx: NarrativeContext,
  docType: DocType,
): string {
  const p = ctx.profile ?? {};
  const lines: string[] = [
    `- This is a Temporary Resident Visa for a business visitor (IRCC). Call it a "Temporary Resident Visa (business visitor) application"; never call it a work permit, a tourist visa or a family visit.`,
    `- Never describe the trip as working for a Canadian employer or being hired in Canada, and never say who pays the applicant's salary unless a line below says so.`,
  ];

  const activity = pick(p, [
    'business_activity',
    'business_activities',
    'business_purpose',
  ]);
  if (activity) lines.push(`- Business activity in Canada: ${activity}.`);

  const company = pick(p, [
    'canadian_business_name',
    'canadian_company_name',
    'host_company_name',
    'inviting_company_name',
  ]);
  const addr = pick(p, [
    'inviter_address',
    'host_address',
    'canadian_business_address',
    'company_address',
  ]);
  if (company || addr) {
    lines.push(
      `- Canadian company or organization: ${company ?? '[company name]'}${addr ? `, ${addr}` : ''}.`,
    );
  }
  const contact = pick(p, [
    'inviter_name',
    'host_name',
    'host_full_name',
    'inviter_full_name',
    'business_contact_name',
  ]);
  if (contact) {
    const phone = pick(p, [
      'inviter_phone',
      'host_phone',
      'host_telephone',
      'business_contact_phone',
    ]);
    const email = pick(p, [
      'inviter_email',
      'host_email',
      'business_contact_email',
    ]);
    lines.push(
      `- Contact person at that company: ${contact}${phone ? `, telephone ${phone}` : ''}${email ? `, email ${email}` : ''}. They are a business contact, not a relative or friend of the applicant.`,
    );
  }

  const attending = flag(
    p.attending_business_event ??
      p.attending_conference ??
      p.attending_trade_fair,
  );
  const eventCode = pick(p, ['event_code', 'ircc_event_code']);
  if (attending === true) {
    lines.push(
      eventCode && !NONE_ANSWER.test(eventCode)
        ? `- Attending a conference, convention or trade fair, IRCC event code ${eventCode}. Quote the event code exactly.`
        : `- Attending a conference, convention or trade fair; no IRCC event code is recorded, so never quote one.`,
    );
  }

  const employer = pick(p, ['employer_name', 'employer', 'company_name']);
  const paidInCanada = flag(
    p.paid_by_canadian_source ?? p.canadian_payment ?? p.paid_in_canada,
  );
  if (paidInCanada === false) {
    lines.push(
      `- No Canadian company or person pays the applicant for this work; they stay paid by ${employer ? `their employer, ${employer},` : 'their employer or business'} outside Canada.`,
    );
    if (docType === 'loe') {
      lines.push(
        `- Say that the applicant's pay and their place of business stay outside Canada, so they are not entering the Canadian labour market.`,
      );
    }
  } else if (paidInCanada === true) {
    lines.push(
      `- The applicant said a Canadian source will pay them a salary, fee or commission for this work. Never claim their pay stays outside Canada; state the facts as given and leave this for the applicant to address.`,
    );
  } else if (employer) {
    lines.push(`- Applicant's employer: ${employer}.`);
  }
  if (paidInCanada === undefined) {
    lines.push(
      `- Whether a Canadian source pays the applicant is not recorded: never claim either way that their pay stays outside Canada.`,
    );
  }

  const payer = pick(p, [
    'trip_expenses_paid_by',
    'who_pays_trip',
    'travel_expenses_paid_by',
  ]);
  if (payer) lines.push(`- Travel and stay paid by: ${payer}.`);

  return `\n\nBUSINESS VISITOR — authoritative facts and rules (state only these facts; never invent any other):\n${lines.join('\n')}\n\nFor this ${docType}: ${BUSINESS_VISITOR_LETTER[docType]}`;
}

/** A yes/no answer as the intake stored it; undefined when not given. */
function flag(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['yes', 'y', 'true'].includes(s)) return true;
    if (['no', 'n', 'false'].includes(s)) return false;
  }
  return undefined;
}

/**
 * Where each of the applicant's children lives, exactly as the profile says
 * it, for the letter of explanation's home-ties paragraph.
 *
 * Prod 2026-10-16 (super visa, app 61f16bb5): the LOE wrote "my son, Mian
 * Talha, also lives with me there" for a son recorded as living in Pakistan
 * (in_home_country: true) with his own family. "In the home country" is a
 * tie; "lives with me" is a different fact, and only the profile may state it
 * (the child's same_address / lives_with_applicant, or the intake's
 * children_living_with_you answer).
 */
export function familyTiesDirective(
  ctx: NarrativeContext,
  docType: DocType,
): string {
  if (docType !== 'loe') return '';
  const p = ctx.profile ?? {};
  const list: unknown[] = Array.isArray(p.children) ? p.children : [];
  const kids = list
    .filter(
      (c): c is Record<string, unknown> =>
        !!c && typeof c === 'object' && !Array.isArray(c),
    )
    .filter((c) => !!personName(c));
  if (kids.length === 0) return '';

  const listed = Array.isArray(p.children_living_with_you)
    ? (p.children_living_with_you as unknown[]).filter(
        (n): n is string => typeof n === 'string' && !!n.trim(),
      )
    : [];
  const livesWith = (c: Record<string, unknown>): boolean | undefined => {
    const own = flag(c.same_address) ?? flag(c.lives_with_applicant);
    if (own !== undefined) return own;
    if (listed.some((n) => findByName([c], n) !== null)) return true;
    return undefined;
  };

  const lines = kids.map((c) => {
    const name = personName(c);
    const rel = text(c.relationship);
    const who = rel ? `${name} (${rel})` : name;
    if (livesWith(c) === true) return `- ${who}: lives with the applicant.`;
    const country = text(c.country_of_residence);
    const where = country
      ? `lives in ${country}`
      : flag(c.in_home_country) === true
        ? "lives in the applicant's home country"
        : flag(c.in_home_country) === false
          ? "lives outside the applicant's home country"
          : 'where this child lives is not recorded';
    return `- ${who}: ${where}. The profile does not say this child lives with the applicant — never write that they live with the applicant or at the applicant's address.`;
  });
  return `\n\nFAMILY TIES — the applicant's children, exactly as the profile records them (state no other living arrangement):\n${lines.join('\n')}`;
}

// Spec: these generated documents are written in the user's selected language.
// They are read by visa officers, so officer-language output may become a future
// product toggle; until then we honour the user's preference. Official form codes
// (DS-160, IMM 5257, etc.) stay untranslated — languageDirective enforces this.
export function makeDraftDocumentNode(
  llm: ChatOpenAI,
  language?: string | null,
) {
  return async function draftDocument(
    state: NarrativeState,
  ): Promise<Partial<NarrativeState>> {
    const instruction = docInstruction(state.context, state.docType);

    const revisionNote = state.critique
      ? `\n\nA reviewer critiqued the previous draft. Address this feedback:\n${state.critique}\n\nPrevious draft:\n${state.draft}`
      : '';

    const response = await llm.invoke([
      new SystemMessage(
        `You are an expert immigration document writer. ${OUTPUT_RULES}\n\n${UNTRUSTED_DATA_DIRECTIVE}\n\n${instruction}${languageDirective(language)}`,
      ),
      new HumanMessage(
        `Destination country: ${resolveCountryName(state.context.countryCode)} (${state.context.countryCode})\n${visaLine(state.context)}\n\n${asUntrustedData('Applicant profile', state.context.profile)}${stayDirective(state.context)}${longStayDirective(state.context, state.docType)}${routeDirective(state.context, state.docType)}${familyTiesDirective(state.context, state.docType)}${evidenceDirective(state.context.evidence)}${revisionNote}\n\nWrite the document for the destination country above:`,
      ),
    ]);

    const raw =
      typeof response.content === 'string'
        ? response.content
        : ((response.content[0] as { text?: string } | undefined)?.text ?? '');
    const draft = restoreIdentifiers(
      stripMetaCommentary(raw),
      state.context.profile ?? {},
    );

    return { draft, revisionCount: state.revisionCount + 1 };
  };
}

/**
 * The study facts the letters must quote exactly, so the writer does not
 * guess a school, date or amount. Only what the profile holds is listed.
 */
function studyPermitDirective(ctx: NarrativeContext): string {
  const p = ctx.profile ?? {};
  const lines: string[] = [
    '- This is a study permit application (IMM 1294), not a visitor visa: never call it a tourist visit or a Temporary Resident Visa application, and never describe a trip itinerary.',
  ];
  const facts: [string, string[]][] = [
    ['School', ['study_school_name', 'dli_name', 'institution_name']],
    ['DLI number', ['dli_number']],
    ['Program', ['study_program', 'program_name']],
    ['Level', ['study_level', 'level_of_study']],
    ['City and province', ['study_city']],
    ['Program start', ['study_start_date', 'program_start_date']],
    ['Program end', ['study_end_date', 'program_end_date']],
    ['First-year tuition (CAD)', ['tuition_cad', 'tuition']],
    ['Tuition already paid (CAD)', ['tuition_paid_cad']],
    ['Funds for the stay (CAD)', ['study_funds_available_cad']],
    ['Paid by', ['study_expenses_paid_by']],
  ];
  for (const [label, keys] of facts) {
    let v = pick(p, keys);
    if (label === 'City and province') {
      const prov = pick(p, ['study_province', 'province_of_study']);
      v = [v, prov].filter(Boolean).join(', ') || null;
    }
    if (v) lines.push(`- ${label}: ${v}.`);
  }
  return `\n\nStudy permit facts (authoritative — quote them exactly):\n${lines.join('\n')}`;
}

/**
 * The work facts the letters must quote exactly, so the writer does not
 * guess an employer, number or date. Only what the profile holds is listed.
 */
function workPermitDirective(ctx: NarrativeContext): string {
  const p = ctx.profile ?? {};
  const lines: string[] = [
    '- This is a work permit application made from outside Canada (IMM 1295), not a visitor visa: never call it a tourist visit or a Temporary Resident Visa application, and never describe a trip itinerary.',
  ];
  const facts: [string, string[]][] = [
    ['Kind of work permit (as the documents describe it)', ['work_permit_type']],
    ['Employer in Canada', ['work_employer_name', 'canada_employer_name']],
    ['Employer address', ['work_employer_address']],
    ['Job title', ['work_job_title', 'intended_job_title', 'canada_job_title']],
    ['Duties', ['work_job_duties', 'intended_job_duties']],
    ['Province or territory of work', ['work_location_province', 'province_of_work']],
    ['Work location', ['work_location_address']],
    ['Work start', ['work_start_date', 'intended_work_start_date']],
    ['Work end', ['work_end_date', 'intended_work_end_date']],
    ['LMIA number', ['lmia_number']],
    ['Offer of employment number', ['offer_of_employment_number']],
    ['Funds until the first pay (CAD)', ['work_funds_available_cad']],
  ];
  for (const [label, keys] of facts) {
    const v = pick(p, keys);
    if (v) lines.push(`- ${label}: ${v}.`);
  }
  return `\n\nWork permit facts (authoritative — quote them exactly):\n${lines.join('\n')}`;
}
