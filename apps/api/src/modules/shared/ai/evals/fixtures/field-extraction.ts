import type { EvalCase } from '../eval-harness';

/**
 * A field-extraction case, expressed in the vocabulary PRODUCTION uses.
 *
 * `documentType` is not decoration: it selects the real prompt, via
 * `extractionPromptFor()`, and with it the real key set. A case that does not
 * name its type cannot be evaluated against what the product actually sends.
 */
export interface FieldExtractionCase {
  documentType: string;
  /**
   * Only the keys this case is about. The scorer checks exactly the keys
   * present here, so a case asserts the property it exists to protect and
   * stays silent about the rest — `sex` and `place_of_birth` are real keys,
   * but nothing here is trying to pin them.
   */
  expected: Record<string, string | null>;
}

/** Kept for callers that still import it. Production keys, not a bespoke shape. */
export type ExtractedFields = Record<string, string | null>;

/**
 * Eval fixtures for `field_extraction`.
 *
 * ALL SYNTHETIC — see the note in document-classification.ts. Names are
 * placeholders, numbers are zero-padded so they cannot resemble a real document
 * number, and every date is unambiguous unless the case is about ambiguity.
 *
 * REWRITTEN 2026-08-21, BECAUSE THE FIRST VERSION MEASURED NOTHING REAL
 *
 * The original set was written against a hand-authored prompt in the eval
 * runner and a five-key shape — `full_name`, `date_of_birth`, `document_number`,
 * `expiry_date`, `issuing_authority` — that exists nowhere in the product.
 * Production builds its prompt from `extractionPromptFor(documentType)` over a
 * typed per-type schema, and a passport there has eleven keys, `passport_number`
 * among them. There is no `document_number` anywhere.
 *
 * So the suite scored 70-80% against a prompt no code path sends, and its two
 * permanent failures were artifacts of that mismatch rather than model
 * weakness:
 *
 *   * `non-latin-name` expected `full_name: 'WEI ZHANG'` — a Latin-only,
 *     given-name-first normalisation the prompt never asked for. Production
 *     asks for `given_name` and `family_name` "exactly as printed", and the
 *     model returns exactly that.
 *   * `degraded-ocr` expected `document_number: 'EX0000005'`, silently
 *     repairing the letter O in `EX00000O5` — while the same prompt said "Do
 *     NOT infer". It required the behaviour it forbade.
 *
 * THE FAILURES THIS SET IS BUILT AROUND
 *
 * 1. **Inventing a value that is not on the document.** An extractor that fills
 *    every field because the schema has slots writes a fabricated expiry date
 *    into an applicant's profile, which then drives a reminder and a readiness
 *    score. Several cases have a genuinely absent field, and `null` is correct.
 *
 * 2. **Silently "correcting" a document number.** `degraded-ocr` now pins the
 *    verbatim reading. A repaired passport number is indistinguishable from a
 *    real one to every downstream consumer, and if the repair is wrong it puts
 *    a number the applicant does not hold onto a government form. Extract what
 *    is there; let a human resolve the ambiguity.
 *
 * 3. **Date-format confusion.** 03/04/2026 is 3 April in most of the world and
 *    4 March in the United States, and VisaAI serves both. Cases carry the
 *    format explicitly, as a document would.
 */
