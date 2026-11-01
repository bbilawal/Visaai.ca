import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { NarrativeService } from './narrative.service';
import type { SupabaseService } from '../shared/supabase/supabase.service';
import type { AiUsageMeter } from '../shared/ai/ai-usage.meter';

/**
 * Generate refuses a letter the route does not use (dry run 2026-10-16: an
 * eTA was offered an LOE, itinerary and cover letter).
 */
function db(visaaiId: string) {
  const b: any = {
    select: () => b,
    eq: () => b,
    single: () =>
      Promise.resolve({
        data: {
          id: 'app-1',
          destination_country: 'CA',
          visa_types: { visaai_id: visaaiId },
        },
        error: null,
      }),
  };
  return { from: () => b } as any;
}

describe('NarrativeService.generate — route letters', () => {
  const service = new NarrativeService(
    {} as SupabaseService,
    { get: () => 'k' } as unknown as ConfigService<any>,
    {} as AiUsageMeter,
  );

  it.each(['loe', 'itinerary', 'cover_letter'] as const)(
    'refuses a %s for an eTA',
    async (docType) => {
      const err = await service
        .generate(
          db('ca-electronic-travel-authorization-eta'),
          'app-1',
          'u',
          docType,
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(String((err as Error).message)).toMatch(/eTA|letter/i);
    },
  );
});
