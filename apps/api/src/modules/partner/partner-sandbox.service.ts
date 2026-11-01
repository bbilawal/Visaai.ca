import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PartnerPrincipal } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { PartnerErrors } from './partner-errors';
import { PARTNER_REPOSITORY } from './partner.tokens';
import type {
  IPartnerRepository,
  SandboxResourceRow,
} from './partner.repository';

/**
 * Sandbox data.
 *
 * The isolation guarantee is structural, not conditional: sandbox resources
 * live in their own table (`partner_sandbox_resources`), scoped by
 * application_id, and NO code path in this service can reach `applications`,
 * `documents` or any other production table. A boolean flag on the production
 * tables would have been less code and one forgotten WHERE clause away from
 * serving a real applicant's file to a test client.
 *
 * Every persona and document below is invented. There is no real personal data
 * in the sandbox by construction, so a partner exercising it cannot leak
 * anything about anybody.
 */

export const SANDBOX_PERSONAS = [
  {
    key: 'ada-straightforward',
    name: 'Ada Sandbox',
    email: 'ada@sandbox.visaai.invalid',
    description: 'Complete profile, all documents accepted, high readiness.',
    country: 'CA',
    visa_type: 'visitor',
    expected_outcome: 'ready',
  },
  {
    key: 'bo-missing-documents',
    name: 'Bo Sandbox',
    email: 'bo@sandbox.visaai.invalid',
    description: 'Two required documents missing; readiness blocked.',
    country: 'CA',
    visa_type: 'study',
    expected_outcome: 'blocked_on_documents',
  },
  {
    key: 'cai-processing',
    name: 'Cai Sandbox',
    email: 'cai@sandbox.visaai.invalid',
    description: 'Documents uploaded, OCR still running — exercises polling.',
    country: 'AU',
    visa_type: 'work',
    expected_outcome: 'processing',
  },
  {
    key: 'dee-refused',
    name: 'Dee Sandbox',
    email: 'dee@sandbox.visaai.invalid',
    description: 'Submitted and refused — exercises the unhappy terminal path.',
    country: 'GB',
    visa_type: 'visitor',
    expected_outcome: 'refused',
  },
] as const;

/** Deterministic scenarios so a partner can assert against fixed behaviour. */
const SEED_APPLICATIONS = [
  {
    persona: 'ada-straightforward',
    status: 'ready',
    vri_score: 88,
    documents: [
      {
        file_name: 'passport.pdf',
        upload_status: 'complete',
        ocr_status: 'complete',
      },
      {
        file_name: 'bank-statement.pdf',
        upload_status: 'complete',
        ocr_status: 'complete',
      },
    ],
  },
  {
    persona: 'bo-missing-documents',
    status: 'draft',
    vri_score: 41,
    documents: [
      {
        file_name: 'passport.pdf',
        upload_status: 'complete',
        ocr_status: 'complete',
      },
    ],
  },
  {
    persona: 'cai-processing',
    status: 'draft',
    vri_score: null,
    documents: [
      {
        file_name: 'passport.pdf',
        upload_status: 'complete',
        ocr_status: 'pending',
      },
      {
        file_name: 'employment-letter.pdf',
        upload_status: 'complete',
        ocr_status: 'pending',
      },
    ],
  },
  {
    persona: 'dee-refused',
    status: 'decided',
    vri_score: 55,
    documents: [
      {
        file_name: 'passport.pdf',
        upload_status: 'complete',
        ocr_status: 'complete',
      },
    ],
  },
] as const;

/** Marker resource recording that a sandbox has been seeded. */
const SEED_MARKER_TYPE = '_meta';
const SEED_MARKER_KEY = 'seed';

