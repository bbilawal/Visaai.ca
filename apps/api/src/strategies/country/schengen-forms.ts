import type { FormSpec } from '../types';

/**
 * The harmonised Schengen visa application form.
 *
 * One form, twenty-nine member states. It is laid down in Annex I of the Visa
 * Code (Regulation (EC) No 810/2009) and is identical across the area by law,
 * so every member's programs point at the same spec and share one cached copy.
 *
 * `sourceUrl` is the Commission's stable policy page, not a deep link: the
 * document itself is versioned by UUID
 * (`/document/download/<uuid>_en?filename=Visa Application Form.pdf`), and a
 * hardcoded deep link is exactly what rotted in the IRCC integration. The
 * `schengen-consulate` discovery strategy resolves the current one, matching
 * on the filename because that page carries five PDFs and the first in
 * document order is the ICAO photograph spec.
 */
export const SCHENGEN_FORMS: FormSpec[] = [
  {
    formCode: 'SCHENGEN-C',
    formName: 'Application for Schengen Visa (harmonised form)',
    sourceUrl:
      'https://home-affairs.ec.europa.eu/policies/schengen/visa-policy/applying-schengen-visa_en',
  },
];
