/**
 * PR #183 review: the Forms-page inviter questions read the facts the way the
 * IRCC fill does; the relationship options match whole words only; the
 * second-inviter questions recognise every key variant and do not duplicate
 * a field of the same label.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import { relationshipOption } from '../src/modules/automation/portal-fills/canada-ircc';
import {
  finalizeFields,
  type FinalizeContext,
} from '../src/modules/prefill/graphs/nodes/finalize-fields';
import type { PrefilledFormField } from '@visaai/types';

const TRV = 'ca-visitor-visa-temporary-resident-visa';
const ctx = (
  profile: Record<string, unknown>,
  visaaiId = TRV,
): FinalizeContext => ({
  applicantName: 'AMIT SHARMA',
  profile,
  documentFields: {},
  documentFieldsByType: {},
  otherPartyDocuments: [],
  accountProfile: {},
  route: { country: 'CA', visaaiId },
});
const field = (
  out: PrefilledFormField[],
  key: string,
): PrefilledFormField | undefined => out.find((f) => f.key === key);

describe('1. first-inviter questions read through the fill logic', () => {
  it('a family visit: the visited son is the host, so the relationship is answered', () => {
    const out = finalizeFields(
      [],
      ctx({
        family_in_destination: 'Yes',
        family_member_name: 'Ahmed Khan',
        relationship_to_family_in_destination: 'son',
      }),
    );
    expect(field(out, 'inviter_relationship')?.value).toBe('son');
  });

  it('relationship_to_inviter answers it too', () => {
    const out = finalizeFields(
      [],
      ctx({ inviter_name: 'Ahmed Khan', relationship_to_inviter: 'brother' }),
    );
    expect(field(out, 'inviter_relationship')?.value).toBe('brother');
  });

  it("the representative who is the host gives the host's email", () => {
    const out = finalizeFields(
      [],
      ctx({
        inviter_name: 'Ahmed Khan',
        representative_name: 'Ahmed Khan',
        representative_email: 'ahmed@example.com',
      }),
    );
    expect(field(out, 'inviter_email')?.value).toBe('ahmed@example.com');
  });

  it('a *_telephone_type answer counts for the phone type', () => {
    const out = finalizeFields(
      [],
      ctx({ inviter_name: 'Ahmed Khan', host_telephone_type: 'mobile' }),
    );
    expect(field(out, 'inviter_phone_type')?.value).toBe('mobile');
  });

  it('a relationship the fill cannot place shows as said, and IRCC gets none', () => {
    const p = {
      inviter_name: 'Ahmed Khan',
      relationship_to_host: 'colleague of my son',
    };
    const out = finalizeFields([], ctx(p));
    // The applicant's own words stay visible beside the four options, for
    // them to choose one; the fill never maps them to an option.
    expect(field(out, 'inviter_relationship')?.value).toBe(
      'colleague of my son',
    );
    expect(relationshipOption(p.relationship_to_host)).toBeUndefined();
  });
});

describe('2. relationship options: whole words only', () => {
  it.each([
    ['contact person', undefined],
    ['Mr Johnson', undefined],
    ['colleague of my son', undefined],
    ['friend of my daughter', undefined],
    ['schoolmate', undefined],
    ['neighbour', undefined],
    ['grandson', 'Family member'],
    ['son-in-law', 'Family member'],
    ['daughter-in-law', 'Family member'],
    ['step-son', 'Family member'],
    ['son', 'Family member'],
    ['Family member', 'Family member'],
    ['family friend', 'Friend'],
    ['Friend', 'Friend'],
    ['business partner', 'Organization'],
    ['our business partners', 'Organization'],
    ['trade conference', 'Conference'],
    ['University of Toronto', 'Organization'],
    ['my school', 'Organization'],
    ['Organization', 'Organization'],
  ])('%s → %s', (raw, want) => {
    expect(relationshipOption(raw)).toBe(want);
  });
});

describe('3. second-inviter questions: every key variant, no duplicates', () => {
  const BASE = {
    inviter_name: 'Ahmed Khan',
    inviter_relationship: 'son',
    has_second_inviter: 'Yes',
  };
  it.each([
    [
      'second_host_home_address',
      'second_inviter_address',
      '12 Main St, Milton, ON L9T 1A1',
    ],
    [
      'second_inviter_email_address',
      'second_inviter_email',
      'sara@example.com',
    ],
    ['second_host_email_address', 'second_inviter_email', 'sara@example.com'],
    ['second_host_phone_number', 'second_inviter_phone', '647-555-0101'],
    ['second_host_telephone_type', 'second_inviter_phone_type', 'cell'],
  ])('%s answers %s', (variant, key, v) => {
    const out = finalizeFields(
      [],
      ctx({ ...BASE, [variant]: v }, 'ca-super-visa'),
    );
    expect(field(out, key)?.value).toBe(v);
  });

  it('a field of the same label already on the form is not added again', () => {
    const out = finalizeFields(
      [
        {
          key: 'second_inviter_email_addr',
          label: "What is the second inviter's email address?",
          value: '',
          group: 'Host',
          source: 'profile',
        },
      ],
      ctx(BASE, 'ca-super-visa'),
    );
    expect(
      out.filter((f) => /second inviter's email/i.test(f.label)),
    ).toHaveLength(1);
  });
});
