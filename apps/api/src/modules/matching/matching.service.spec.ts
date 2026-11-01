import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { MatchRequest } from '@visaai/types';
import { MatchingService } from './matching.service';
import type { MatchCandidate } from './matching.engine';
import type { IMatchingRepository, MatchContext } from './matching.repository';

const REQUEST: MatchRequest = {
  visa_type: 'student',
  destination_country: 'CA',
  user_language: 'en',
  complexity_score: 0.2,
};
const CTX: MatchContext = { ownerUserId: 'owner-1', request: REQUEST };

function cand(p: Partial<MatchCandidate>): MatchCandidate {
  return {
    consultant_id: p.consultant_id ?? 'c1',
    rating_avg: p.rating_avg ?? 4,
    rating_count: p.rating_count ?? 5,
    hourly_rate_usd: p.hourly_rate_usd ?? 100,
    years_experience: p.years_experience ?? 5,
    max_active_cases: p.max_active_cases ?? 10,
    license_verified: p.license_verified ?? true,
    active_cases: p.active_cases ?? 0,
    accepting_new: p.accepting_new ?? true,
    visa_types: p.visa_types ?? ['student'],
    languages: p.languages ?? ['en'],
    countries_supported: p.countries_supported ?? ['CA'],
  };
}

function makeRepo(
  over: Partial<IMatchingRepository> = {},
): IMatchingRepository {
  const notImpl = (n: string) => () => {
    throw new Error(`unexpected repo call: ${n}`);
  };
  return {
    getMatchContext: notImpl('getMatchContext'),
    listActiveCandidates: notImpl('listActiveCandidates'),
    getVisaLawyerFlag: notImpl('getVisaLawyerFlag'),
    ...over,
  };
}

describe('MatchingService', () => {
  it('404s when the application does not exist', async () => {
    const svc = new MatchingService(
      makeRepo({ getMatchContext: jest.fn().mockResolvedValue(null) }),
    );
    await expect(
      svc.rank('nope', { id: 'u', appRole: 'admin' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('forbids an applicant from matching someone else’s application', async () => {
    const svc = new MatchingService(
      makeRepo({ getMatchContext: jest.fn().mockResolvedValue(CTX) }),
    );
    await expect(
      svc.rank('app-1', { id: 'other', appRole: 'user' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the owner match their own application', async () => {
    const svc = new MatchingService(
      makeRepo({
        getMatchContext: jest.fn().mockResolvedValue(CTX),
        listActiveCandidates: jest
          .fn()
          .mockResolvedValue([cand({ consultant_id: 'c1' })]),
        getVisaLawyerFlag: jest.fn().mockResolvedValue(false),
      }),
    );
    const out = await svc.rank('app-1', { id: 'owner-1', appRole: 'user' });
    expect(out.request).toEqual(REQUEST);
    expect(out.candidates[0].consultant_id).toBe('c1');
    expect(out.candidates[0].rank).toBe(1);
  });

  it('ranks + limits for staff, passing the visa lawyer-flag through', async () => {
    const getVisaLawyerFlag = jest.fn().mockResolvedValue(true);
    const svc = new MatchingService(
      makeRepo({
        getMatchContext: jest.fn().mockResolvedValue(CTX),
        getVisaLawyerFlag,
        listActiveCandidates: jest.fn().mockResolvedValue([
          cand({
            consultant_id: 'licensed',
            license_verified: true,
            rating_avg: 5,
          }),
          cand({
            consultant_id: 'unlicensed',
            license_verified: false,
            rating_avg: 5,
          }),
        ]),
      }),
    );
    const out = await svc.rank('app-1', { id: 'admin', appRole: 'admin' }, 1);
    expect(getVisaLawyerFlag).toHaveBeenCalledWith('student');
    expect(out.candidates).toHaveLength(1);
    // licensed outranks unlicensed on a lawyer-flagged visa
    expect(out.candidates[0].consultant_id).toBe('licensed');
  });
});
