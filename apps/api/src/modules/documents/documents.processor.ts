import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import {
  buildDocumentGraph,
  CompiledDocumentGraph,
} from './graphs/document.graph';
import { createOcrProvider } from './ocr/ocr-provider.factory';
import {
  assertOcrProviderImplemented,
  unsupportedAcceptedMimeTypes,
} from './ocr/ocr-capability';
import { DOCUMENT_QUEUE } from '../shared/queue/queue.constants';
import { PrefillService } from '../prefill/prefill.service';
import { ProvenanceService } from '../provenance/provenance.service';
import { extractionFieldsFor } from './ocr/extraction-schema';
import { VerificationService } from '../verification/verification.service';
import { TranslationService } from './translation/translation.service';
import { safeLog } from '../shared/log/redact';
import { documentJobError } from './document-job-error';
import type { DocumentJob } from './documents.service';
import type { Env } from '../../config/configuration';
import type { ResidencyMode } from './graphs/nodes/run-ocr';
import type { OcrProviderName, SeedFieldInput } from '@visaai/types';

@Injectable()
// Concurrency 1 (BullMQ's default, pinned here on purpose): a burst of uploads
// is OCR'd one document at a time, so they do not hit the OCR vendor's
// per-second limit together (dry run 2026-10-14: 6 of 10 uploads got HTTP 429).
@Processor(DOCUMENT_QUEUE, { concurrency: 1 })
export class DocumentsProcessor extends WorkerHost implements OnModuleInit {
  private graph: CompiledDocumentGraph;
  // Phase 3A: captured at init so the ingestion boundary can stamp ocr_runs.
  private ocrProviderName: OcrProviderName = 'mock';
  private ocrRegion = 'global';
  private residencyMode: ResidencyMode = 'global';

  constructor(
    private supabase: SupabaseService,
    private config: ConfigService<Env>,
    private prefill: PrefillService,
    private provenance: ProvenanceService,
    private verification: VerificationService,
    private translation: TranslationService,
    private meter: AiUsageMeter,
  ) {
    super();
  }

  onModuleInit() {
    const region = this.config.get('OCR_REGION', { infer: true }) ?? 'global';
    const providerName =
      this.config.get('OCR_PROVIDER', { infer: true }) ?? 'mock';
    this.ocrProviderName = providerName;
    this.ocrRegion = region;
    const ocr = createOcrProvider({
      provider: providerName,
      region,
      openaiKey: this.config.get('OPENAI_API_KEY', { infer: true }),
      azure: {
        endpoint: this.config.get('AZURE_DOC_INTEL_ENDPOINT', { infer: true }),
        apiKey: this.config.get('AZURE_DOC_INTEL_KEY', { infer: true }),
        model: this.config.get('AZURE_DOC_INTEL_MODEL', { infer: true }),
      },
      aws: {
        accessKeyId: this.config.get('AWS_OCR_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: this.config.get('AWS_OCR_SECRET_ACCESS_KEY', {
          infer: true,
        }),
      },
      google: {
        processorId: this.config.get('GOOGLE_DOCAI_PROCESSOR_ID', {
          infer: true,
        }),
        credentialsJson: this.config.get('GOOGLE_DOCAI_CREDENTIALS', {
          infer: true,
        }),
      },
    });

    // Config-time validation (GAPS.md §5/§6): fail fast if the selected provider
    // is an unimplemented scaffold, instead of throwing per-document mid-pipeline.
    assertOcrProviderImplemented(ocr);
    // Warn (not throw) when the provider cannot OCR a type the upload boundary
    // accepts — e.g. PDFs under OCR_PROVIDER=openai. Those uploads fail fast at
    // run_ocr with a clear error; an image-only deployment is still valid.
    const unsupported = unsupportedAcceptedMimeTypes(ocr);
    if (unsupported.length) {
      safeLog.warn(
        'documents.ocr',
        `provider "${ocr.name}" cannot OCR accepted type(s): ${unsupported.join(
          ', ',
        )} — uploads of those types will be rejected at run_ocr.`,
      );
    }

    this.residencyMode =
      this.config.get('DATA_RESIDENCY_MODE', { infer: true }) ?? 'global';

