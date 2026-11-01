import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import type { PrefilledFormPayload, PrefilledFormField } from '@visaai/types';

/**
 * IMM 5476 — Use of a Representative (IRCC, Canada).
 *
 * Required whenever anyone, paid or unpaid, represents the applicant. Every
 * answer on it is already in the profile once the interview asks whether a
 * representative is used (intake-requirements, IRCC_VISITOR_FACTS), so VisaAI
 * prepares it instead of leaving the applicant a bare form code.
 *
 * WHY AN ANSWER SHEET AND NOT THE OFFICIAL PDF
 *
 * The official IMM 5476 lives under a canada.ca path that robots.txt
 * disallows (document-templates.ts serves it as a link for that reason), so
 * there is no cached blank to stamp. This renders every IMM 5476 answer, in
 * the form's own section order and wording, on a printable sheet: the
 * applicant copies them onto the official form, then both people sign. The
 * signatures and dates are never filled — only the people signing may.
 */

export type Profile = Record<string, unknown>;

export interface Imm5476Line {
  section: string;
  label: string;
  value: string;
}

export interface Imm5476Answers {
  lines: Imm5476Line[];
  /** Answers the profile does not hold: the applicant writes them in. */
  missing: string[];
}

function text(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
}

function pick(p: Profile, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const t = text(p[k]);
    if (t) return t;
  }
  return undefined;
}

function yes(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  const t = text(v)?.toLowerCase();
  if (!t) return undefined;
  if (['yes', 'y', 'true'].includes(t)) return true;
  if (['no', 'n', 'false', 'none'].includes(t)) return false;
  return undefined;
}

