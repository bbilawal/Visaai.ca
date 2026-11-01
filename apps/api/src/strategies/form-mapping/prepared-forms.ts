/**
 * Forms VisaAI prepares from the application itself (rather than stamping an
 * official template), with what the applicant does next. Shown on the Forms
 * page and carried onto the form's checklist item.
 */
export const PREPARED_FORM_NOTES: Record<string, string> = {
  IMM5476:
    'VisaAI prepares your answers: on the Forms page, download "IMM 5476 - pre-filled, print and sign", copy the answers onto the official IMM 5476, have you and your representative sign it, and upload the signed form here.',
  IMM1294:
    'VisaAI prepares your answers: on the Forms page, download "IMM 1294 - pre-filled, print and sign", then in your IRCC secure account download IMM 1294 from your document checklist, open it in Adobe Reader, copy the answers onto it, click Validate and upload it there. Sign it yourself.',
};

export function preparedFormNote(formCode: string): string | undefined {
  return PREPARED_FORM_NOTES[formCode.toUpperCase().replace(/\s+/g, '')];
}