    this.graph = buildDocumentGraph(
      this.supabase.admin,
      ocr,
      {
        residencyMode: this.residencyMode,
        region,
      },
      {
        // F3: baseline content scan is always mandatory; AV layer is optional.
        avProvider: this.config.get('SCAN_PROVIDER', { infer: true }) ?? 'none',
        maxBytes:
          this.config.get('MAX_UPLOAD_BYTES', { infer: true }) ??
          15 * 1024 * 1024,
      },
      this.meter,
      // derive_fields. Gated on residency: OpenAI is non-regional, so under a
      // residency mode that pins data this stays off unless the operator sets
      // OCR_DERIVE_FIELDS=on and accepts the egress.
      {
        openaiKey: this.config.get('OPENAI_API_KEY', { infer: true }),
        mode: this.config.get('OCR_DERIVE_FIELDS', { infer: true }),
      },
    );
  }

  async process(job: Job<DocumentJob>): Promise<void> {
    const { documentId, applicationId, storagePath, mimeType, documentType } =
      job.data;

    const result = await this.graph.invoke({
      documentId,
      applicationId,
      storagePath,
      mimeType,
      documentType,
      signedUrl: '',
      rawOcrText: '',
      extractedFields: {},
      verificationResult: 'pass',
      verificationDetails: [],
      allDocsProcessed: false,
      error: null,
    });

    // Surface graph errors to BullMQ: a transient one is retried per the job's
    // exponential backoff; one that would repeat on every attempt fails now.
    // ocr_status is already persisted as 'failed' by store-verification.
    if (result.error) {
      throw documentJobError(documentId, result.error, result.errorRetryable);
    }

    // Phase 3A — OCR → Provenance ingestion hook. Records the OCR run and one
    // immutable provenance version per extracted field (origin='ocr'). Best
    // effort: a provenance failure must not fail (or retry) the OCR job, and it
    // triggers NO verification/consultant/preflight/eligibility logic.
    try {
      const run = await this.provenance.recordOcrRun({
        documentId,
        applicationId,
        provider: this.ocrProviderName,
        region: this.ocrRegion,
        status: 'complete',
        rawText: result.rawOcrText,
      });

      const seeds: SeedFieldInput[] = [];
      for (const [fieldKey, value] of Object.entries(result.extractedFields)) {
        if (value === undefined || value === null) continue;
        const prov = await this.provenance.createFieldProvenance({
          applicationId,
          fieldKey,
          origin: 'ocr',
          value: value,
          sourceDocumentId: documentId,
          ocrRunId: run.id,
        });
        seeds.push({
          fieldKey,
          value: value,
          valueHash: prov.value_hash,
          sourceDocumentId: documentId,
        });
      }

      // Phase 3B — seed verification state as EXTRACTED only, bound to the
      // provenance value_hash. Idempotent (upsert ignores existing rows); no
      // transitions, no readiness/drift eval, no consultant/preflight calls.
      if (seeds.length)
        await this.verification.ensureFields(applicationId, seeds);
    } catch (err) {
      console.error(
        `[documents.processor] provenance/verification ingestion failed for ${documentId}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // A re-read that no longer yields a field its document's type cannot give
    // takes back this document's earlier word on it (a lease first read as an
    // ID card left the landlord's CNIC current, live 2026-10-19). Fields the
    // type may give are kept: a flaky read that merely missed one never
    // retires it — unless this read re-typed the document from its content,
    // when the earlier reads were made under the wrong schema and only what
    // this read gave stands. Best effort, after verification seeding.
    try {
      await this.provenance.retireDocumentFieldsExcept(applicationId, documentId, [
        ...Object.keys(result.extractedFields),
        ...(result.classifiedFromContent
          ? []
          : extractionFieldsFor(result.documentType).map((f) => f.key)),
      ]);
    } catch (err) {
      console.error(
        `[documents.processor] provenance retirement failed for ${documentId}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Once every required document is verified, auto-fill the application's
    // forms so the user can preview them without clicking "Generate". Best
    // effort — a prefill failure must not fail (or retry) the OCR job.
    try {
      await this.prefill.autoGenerateIfReady(applicationId);
    } catch (err) {
      console.error(
        `[documents.processor] auto-prefill failed for ${applicationId}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Translation for consultant review (GAPS.md §C). Best-effort and OFF the
    // OCR critical path: it runs here (post-graph) so a translation failure is
    // swallowed and never retries the OCR job. The source rawOcrText is NOT
    // overwritten — the translation is stored as a separate artifact.
    //
    // Residency gate: AiService providers (openai/anthropic/...) are non-regional.
    // Under a non-global residency mode we must NOT egress raw document content to
    // a non-regional AI vendor — the same rule run_ocr enforces. So we skip
    // auto-translation there and leave needs_translation set for an on-demand /
    // regionally-routed path.
    if (result.needsTranslation && result.detectedLanguage) {
      if (this.residencyMode !== 'global') {
        safeLog.warn(
          'documents.translation',
          `skipped auto-translation for ${documentId}: residency mode ` +
            `"${this.residencyMode}" forbids non-regional AI egress. ` +
            `needs_translation remains set for on-demand handling.`,
        );
      } else {
        try {
          await this.translation.translateDocument({
            documentId,
            applicationId,
            sourceLang: result.detectedLanguage,
            rawText: result.rawOcrText,
            targetLang: 'en',
          });
        } catch (err) {
          console.error(
            `[documents.processor] translation failed for ${documentId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  }
}