export const FIELD_EXTRACTION_CASES: EvalCase<string, FieldExtractionCase>[] = [
  {
    id: 'passport-complete',
    input:
      'REPUBLIC OF EXAMPLIA — PASSPORT. Passport No EX0000000. ' +
      'Surname: SAMPLE. Given names: ALEX JORDAN. Date of birth: 01 JAN 1990. ' +
      'Date of expiry: 01 JAN 2030. Authority: PASSPORT OFFICE OF EXAMPLIA.',
    expected: {
      documentType: 'passport',
      expected: {
        passport_number: 'EX0000000',
        given_name: 'ALEX JORDAN',
        family_name: 'SAMPLE',
        date_of_birth: '1990-01-01',
        expiry_date: '2030-01-01',
        issuing_authority: 'PASSPORT OFFICE OF EXAMPLIA',
        // The passport schema offers these; this document states neither.
        // Null is the correct answer and inventing one is the failure this
        // whole suite exists to catch.
        issue_date: null,
        sex: null,
      },
    },
    rationale:
      'The baseline. Everything present and unambiguous — if this fails, ' +
      'nothing else in the set means anything.',
  },
  {
    id: 'no-expiry-present',
    input:
      'REPUBLIC OF EXAMPLIA — BIRTH CERTIFICATE. Registration No 0000000. ' +
      'Name: ALEX JORDAN SAMPLE. Date of birth: 01 JAN 1990. ' +
      'Registered by: CIVIL REGISTRY OF EXAMPLIA.',
    expected: {
      documentType: 'birth_certificate',
      expected: {
        full_name: 'ALEX JORDAN SAMPLE',
        date_of_birth: '1990-01-01',
      },
    },
    rationale:
      'A birth certificate never expires. The schema for this type has no ' +
      'expiry key at all, which is the structural version of the same ' +
      'protection: the model is not offered a slot it could fill wrongly.',
  },
  {
    id: 'no-document-number',
    input:
      'EXAMPLE CORP LIMITED. This letter confirms that ALEX JORDAN SAMPLE, born ' +
      '01 January 1990, has been employed here since 14 February 2021. ' +
      'Signed, HR Director, Example Corp Limited.',
    expected: {
      documentType: 'employment_letter',
      expected: {
        full_name: 'ALEX JORDAN SAMPLE',
        date_of_birth: '1990-01-01',
        employer: 'Example Corp Limited',
        employment_start_date: '2021-02-14',
      },
    },
    rationale:
      'A letter carries no number and no expiry, and under the real schema it ' +
      'is not asked for either. Pins the employment fields it DOES carry, ' +
      'including a date written in prose rather than as a field.',
  },
  {
    id: 'date-format-dd-mm-yyyy',
    input:
      'REPUBLIC OF EXAMPLIA — PASSPORT. Passport No EX0000001. ' +
      'Name: ALEX JORDAN SAMPLE. DOB: 03/04/1990 (DD/MM/YYYY). ' +
      'Expiry: 03/04/2030 (DD/MM/YYYY). Authority: PASSPORT OFFICE.',
    expected: {
      documentType: 'passport',
      expected: {
        passport_number: 'EX0000001',
        date_of_birth: '1990-04-03',
        expiry_date: '2030-04-03',
      },
    },
    rationale:
      'The document states its own format. Reading it as 4 March would put a ' +
      'wrong date of birth on a visa application.',
  },
  {
    id: 'date-format-us',
    input:
      'UNITED STATES — SAMPLE DOCUMENT. Document No US0000002. ' +
      'Name: ALEX JORDAN SAMPLE. Date of Birth: 03/04/1990 (MM/DD/YYYY). ' +
      'Expires: 03/04/2030 (MM/DD/YYYY). Issued by: SAMPLE AUTHORITY.',
    expected: {
      documentType: 'passport',
      expected: {
        date_of_birth: '1990-03-04',
        expiry_date: '2030-03-04',
      },
    },
    rationale:
      'The same digits as the previous case, the opposite answer. Together ' +
      'they catch an extractor that has quietly hardcoded one convention.',
  },
  {
    id: 'non-latin-name',
    input:
      'REPUBLIC OF EXAMPLIA — PASSPORT. Passport No EX0000003. ' +
      'Surname: 张 / ZHANG. Given names: 伟 / WEI. Date of birth: 01 JAN 1990. ' +
      'Date of expiry: 01 JAN 2030. Authority: PASSPORT OFFICE.',
    expected: {
      documentType: 'passport',
      expected: {
        passport_number: 'EX0000003',
        given_name: '伟 / WEI',
        family_name: '张 / ZHANG',
        date_of_birth: '1990-01-01',
      },
    },
    rationale:
      'Dual-script name. Production asks for the name "exactly as printed", ' +
      'so the dual-script form IS the correct answer — dropping the native ' +
      'script would be a normalisation nobody asked for, on the field a ' +
      'consular officer compares against the passport itself.',
  },
  {
    id: 'name-with-particles',
    input:
      'REPUBLIC OF EXAMPLIA — PASSPORT. Passport No EX0000004. ' +
      'Surname: VAN DER BERG. Given names: ALEX JORDAN. ' +
      'Date of birth: 01 JAN 1990. Date of expiry: 01 JAN 2030. ' +
      'Authority: PASSPORT OFFICE.',
    expected: {
      documentType: 'passport',
      expected: {
        given_name: 'ALEX JORDAN',
        family_name: 'VAN DER BERG',
        issue_date: null,
        place_of_birth: null,
      },
    },
    rationale:
      'A multi-word surname. Splitting it, or promoting "VAN DER" into the ' +
      'given names, breaks the name match against the passport.',
  },
  {
    id: 'degraded-ocr',
    input:
      'REPUBL1C 0F EXAMPLIA PASSP0RT Passp0rt N0 EX00000O5 Surnam3 SAMPLE ' +
      'Giv3n nam3s ALEX J0RDAN Dat3 0f birth 01 JAN 1990 Expiry 01 JAN 2030',
    expected: {
      documentType: 'passport',
      expected: {
        // Verbatim, letter O and all. Repairing this to EX0000005 would be a
        // GUESS about a government-issued identifier, and a wrong guess is
        // indistinguishable from a right one downstream.
        passport_number: 'EX00000O5',
        family_name: 'SAMPLE',
        date_of_birth: '1990-01-01',
        expiry_date: '2030-01-01',
      },
    },
    rationale:
      'Phone-camera OCR. The point is what the extractor must NOT do: ' +
      'silently repair a corrupted passport number. Dates and the surname are ' +
      'still recoverable, so it also proves that refusing to invent one field ' +
      'has not made it give up on the rest.',
  },
  {
    id: 'two-dates-one-is-issue',
    input:
      'REPUBLIC OF EXAMPLIA — PASSPORT. Passport No EX0000006. ' +
      'Name: ALEX JORDAN SAMPLE. Date of birth: 01 JAN 1990. ' +
      'Date of issue: 15 JUN 2020. Date of expiry: 15 JUN 2030. ' +
      'Authority: PASSPORT OFFICE.',
    expected: {
      documentType: 'passport',
      expected: {
        issue_date: '2020-06-15',
        expiry_date: '2030-06-15',
        date_of_birth: '1990-01-01',
      },
    },
    rationale:
      'Three dates, all plausible. Swapping issue for expiry makes a valid ' +
      'passport look ten years expired, or an expired one look valid.',
  },
  {
    id: 'empty-input',
    input: '   ',
    expected: {
      documentType: 'passport',
      expected: {
        passport_number: null,
        full_name: null,
        date_of_birth: null,
        expiry_date: null,
        issuing_authority: null,
      },
    },
    rationale:
      'Nothing in, nothing out. An extractor that hallucinates a plausible ' +
      'passport from an empty page is the worst failure in the set, because ' +
      'every field it produces looks exactly like a real one.',
  },
];
