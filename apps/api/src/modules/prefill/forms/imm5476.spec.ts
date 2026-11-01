import { PDFDocument } from 'pdf-lib';
import { imm5476Answers, renderImm5476 } from './imm5476';
import { isOfficialFormSupported, tryRenderOfficialForm } from './index';
import { preparedFormNote } from '../../../strategies/form-mapping/prepared-forms';

/**
 * IMM 5476 prepared from the profile (dry run 2026-10-17, app 71ad0c29): the
 * applicant's son, his unpaid representative and host in Canada.
 */
const PROFILE = {
  applicant_name: 'Muzaffar Ahmad',
  date_of_birth: '1961-06-15',
  uci: '1147908458',
  visa_type: 'Visitor Visa (Temporary Resident Visa)',
  uses_representative: true,
  representative_name: 'Mian Muhammad Bilawal',
  representative_paid: false,
  representative_address:
    '1202 Stirling Todd Terrace, Milton, ON L9E 2E2, Canada',
  representative_contact: '905-226-5664',
  family_member_name: 'Mian Muhammad Bilawal',
  inviter_email: 'bilawalmuzaffar@gmail.com',
};

const byLabel = (
  a: ReturnType<typeof imm5476Answers>,
  section: string,
  label: string,
) =>
  a!.lines.find((l) => l.section.startsWith(section) && l.label === label)
    ?.value;

describe('IMM 5476 answers', () => {
  it('fills the applicant and an unpaid representative from the profile', () => {
    const a = imm5476Answers(PROFILE);
    expect(byLabel(a, 'A.', 'Family name')).toBe('Ahmad');
    expect(byLabel(a, 'A.', 'Given name(s)')).toBe('Muzaffar');
    expect(byLabel(a, 'A.', 'Date of birth (YYYY-MM-DD)')).toBe('1961-06-15');
    expect(byLabel(a, 'A.', 'UCI (if known)')).toBe('1147908458');
    expect(byLabel(a, 'A.', 'Application or request being submitted')).toBe(
      'Application for a Temporary Resident Visa (visitor visa)',
    );
    expect(byLabel(a, 'B.', 'Family name')).toBe('Bilawal');
    expect(byLabel(a, 'B.', 'Given name(s)')).toBe('Mian Muhammad');
    expect(byLabel(a, 'B.', 'Type of representative')).toMatch(/^Unpaid/);
    expect(byLabel(a, 'C.', 'Mailing address')).toBe(
      '1202 Stirling Todd Terrace, Milton, ON L9E 2E2, Canada',
    );
    expect(byLabel(a, 'C.', 'Telephone')).toBe('905-226-5664');
    // The representative is the host: his email is the inviter's.
    expect(byLabel(a, 'C.', 'Email')).toBe('bilawalmuzaffar@gmail.com');
    expect(a!.missing).toEqual([]);
  });

  it('never fills a signature or a date', () => {
    const a = imm5476Answers(PROFILE)!;
    const decl = a.lines.filter((l) => l.section.startsWith('D.'));
    expect(decl).toHaveLength(1);
    expect(decl[0].value).toMatch(/Leave blank/);
  });

  it('a paid representative needs a membership ID; without one it is listed as missing', () => {
    const a = imm5476Answers({ ...PROFILE, representative_paid: true });
    expect(byLabel(a, 'B.', 'Type of representative')).toMatch(/^Paid/);
    expect(a!.missing).toContain(
      'B. Representative: Membership ID (CICC, law society or Chambre des notaires)',
    );
    const withId = imm5476Answers({
      ...PROFILE,
      representative_paid: true,
      representative_membership_id: 'R512345',
    });
    expect(
      byLabel(
        withId,
        'B.',
        'Membership ID (CICC, law society or Chambre des notaires)',
      ),
    ).toBe('R512345');
  });

  it('leaves what the profile lacks blank and lists it', () => {
    const a = imm5476Answers({
      uses_representative: 'yes',
      representative_name: 'Ali Khan',
    })!;
    expect(a.missing).toEqual(
      expect.arrayContaining([
        'A. Applicant: Family name',
        'A. Applicant: Date of birth (YYYY-MM-DD)',
        'B. Representative: Paid or unpaid',
        'C. Representative contact information: Mailing address',
        'C. Representative contact information: Telephone',
        'C. Representative contact information: Email',
      ]),
    );
    expect(byLabel(a, 'A.', 'UCI (if known)')).toBe('None — leave blank');
  });

  it('a host email is not borrowed for a representative who is someone else', () => {
    const a = imm5476Answers({
      ...PROFILE,
      representative_name: 'Sara Malik',
      representative_contact: 'sara@example.com',
    });
    expect(byLabel(a, 'C.', 'Email')).toBe('sara@example.com');
    expect(a!.missing).toContain(
      'C. Representative contact information: Telephone',
    );
  });

  it('is not prepared when no representative is used', () => {
    expect(
      imm5476Answers({ ...PROFILE, uses_representative: false }),
    ).toBeNull();
    expect(imm5476Answers({ applicant_name: 'X Y' })).toBeNull();
  });
});

describe('IMM 5476 sheet', () => {
  it('renders a printable PDF through the official-forms registry, with the profile', async () => {
    expect(isOfficialFormSupported('IMM 5476')).toBe(true);
    const bytes = await tryRenderOfficialForm(
      'IMM 5476',
      { fields: [] } as never,
      { profile: PROFILE },
    );
    expect(bytes).not.toBeNull();
    const doc = await PDFDocument.load(bytes!);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders nothing without a representative', async () => {
    expect(
      await renderImm5476(
        { fields: [] },
        { profile: { uses_representative: false } },
      ),
    ).toBeNull();
  });

  it('carries the pre-filled note for the checklist and the Forms page', () => {
    expect(preparedFormNote('IMM 5476')).toMatch(/pre-filled, print and sign/);
    expect(preparedFormNote('imm5476')).toBeDefined();
    expect(preparedFormNote('IMM 5257')).toBeUndefined();
  });
});