function normName(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

/** "Mian Muhammad Bilawal" → family "Bilawal", given "Mian Muhammad". */
function split(full: string | undefined): { family?: string; given?: string } {
  if (!full) return {};
  const words = full.trim().split(/\s+/);
  if (words.length < 2) return { family: words[0] };
  return {
    family: words[words.length - 1],
    given: words.slice(0, -1).join(' '),
  };
}

function formValue(
  payload: PrefilledFormPayload | null | undefined,
  key: string,
): string | undefined {
  const f = payload?.fields?.find((x: PrefilledFormField) => x.key === key);
  return text(f?.value);
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** A telephone number found in free text ("905-226-5664", "+1 905 226 5664"). */
function phoneIn(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.replace(EMAIL, ' ').match(/\+?[\d][\d\s().-]{6,}\d/);
  return m ? m[0].trim() : undefined;
}

/** The application the representative is appointed for, by route. */
function applicationName(
  p: Profile,
  payload?: PrefilledFormPayload | null,
): string | undefined {
  const route =
    `${pick(p, 'visa_type') ?? ''} ${payload?.visaType ?? ''}`.toLowerCase();
  if (/super\s*visa/.test(route))
    return 'Application for a Temporary Resident Visa (super visa)';
  if (/visitor|temporary resident|trv/.test(route))
    return 'Application for a Temporary Resident Visa (visitor visa)';
  if (/study/.test(route)) return 'Application for a Study Permit';
  if (/work/.test(route)) return 'Application for a Work Permit';
  return text(payload?.visaType) ?? pick(p, 'visa_type');
}

/**
 * Every IMM 5476 answer the profile supports, in the form's order. Pure.
 * Returns null when the applicant has not said a representative is used.
 */
export function imm5476Answers(
  profile: Profile,
  payload?: PrefilledFormPayload | null,
): Imm5476Answers | null {
  const p = profile ?? {};
  if (yes(p.uses_representative ?? p.has_representative) !== true) return null;

  const lines: Imm5476Line[] = [];
  const missing: string[] = [];
  const add = (section: string, label: string, value: string | undefined) => {
    if (value) lines.push({ section, label, value });
    else missing.push(`${section}: ${label}`);
  };

  // ── Section A — applicant ────────────────────────────────────────────────
  const A = 'A. Applicant';
  const fullName = pick(p, 'full_name', 'applicant_name');
  const nameFromFull = split(fullName);
  add(
    A,
    'Family name',
    formValue(payload, 'family_name') ??
      pick(p, 'family_name', 'surname', 'last_name') ??
      nameFromFull.family,
  );
  add(
    A,
    'Given name(s)',
    formValue(payload, 'given_name') ??
      pick(p, 'given_name', 'given_names', 'first_name') ??
      nameFromFull.given,
  );
  add(
    A,
    'Date of birth (YYYY-MM-DD)',
    formValue(payload, 'date_of_birth') ?? pick(p, 'date_of_birth', 'dob'),
  );
  const uci =
    formValue(payload, 'uci') ??
    pick(p, 'uci', 'unique_client_identifier', 'client_id');
  // Optional on the form: only applicants who have one write it.
  lines.push({
    section: A,
    label: 'UCI (if known)',
    value: uci ?? 'None — leave blank',
  });
  add(A, 'Application or request being submitted', applicationName(p, payload));

  // ── Section B — representative ───────────────────────────────────────────
  const B = 'B. Representative';
  const repFull = pick(p, 'representative_name', 'representative_full_name');
  const repSplit = split(repFull);
  add(
    B,
    'Family name',
    pick(p, 'representative_family_name') ?? repSplit.family,
  );
  add(
    B,
    'Given name(s)',
    pick(p, 'representative_given_name') ?? repSplit.given,
  );

  const paid = yes(p.representative_paid ?? p.is_paid_representative);
  if (paid === false) {
    lines.push({
      section: B,
      label: 'Type of representative',
      value:
        'Unpaid — I am not being paid (friend, family member or other unpaid person)',
    });
  } else if (paid === true) {
    lines.push({
      section: B,
      label: 'Type of representative',
      value:
        'Paid — an authorized representative (licensed consultant, lawyer or Quebec notary)',
    });
    add(
      B,
      'Membership ID (CICC, law society or Chambre des notaires)',
      pick(
        p,
        'representative_membership_id',
        'representative_licence_number',
        'rcic_number',
      ),
    );
  } else {
    missing.push(`${B}: Paid or unpaid`);
  }

  // ── Section C — representative's contact information ─────────────────────
  const C = 'C. Representative contact information';
  const contact = pick(p, 'representative_contact');
  // The representative is often the host in Canada (the son who invites his
  // parent): their email and phone are then the inviter's.
  const isHost =
    !!repFull &&
    [
      pick(p, 'inviter_name', 'host_name'),
      pick(p, 'family_member_name'),
      pick(p, 'accommodation_provider_name'),
    ]
      .filter(Boolean)
      .some((n) => normName(n) === normName(repFull));
  add(
    C,
    'Mailing address',
    pick(p, 'representative_address', 'representative_mailing_address'),
  );
  add(
    C,
    'Telephone',
    pick(p, 'representative_phone', 'representative_telephone') ??
      phoneIn(contact) ??
      (isHost ? pick(p, 'inviter_phone', 'host_phone') : undefined),
  );
  add(
    C,
    'Email',
    pick(p, 'representative_email') ??
      contact?.match(EMAIL)?.[0] ??
      (isHost ? pick(p, 'inviter_email', 'host_email') : undefined),
  );

  // ── Declarations — never filled ──────────────────────────────────────────
  lines.push({
    section: 'D. Declarations',
    label: 'Signatures and dates',
    value:
      'Leave blank here — the applicant and the representative each sign and date the official form themselves',
  });

  return { lines, missing };
}

// ── PDF ───────────────────────────────────────────────────────────────────
const MARGIN = 50;
const W = 612;
const H = 792;

/** Latin-only Helvetica: drop what WinAnsi cannot encode instead of throwing. */
function safe(s: string): string {
  return s
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function wrap(s: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of safe(s).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export async function renderImm5476Sheet(
  answers: Imm5476Answers,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - MARGIN;
  const need = (h: number) => {
    if (y - h < MARGIN) {
      page = pdf.addPage([W, H]);
      y = H - MARGIN;
    }
  };
  const para = (
    s: string,
    font: PDFFont,
    size: number,
    x = MARGIN,
    color = rgb(0, 0, 0),
  ) => {
    for (const l of wrap(s, font, size, W - MARGIN - x)) {
      need(size + 4);
      page.drawText(l, { x, y, size, font, color });
      y -= size + 4;
    }
  };

  para('IMM 5476 - Use of a Representative', bold, 16);
  para('Answers prepared by VisaAI from your application', regular, 11);
  y -= 4;
  para(
    'This sheet is not the official form. Download the official IMM 5476 from canada.ca (search "IMM 5476"), copy these answers onto it, then you and your representative each sign and date it. Upload the signed form with your application.',
    regular,
    9,
    MARGIN,
    rgb(0.35, 0.35, 0.35),
  );
  y -= 10;

  let section = '';
  for (const line of answers.lines) {
    if (line.section !== section) {
      section = line.section;
      y -= 6;
      need(30);
      para(section, bold, 12);
      page.drawLine({
        start: { x: MARGIN, y: y + 2 },
        end: { x: W - MARGIN, y: y + 2 },
        thickness: 0.5,
      });
      y -= 4;
    }
    need(28);
    para(line.label, bold, 9, MARGIN, rgb(0.3, 0.3, 0.3));
    para(line.value, regular, 11, MARGIN + 10);
    y -= 2;
  }

  if (answers.missing.length) {
    y -= 8;
    para(
      'Not in your VisaAI application - fill these in by hand',
      bold,
      12,
      MARGIN,
      rgb(0.71, 0.19, 0.19),
    );
    for (const m of answers.missing) para(`- ${m}`, regular, 10, MARGIN + 10);
  }
  return pdf.save();
}

/** Form renderer for the registry: the answer sheet, or null when no representative is used. */
export async function renderImm5476(
  payload: unknown,
  ctx?: { profile?: Profile },
): Promise<Uint8Array | null> {
  const answers = imm5476Answers(
    ctx?.profile ?? {},
    payload as PrefilledFormPayload | null,
  );
  if (!answers) return null;
  return renderImm5476Sheet(answers);
}
