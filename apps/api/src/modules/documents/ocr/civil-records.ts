/**
 * Civil-status records — birth and marriage certificates — read from OCR text.
 *
 * Dry run 2026-10-15 (Canada visitor visa, Pakistani parent): the applicant
 * uploaded his children's NADRA birth registration certificates and his nikah
 * nama. VisaAI never extracted a child's date of birth, and stored the marriage
 * date as "16-9-1999" when the printed English line reads
 * "The date when the marriage was celebrated 16 - 9 - 1988". IRCC's family
 * pages need each child's name, DOB, sex and country of birth, the spouse's
 * DOB and the marriage date — exactly what these two documents print.
 *
 * Deterministic and label-anchored on purpose:
 *  - one upload often holds several certificates (siblings scanned into one
 *    PDF), which a one-value-per-key extractor cannot represent;
 *  - a nikah nama is handwritten Urdu plus a typed English form; the English
 *    label is the line to trust, and a model asked for "the marriage date" is
 *    free to read a different one;
 *  - it works the same whichever OCR provider ran, in region.
 *
 * Pure: no I/O. Every rule is unit-tested against text shaped like the real
 * documents (civil-records.spec.ts).
 */

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function iso(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return undefined;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function fullYear(raw: string): number {
  const n = +raw;
  if (raw.length === 4) return n;
  // Two-digit year on a civil record: the most recent past century reading.
  const yy = new Date().getUTCFullYear() % 100;
  return n > yy ? 1900 + n : 2000 + n;
}

/** Separators OCR produces inside a numeric date: "16 - 9 - 1988", "16=9-1988". */
const NUM_SEP = String.raw`\s*[-/.=]\s*`;

/**
 * A date token as it appears on civil records, for finding one in running text.
 * Ordered so the longest reading wins at a given position.
 */
const DATE_IN_TEXT = new RegExp(
  [
    String.raw`\d{4}[-/.]\d{1,2}[-/.]\d{1,2}`,
    String.raw`\d{1,2}${NUM_SEP}\d{1,2}${NUM_SEP}(?:\d{4}|\d{2}(?!\d))`,
    String.raw`\d{1,2}[-\s.]*[A-Za-z]{3,}\.?[-,\s.]*\d{4}`,
    String.raw`[A-Za-z]{3,}\.?[-\s]*\d{1,2}\s*,?\s*\d{4}`,
  ].join('|'),
);

export interface CivilDateOptions {
  /**
   * The issuing country writes numeric dates day-first (Pakistan, most of the
   * world). Without it a numeric date is converted only when unambiguous.
   */
  dayFirst?: boolean;
}

/**
 * A civil-record date as YYYY-MM-DD, or undefined when it is not a date or
 * its day/month order cannot be known.
 *
 *   14-October-1989 · 14 Oct 1989 · SEPTEMBER 02,1995 · NOV. 22,1995
 *   1989-10-14 · 16-9-1988 · 16 - 9 - 1988 · 14/10/1989 (unambiguous)
 *   05-06-2017 only with { dayFirst: true }
 */
export function parseCivilDate(
  raw: unknown,
  opts: CivilDateOptions = {},
): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw
    .trim()
    .replace(/^[\s.:,-]+|[\s.,]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!v) return undefined;

  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v))) {
    return iso(+m[1], +m[2], +m[3]);
  }
  if (
    (m = new RegExp(
      String.raw`^(\d{1,2})${NUM_SEP}(\d{1,2})${NUM_SEP}(\d{4}|\d{2})$`,
    ).exec(v))
  ) {
    const a = +m[1];
    const b = +m[2];
    const y = fullYear(m[3]);
    if (a > 12 && b <= 12) return iso(y, b, a);
    if (b > 12 && a <= 12) return iso(y, a, b);
    if (a === b) return iso(y, a, b);
    return opts.dayFirst ? iso(y, b, a) : undefined;
  }
  if ((m = /^(\d{1,2})[-\s.]*([A-Za-z]{3,})\.?[-,\s.]*(\d{4})$/.exec(v))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mo ? iso(+m[3], mo, +m[1]) : undefined;
  }
  if ((m = /^([A-Za-z]{3,})\.?[-\s]*(\d{1,2})\s*,?\s*(\d{4})$/.exec(v))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mo ? iso(+m[3], mo, +m[2]) : undefined;
  }
  return undefined;
}