@Injectable()
export class PartnerSandboxService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PARTNER_REPOSITORY) private readonly repo: IPartnerRepository,
  ) {}

  private get db(): SupabaseClient {
    return this.supabase.admin;
  }

  /** Hard gate. Every public method calls this first. */
  private assertSandbox(principal: PartnerPrincipal): void {
    if (principal.environment !== 'sandbox') {
      throw PartnerErrors.environmentMismatch();
    }
  }

  /**
   * Seed on first use rather than at credential creation: most sandbox
   * applications are created and never called, and seeding those costs rows
   * for nothing.
   *
   * The "have we seeded?" question is answered by a dedicated marker row, NOT
   * by "are there any applications?". Keying it off application rows means a
   * partner who creates one before reading anything suppresses seeding
   * permanently and gets an empty sandbox with no explanation.
   */
  async ensureSeeded(principal: PartnerPrincipal): Promise<void> {
    this.assertSandbox(principal);
    const marker = await this.repo.getSandboxResource(
      this.db,
      principal.applicationId,
      SEED_MARKER_TYPE,
      SEED_MARKER_KEY,
    );
    if (marker) return;
    await this.repo.upsertSandboxResource(
      this.db,
      principal.applicationId,
      SEED_MARKER_TYPE,
      SEED_MARKER_KEY,
      {
        seeded_at: new Date().toISOString(),
        personas: SANDBOX_PERSONAS.length,
      },
    );

    for (const seed of SEED_APPLICATIONS) {
      const persona = SANDBOX_PERSONAS.find((p) => p.key === seed.persona);
      if (!persona) continue;
      const applicationId = randomUUID();
      await this.repo.upsertSandboxResource(
        this.db,
        principal.applicationId,
        'application',
        applicationId,
        {
          id: applicationId,
          persona: persona.key,
          applicant_name: persona.name,
          applicant_email: persona.email,
          country: persona.country,
          visa_type: persona.visa_type,
          status: seed.status,
          readiness_score: seed.vri_score,
          expected_outcome: persona.expected_outcome,
          created_at: new Date().toISOString(),
        },
      );
      for (const doc of seed.documents) {
        const documentId = randomUUID();
        await this.repo.upsertSandboxResource(
          this.db,
          principal.applicationId,
          'document',
          documentId,
          {
            id: documentId,
            application_id: applicationId,
            file_name: doc.file_name,
            upload_status: doc.upload_status,
            processing_status: doc.ocr_status,
            created_at: new Date().toISOString(),
          },
        );
      }
    }
  }

  async listApplications(
    principal: PartnerPrincipal,
  ): Promise<Record<string, unknown>[]> {
    await this.ensureSeeded(principal);
    const rows = await this.repo.listSandboxResources(
      this.db,
      principal.applicationId,
      'application',
    );
    return rows.map((r) => r.data);
  }

  async getApplication(
    principal: PartnerPrincipal,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    await this.ensureSeeded(principal);
    const row = await this.repo.getSandboxResource(
      this.db,
      principal.applicationId,
      'application',
      id,
    );
    return row?.data ?? null;
  }

  async createApplication(
    principal: PartnerPrincipal,
    input: { country: string; visa_type: string; applicant_reference?: string },
  ): Promise<Record<string, unknown>> {
    this.assertSandbox(principal);
    const id = randomUUID();
    const row = await this.repo.upsertSandboxResource(
      this.db,
      principal.applicationId,
      'application',
      id,
      {
        id,
        persona: 'partner-created',
        applicant_name: 'Sandbox Applicant',
        applicant_email: 'created@sandbox.visaai.invalid',
        applicant_reference: input.applicant_reference ?? null,
        country: input.country,
        visa_type: input.visa_type,
        status: 'draft',
        readiness_score: null,
        expected_outcome: 'draft',
        created_at: new Date().toISOString(),
      },
    );
    return row.data;
  }

  async listDocuments(
    principal: PartnerPrincipal,
    applicationId: string,
  ): Promise<Record<string, unknown>[]> {
    await this.ensureSeeded(principal);
    const rows = await this.repo.listSandboxResources(
      this.db,
      principal.applicationId,
      'document',
    );
    return rows
      .map((r) => r.data)
      .filter(
        (d) =>
          (d as { application_id?: string }).application_id === applicationId,
      );
  }

  /** Wipe and re-seed. The credential is untouched — only the data resets. */
  async reset(principal: PartnerPrincipal): Promise<{ deleted: number }> {
    this.assertSandbox(principal);
    const deleted = await this.repo.resetSandbox(
      this.db,
      principal.applicationId,
    );
    await this.ensureSeeded(principal);
    return { deleted };
  }

  personas(): typeof SANDBOX_PERSONAS {
    return SANDBOX_PERSONAS;
  }

  /** Exposed for the test-event endpoint. */
  async firstApplicationId(
    principal: PartnerPrincipal,
  ): Promise<string | null> {
    const rows: SandboxResourceRow[] = await this.repo.listSandboxResources(
      this.db,
      principal.applicationId,
      'application',
    );
    return rows.length > 0 ? rows[0].resource_key : null;
  }
}
