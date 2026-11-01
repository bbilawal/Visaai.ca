import type { DocumentRequirement } from '../types';

/**
 * Reusable document definitions shared across countries/programs. Countries
 * compose from these and add their own (e.g. a specific government form).
 */
export const COMMON_DOCS: Record<string, DocumentRequirement> = {
  passport: {
    code: 'passport',
    label: 'Passport (bio page)',
    required: true,
    ownedBy: 'applicant',
    acceptedMimeTypes: ['image/png', 'image/jpeg', 'application/pdf'],
  },
  photo: {
    code: 'photo',
    label: 'Passport-style photo',
    required: true,
    ownedBy: 'applicant',
    acceptedMimeTypes: ['image/png', 'image/jpeg'],
  },
  proof_of_funds: {
    code: 'proof_of_funds',
    label: 'Proof of funds / bank statements',
    required: true,
    ownedBy: 'applicant',
  },
  employment_letter: {
    code: 'employment_letter',
    label: 'Employment letter',
    required: false,
    ownedBy: 'applicant',
  },
  travel_itinerary: {
    code: 'travel_itinerary',
    label: 'Travel itinerary',
    required: false,
    ownedBy: 'applicant',
  },
  invitation_letter: {
    code: 'invitation_letter',
    label: 'Letter of invitation',
    required: false,
    ownedBy: 'sponsor',
  },
  proof_of_relationship: {
    code: 'proof_of_relationship',
    label: 'Proof of relationship',
    required: false,
    ownedBy: 'sponsor',
  },
  proof_of_status: {
    code: 'proof_of_status',
    label: "Sponsor's proof of status/residency",
    required: false,
    ownedBy: 'sponsor',
  },
  medical_insurance: {
    code: 'medical_insurance',
    label: 'Medical insurance',
    required: false,
    ownedBy: 'applicant',
  },
  admission_letter: {
    code: 'admission_letter',
    label: 'School admission / enrolment letter',
    required: true,
    ownedBy: 'applicant',
  },
};

export function docs(
  ...codes: (keyof typeof COMMON_DOCS)[]
): DocumentRequirement[] {
  return codes.map((c) => COMMON_DOCS[c]);
}