/** The first date in `text` (any civil-record shape), parsed. */
function firstDate(text: string, opts: CivilDateOptions): string | undefined {
  const re = new RegExp(DATE_IN_TEXT.source, 'g');
  for (const m of text.matchAll(re)) {
    const d = parseCivilDate(m[0], opts);
    if (d) return d;
  }
  return undefined;
}

// ─── Shared text helpers ─────────────────────────────────────────────────────

const CNIC = /(?<![\d-])(\d{5})[-\s]?(\d{7})[-\s]?(\d)(?![\d-])/;

/** Latin-script part of a value: OCR puts the Urdu rendering on the same line. */
function latinOnly(s: string): string {
  return s
    .replace(/[^\p{Script=Latin}\s.,'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A person's name, cleaned of leaders, trailing relatives and noise. */
function cleanPersonName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // "Muzaffar Ahmad S/O Mian Abdul Rashid" → the person, not the father.
  // Cut before latinOnly, which would turn the slash into a space.
  const own = raw.replace(
    /\s+(?:[SDW]\s*[/.]\s*O|son of|daughter of|wife of|bin|binti)\b.*$/i,
    '',
  );
  let v = latinOnly(own)
    .replace(/^[\s.:,?'-]+/, '')
    .replace(/[\s.,'-]+$/, '')
    .trim();
  // A field label that bled into the value is not a name.
  if (
    !v ||
    v.length < 2 ||
    /\b(?:name|date|birth|gender|sex|nationality|cnic|religion|district|father|mother|address|residence)\b/i.test(
      v,
    )
  ) {
    return undefined;
  }
  // "CHOUDHRY, FARHANA ARSHED" is printed surname-first; keep the comma for
  // splitNameParts, collapse anything else.
  v = v.replace(/\s*,\s*/g, ', ');
  return /\p{L}{2}/u.test(v) ? v : undefined;
}

/**
 * The value printed for a label: the rest of the label's line, or — when the
 * label sits alone on its line, as OCR layout often puts it — the next line
 * that is not itself a label. `isLabel` decides what counts as one.
 */
function valueAfter(
  lines: string[],
  index: number,
  labelEnd: number,
  accept: (candidate: string) => string | undefined,
  lookahead = 2,
): string | undefined {
  const sameLine = accept(lines[index].slice(labelEnd));
  if (sameLine) return sameLine;
  for (let i = index + 1; i <= index + lookahead && i < lines.length; i++) {
    const v = accept(lines[i]);
    if (v) return v;
  }
  return undefined;
}

function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// ─── Country of birth ────────────────────────────────────────────────────────

/**
 * Where the birth happened, inferred from WHO REGISTERED it. A birth is
 * registered by the civil registry of the place it occurred, so a Punjab /
 * NADRA CRMS certificate records a birth in Pakistan and an Ontario
 * certificate a birth in Canada. Only issuers recognised with certainty are
 * listed — anything else stays unknown rather than guessed.
 */
export function inferBirthCountry(text: string): string | undefined {
  const explicit =
    /country\s+of\s+birth\s*[:\-—]?\s*([A-Za-z][A-Za-z ]{2,30})/i.exec(text);
  if (explicit) {
    const v = explicit[1].trim().split(/\s{2,}|\n/)[0];
    if (v && !/\b(?:date|name|sex)\b/i.test(v)) return titleCase(v);
  }
  if (
    /\bgovernment of (?:the )?punjab\b|\bNADRA\b|\bCRMS\b|\bunion council\b|\bgovernment of (?:sindh|khyber pakhtunkhwa|balochistan)\b|\bislamic republic of pakistan\b|\bcrms\.nadra\.gov\.pk\b/i.test(
      text,
    )
  ) {
    return 'Pakistan';
  }
  if (
    /\b(?:ontario|british columbia|alberta|qu[ée]bec|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward island)\b/i.test(
      text,
    ) &&
    /\bcanada\b|\bvital statistics\b|\bregistrar general\b/i.test(text)
  ) {
    return 'Canada';
  }
  return undefined;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
    .trim();
}

/** Pakistani civil records print numeric dates day-first. */
function isPakistaniRecord(text: string): boolean {
  return inferBirthCountry(text) === 'Pakistan' || /\bnikah\b/i.test(text);
}

// ─── Birth certificates ──────────────────────────────────────────────────────

export interface BirthRecord {
  /** The child's name as printed ("FARHANA ARSHED CHOUDHRY" for a surname-first print). */
  full_name?: string;
  given_name?: string;
  family_name?: string;
  date_of_birth?: string;
  /** 'Male' | 'Female' */
  sex?: string;
  /** City / district of birth as printed. */
  place_of_birth?: string;
  country_of_birth?: string;
  father_name?: string;
  mother_name?: string;
  father_national_id?: string;
  mother_national_id?: string;
  /** "Relation of Child: SON" — the registrant's relation, when printed. */
  relation?: 'son' | 'daughter';
}

const BIRTH_HEADER =
  /birth\s+registration\s+certificate|certificate\s+of\s+birth|birth\s+certificate|certificat\s+de\s+naissance/gi;

/**
 * Split a multi-certificate upload into one block per certificate. Each
 * header starts a block; text before the first header belongs to the first.
 * Bilingual prints repeat the header ("BIRTH CERTIFICATE / CERTIFICAT DE
 * NAISSANCE"), so a header within a few lines of the previous one does not
 * start a new block.
 */
function birthBlocks(text: string): string[] {
  const starts: number[] = [];
  for (const m of text.matchAll(BIRTH_HEADER)) {
    const at = m.index ?? 0;
    const prev = starts[starts.length - 1];
    if (
      prev !== undefined &&
      !/\b(?:date\s*of\s*birth|name)\b/i.test(text.slice(prev, at))
    ) {
      continue;
    }
    starts.push(at);
  }
  if (starts.length <= 1) return [text];
  const blocks: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const from = i === 0 ? 0 : starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : text.length;
    blocks.push(text.slice(from, to));
  }
  return blocks;
}

function normalizeSexValue(v: string): string | undefined {
  const s = v.trim().toLowerCase();
  if (s === 'm' || s === 'male' || s === 'masculin') return 'Male';
  if (s === 'f' || s === 'female' || s === 'féminin' || s === 'feminin')
    return 'Female';
  return undefined;
}

/** "CHOUDHRY, FARHANA ARSHED" → given/family; anything else → full name only. */
function splitNameParts(
  name: string,
): Pick<BirthRecord, 'full_name' | 'given_name' | 'family_name'> {
  const comma = /^([^,]+),\s*(.+)$/.exec(name);
  if (comma) {
    const family = comma[1].trim();
    const given = comma[2].trim();
    return {
      full_name: `${given} ${family}`,
      given_name: given,
      family_name: family,
    };
  }
  return { full_name: name };
}

const CHILD_NAME_LABEL =
  /^(?:child'?s\s+)?name\s*(?:[-—–/]\s*nom)?\s*[:\-—–]?/i;
const DOB_LABEL = /date\s*of\s*birth|birth\s*date|date\s+de\s+naissance/i;
const SEX_LABEL = /^(?:gender|sex)\b(?:\s*[-—–/]\s*sexe)?\s*[:\-—–]?/i;
const PLACE_LABEL =
  /(?:district|place|city)\s+of\s+birth|birth\s*place|lieu\s+de\s+naissance/i;
const FATHER_LABEL = /(?<!grand\s?)father'?s?\s*name\s*[:\-—–]?/i;
const MOTHER_LABEL = /mother'?s?\s*name\s*[:\-—–]?/i;

function parseBirthBlock(block: string, pakistani: boolean): BirthRecord {
  const lines = toLines(block);
  const rec: BirthRecord = {};
  const dateOpts = { dayFirst: pakistani };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!rec.full_name) {
      const m = CHILD_NAME_LABEL.exec(line);
      if (m) {
        const name = valueAfter(lines, i, m[0].length, (c) =>
          CHILD_NAME_LABEL.test(c) ? undefined : cleanPersonName(c),
        );
        if (name) Object.assign(rec, splitNameParts(name));
      }
    }

    if (!rec.date_of_birth) {
      const m = DOB_LABEL.exec(line);
      if (m) {
        const window = [
          line.slice((m.index ?? 0) + m[0].length),
          ...lines.slice(i + 1, i + 3),
        ].join('\n');
        const d = firstDate(window, dateOpts);
        if (d) rec.date_of_birth = d;
      }
    }

    if (!rec.sex) {
      const m = SEX_LABEL.exec(line);
      if (m) {
        const v = valueAfter(lines, i, m[0].length, (c) => {
          const s = /^\s*[:\-—–]?\s*(male|female|m|f)\b/i.exec(c);
          return s ? normalizeSexValue(s[1]) : undefined;
        });
        if (v) rec.sex = v;
      }
    }

    if (!rec.place_of_birth) {
      const m = PLACE_LABEL.exec(line);
      if (m) {
        const v = valueAfter(lines, i, (m.index ?? 0) + m[0].length, (c) => {
          const cleaned = latinOnly(
            c.replace(/^\s*[-—–/]?\s*lieu\s+de\s+naissance/i, ''),
          ).replace(/^[\s:.\-—–]+/, '');
          if (!cleaned || PLACE_LABEL.test(cleaned)) return undefined;
          if (
            /\b(?:date|name|sex|gender|religion|registration)\b/i.test(cleaned)
          )
            return undefined;
          return cleaned.split(/\s{2,}| Religion\b/i)[0].trim() || undefined;
        });
        if (v) rec.place_of_birth = v;
      }
    }

    if (!rec.father_name) {
      const m = FATHER_LABEL.exec(line);
      if (m) {
        const v = valueAfter(lines, i, (m.index ?? 0) + m[0].length, (c) =>
          cleanPersonName(c),
        );
        if (v) rec.father_name = v;
        const cnic = CNIC.exec(
          lines
            .slice(i, i + 7)
            .join('\n')
            .split(MOTHER_LABEL)[0],
        );
        if (cnic) rec.father_national_id = `${cnic[1]}-${cnic[2]}-${cnic[3]}`;
      }
    }

    if (!rec.mother_name) {
      const m = MOTHER_LABEL.exec(line);
      if (m) {
        const v = valueAfter(lines, i, (m.index ?? 0) + m[0].length, (c) =>
          cleanPersonName(c),
        );
        if (v) rec.mother_name = v;
        const after = [
          line.slice((m.index ?? 0) + m[0].length),
          ...lines.slice(i + 1, i + 7),
        ]
          .join('\n')
          .split(/grand\s*father|father'?s?\s*name|address/i)[0];
        const cnic = CNIC.exec(after);
        if (cnic) rec.mother_national_id = `${cnic[1]}-${cnic[2]}-${cnic[3]}`;
      }
    }

    if (!rec.relation) {
      const m = /relation\s+of\s+child\s*[:-]?\s*(son|daughter)\b/i.exec(
        [line, lines[i + 1] ?? ''].join(' '),
      );
      if (m) rec.relation = m[1].toLowerCase() as 'son' | 'daughter';
    }
  }

  const country = inferBirthCountry(block);
  if (country) rec.country_of_birth = country;
  return rec;
}

/**
 * Every certificate in a birth-certificate upload, in print order. A block
 * that yields neither a name nor a date of birth is dropped — it is a cover
 * page, an attestation stamp or the back of the card, not a record.
 */
export function parseBirthCertificates(
  text: string | null | undefined,
): BirthRecord[] {
  const t = text ?? '';
  if (!t.trim()) return [];
  const pakistani = isPakistaniRecord(t);
  // Country is inferred from the whole upload when a block lacks the header
  // that names the issuer.
  const docCountry = inferBirthCountry(t);
  return birthBlocks(t)
    .map((b) => parseBirthBlock(b, pakistani))
    .filter((r) => r.full_name || r.date_of_birth)
    .map((r) =>
      r.country_of_birth || !docCountry
        ? r
        : { ...r, country_of_birth: docCountry },
    );
}

// ─── Marriage certificates ───────────────────────────────────────────────────

export interface MarriageRecord {
  /** YYYY-MM-DD from the printed English label, when one is readable. */
  marriage_date?: string;
  /** Which printed line the date came from. */
  marriage_date_label?: 'solemnized' | 'registered' | 'date_of_marriage';
  /** Set when two labelled lines print different dates. */
  marriage_date_conflict?: string[];
  /** The husband / bridegroom. */
  bridegroom_name?: string;
  /** The wife / bride. */
  bride_name?: string;
}

const MARRIAGE_DATE_LABELS: Array<
  [RegExp, MarriageRecord['marriage_date_label']]
> = [
  [
    /date\s+(?:when|on\s+which)\s+(?:the\s+)?marriage\s+was\s+(?:solemni[sz]ed|celebrated|held|performed|contracted)/i,
    'solemnized',
  ],
  [
    /date\s+of\s+(?:the\s+)?(?:marriage|nikah|solemni[sz]ation)\b(?!\s+registration)/i,
    'date_of_marriage',
  ],
  [/\bmarriage\s+date\b/i, 'date_of_marriage'],
  [
    /date\s+(?:when|on\s+which)\s+(?:the\s+)?marriage\s+was\s+registered|date\s+of\s+(?:marriage\s+)?registration/i,
    'registered',
  ],
];

const GROOM_LABEL =
  /name\s+of\s+the\s+bride\s*groom\??|bride\s*groom'?s\s+name|name\s+of\s+(?:the\s+)?husband|husband'?s\s+name|^groom\b\s*[:-]?/i;
const BRIDE_LABEL =
  /name\s+of\s+the\s+bride(?!\s*groom)|bride'?s\s+name(?!\s*groom)|name\s+of\s+(?:the\s+)?wife|wife'?s\s+name|^bride\b(?!\s*groom)\s*[:-]?/i;

/** Strip the label's own continuation ("& her fathers", "his father along with…"). */
function partyValue(raw: string): string | undefined {
  const v = raw
    .replace(/^[\s?.:-]+/, '')
    .replace(
      /^(?:&|and)\s+(?:her|his)\s+fathers?'?s?(?:\s+name)?(?:\s+along\s+with\s+(?:her|his)\s+residence)?\.?/i,
      '',
    )
    .replace(/^[\s?.:}\])-]+/, '');
  return cleanPersonName(v);
}

/**
 * The marriage date and the two parties from a marriage certificate / nikah
 * nama. The date comes ONLY from a labelled English line ("The date when the
 * marriage was solemnized/celebrated", "The date when the marriage was
 * registered", "Date of marriage"); an unlabelled date anywhere else on the
 * page is never taken. When the solemnization and registration lines differ,
 * the solemnization date wins and both are reported.
 */
export function parseMarriageCertificate(
  text: string | null | undefined,
): MarriageRecord {
  const t = text ?? '';
  if (!t.trim()) return {};
  const lines = toLines(t);
  const dateOpts = { dayFirst: isPakistaniRecord(t) };
  const rec: MarriageRecord = {};
  const found: Array<{
    date: string;
    label: MarriageRecord['marriage_date_label'];
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [re, label] of MARRIAGE_DATE_LABELS) {
      const m = re.exec(line);
      if (!m) continue;
      const window = [
        line.slice((m.index ?? 0) + m[0].length),
        lines[i + 1] ?? '',
      ].join('\n');
      const d = firstDate(window, dateOpts);
      if (d) found.push({ date: d, label });
      break;
    }

    if (!rec.bridegroom_name) {
      const m = GROOM_LABEL.exec(line);
      if (m) {
        const v = valueAfter(
          lines,
          i,
          (m.index ?? 0) + m[0].length,
          (c) =>
            GROOM_LABEL.test(c) || BRIDE_LABEL.test(c)
              ? undefined
              : partyValue(c),
          1,
        );
        if (v) rec.bridegroom_name = v;
      }
    }
    if (!rec.bride_name) {
      const m = BRIDE_LABEL.exec(line);
      if (m) {
        const v = valueAfter(
          lines,
          i,
          (m.index ?? 0) + m[0].length,
          (c) =>
            GROOM_LABEL.test(c) || BRIDE_LABEL.test(c)
              ? undefined
              : partyValue(c),
          1,
        );
        if (v) rec.bride_name = v;
      }
    }
  }

  const event = found.filter((f) => f.label !== 'registered');
  const chosen = event[0] ?? found[0];
  if (chosen) {
    rec.marriage_date = chosen.date;
    rec.marriage_date_label = chosen.label;
    const distinct = [...new Set(found.map((f) => f.date))];
    if (distinct.length > 1) rec.marriage_date_conflict = distinct;
  }
  return rec;
}

// ─── Kind ────────────────────────────────────────────────────────────────────

export type CivilRecordKind = 'birth_certificate' | 'marriage_certificate';

/** Text that is plainly a marriage certificate / nikah nama. */
export function looksLikeMarriageCertificate(text: string): boolean {
  return /\bnikah\s*nama\b|\bnikahnama\b|\bmarriage\s+certificate\b|\bcertificate\s+of\s+marriage\b|\bmarriage\s+registration\s+certificate\b|\bmarriage\s+was\s+(?:solemni[sz]ed|celebrated|registered)\b/i.test(
    text,
  );
}

/** Text that is plainly a birth certificate / birth registration. */
export function looksLikeBirthCertificate(text: string): boolean {
  return /\bbirth\s+registration\s+certificate\b|\bbirth\s+certificate\b|\bcertificate\s+of\s+birth\b|\bcertificat\s+de\s+naissance\b|\bchild'?s\s+details\b[\s\S]{0,400}\bdate\s+of\s+birth\b/i.test(
    text,
  );
}

/**
 * Which civil record a document is: its own type when that says so, else its
 * text. Typed slots such as "proof_of_relationship" or "family_documents" hold
 * these certificates as often as a dedicated slot does.
 */
export function civilRecordKind(
  documentType: string | null | undefined,
  text: string | null | undefined,
): CivilRecordKind | null {
  const type = (documentType ?? '').toLowerCase();
  if (/birth_cert|birth_registration/.test(type)) return 'birth_certificate';
  if (/marriage|nikah/.test(type)) return 'marriage_certificate';
  // Identity documents and financial evidence keep their own type.
  if (
    /passport|national_id|id_card|cnic|bank|statement|employ|insurance|medical/.test(
      type,
    )
  ) {
    return null;
  }
  const t = text ?? '';
  if (!t.trim()) return null;
  if (looksLikeMarriageCertificate(t)) return 'marriage_certificate';
  if (looksLikeBirthCertificate(t)) return 'birth_certificate';
  return null;
}
