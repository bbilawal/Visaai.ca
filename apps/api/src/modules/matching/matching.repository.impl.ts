import { Injectable } from '@nestjs/common';
import type { MatchRequest } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { MatchCandidate } from './matching.engine';
import type { IMatchingRepository, MatchContext } from './matching.repository';

/** PostgREST returns embeds as array (to-many) or object (to-one) — normalize. */
function one<T>(embed: unknown): T | null {
  if (Array.isArray(embed)) return (embed[0] as T) ?? null;
  return (embed as T) ?? null;
}

/**
 * Matching reads aggregate marketplace + application data to COMPUTE rankings
 * (it returns only scores, never another consultant's PII). Uses the service-role
 * client like pricing/commission; the service authorizes the caller and the
 * application context explicitly.
 */
@Injectable()
export class MatchingRepository implements IMatchingRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getMatchContext(applicationId: string): Promise<MatchContext | null> {
    const { data: app, error } = await this.supabase.admin
      .from('applications')
      .select(
        'id, user_id, destination_country, vri_score, country_frameworks(visa_type)',
      )
      .eq('id', applicationId)
      .maybeSingle();
    if (error) throw error;
    if (!app) return null;

    const framework = one<{ visa_type: string | null }>(
      (app as Record<string, unknown>).country_frameworks,
    );

    const userId = String((app as Record<string, unknown>).user_id);
    const { data: user } = await this.supabase.admin
      .from('users')
      .select('preferred_language')
      .eq('id', userId)
      .maybeSingle();

    const vri = (app as Record<string, unknown>).vri_score;
    // complexity proxy: lower readiness (VRI) => higher complexity. Null if unscored.
    const complexity =
      vri == null ? null : Math.round((1 - Number(vri) / 100) * 100) / 100;

    const request: MatchRequest = {
      visa_type: framework?.visa_type ?? null,
      destination_country:
        ((app as Record<string, unknown>).destination_country as
          | string
          | null) ?? null,
      user_language:
        (user as { preferred_language?: string | null } | null)
          ?.preferred_language ?? null,
      complexity_score: complexity,
    };
    return { ownerUserId: userId, request };
  }

  async listActiveCandidates(): Promise<MatchCandidate[]> {
    const { data, error } = await this.supabase.admin
      .from('consultant_profiles')
      .select(
        'id, user_id, rating_avg, rating_count, hourly_rate_usd, years_experience, max_active_cases, license_verified, consultant_skills(visa_types,languages,countries_supported), consultant_availability(accepting_new,max_cases)',
      )
      .eq('active_status', 'active');
    if (error) throw error;

    // Live active-case load per consultant user (consultant_assignments keys on users.id).
    const { data: asg, error: aErr } = await this.supabase.admin
      .from('consultant_assignments')
      .select('consultant_id')
      .eq('status', 'active');
    if (aErr) throw aErr;
    const load = new Map<string, number>();
    for (const r of asg ?? []) {
      const id = String(r.consultant_id);
      load.set(id, (load.get(id) ?? 0) + 1);
    }

    return (data ?? []).map((p) => {
      const r = p as Record<string, unknown>;
      const skills = one<{
        visa_types: string[];
        languages: string[];
        countries_supported: string[];
      }>(r.consultant_skills);
      const avail = one<{ accepting_new: boolean; max_cases: number }>(
        r.consultant_availability,
      );
      return {
        consultant_id: String(r.id),
        rating_avg: Number(r.rating_avg ?? 0),
        rating_count: Number(r.rating_count ?? 0),
        hourly_rate_usd:
          r.hourly_rate_usd == null ? null : Number(r.hourly_rate_usd),
        years_experience:
          r.years_experience == null ? null : Number(r.years_experience),
        max_active_cases: Number(r.max_active_cases ?? 0),
        license_verified: Boolean(r.license_verified),
        active_cases: load.get(String(r.user_id)) ?? 0,
        accepting_new: avail?.accepting_new ?? true,
        visa_types: skills?.visa_types ?? [],
        languages: skills?.languages ?? [],
        countries_supported: skills?.countries_supported ?? [],
      };
    });
  }

  async getVisaLawyerFlag(visaType: string | null): Promise<boolean> {
    if (!visaType) return false;
    const { data, error } = await this.supabase.admin
      .from('pricing_visa_tiers')
      .select('lawyer_flag')
      .eq('visa_type', visaType)
      .maybeSingle();
    if (error) throw error;
    return Boolean((data as { lawyer_flag?: boolean } | null)?.lawyer_flag);
  }
}
