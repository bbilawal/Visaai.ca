import { StateGraph, END } from '@langchain/langgraph';
import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentAnnotation } from './document.state';
import { makeFetchDocumentNode } from './nodes/fetch-document';
import { makeScanDocumentNode, type ScanOptions } from './nodes/scan-document';
import { makeRunOcrNode, type OcrOptions } from './nodes/run-ocr';
import { makeDeriveFieldsNode } from './nodes/derive-fields';
import type { AiUsageMeter } from '../../shared/ai/ai-usage.meter';
import { makeDetectLanguageNode } from './nodes/detect-language';
import { makeClassifyDocumentNode } from './nodes/classify-document.node';
import { makeDetectDuplicateNode } from './nodes/detect-duplicate';
import { makeStoreVerificationNode } from './nodes/store-verification';
import { makeEvaluateExpiryNode } from './nodes/evaluate-expiry';
import {
  makeCheckDocsReadyNode,
  docsReadyRouter,
} from './nodes/check-docs-ready';
import { makeRunCrossVerificationNode } from './nodes/run-cross-verification';
import { makeSyncChecklistNode } from './nodes/sync-checklist';
import { makeSyncProfileNode } from './nodes/sync-profile';
import type { OcrProvider } from '../ocr/ocr-provider.interface';

export function buildDocumentGraph(
  supabase: SupabaseClient,
  ocr: OcrProvider,
  ocrOpts: OcrOptions,
  scanOpts: ScanOptions,
  meter?: AiUsageMeter,
  /**
   * `derive_fields` enrichment pass. Without a key — or under a residency mode
   * that pins data, unless the operator opted in — the node is a no-op and the
   * pipeline runs exactly as before on provider-extracted fields alone.
   */
  derive?: { openaiKey?: string; mode?: 'auto' | 'on' | 'off' },
) {
  const graph = new StateGraph(DocumentAnnotation)
    .addNode('fetch_document', makeFetchDocumentNode(supabase))
    // F3: malware scan-gate before any processing.
    .addNode('scan_document', makeScanDocumentNode(scanOpts))
    // Vendor-agnostic OCR provider (region-aware, residency-guarded).
    .addNode('run_ocr', makeRunOcrNode(ocr, ocrOpts, meter))
    // Vendor-agnostic gap-fill over the OCR text: extracts the per-type schema
    // (admission letter, deed, birth certificate, …) that an identity-only
    // provider model cannot return. Additive — never overwrites provider fields.
    .addNode(
      'derive_fields',
      makeDeriveFieldsNode(
        {
          openaiKey: derive?.openaiKey,
          mode: derive?.mode,
          residencyMode: ocrOpts.residencyMode,
        },
        meter,
      ),
    )
    // Re-type a generic upload from its OCR text (IRCC letter, national ID,
    // insurance, …) and drop/correct identity fields it cannot vouch for —
    // before anything stores, dedups or cross-checks them.
    .addNode('classify_document', makeClassifyDocumentNode(supabase))
    // C: language detection (sets needs_translation). Cheap/heuristic — no AI.
    .addNode('detect_language', makeDetectLanguageNode())
    // A: duplicate detection (reads back content/identity hashes).
    .addNode('detect_duplicate', makeDetectDuplicateNode(supabase))
    .addNode('store_verification', makeStoreVerificationNode(supabase))
    // B: type/travel-date aware expiry evaluation (was inline in store_verification).
    .addNode('evaluate_expiry', makeEvaluateExpiryNode(supabase))
    .addNode('check_docs_ready', makeCheckDocsReadyNode(supabase))
    .addNode('run_cross_verification', makeRunCrossVerificationNode(supabase))
    .addNode('sync_checklist', makeSyncChecklistNode(supabase))
    // Fold what the document told us back into the applicant profile, so the
    // intake chat stops asking for facts already sitting in the database.
    // Gap-fill only: a value the applicant supplied is never overwritten.
    .addNode('sync_profile', makeSyncProfileNode(supabase))
    .addEdge('__start__', 'fetch_document')
    .addEdge('fetch_document', 'scan_document')
    .addEdge('scan_document', 'run_ocr')
    .addEdge('run_ocr', 'derive_fields')
    .addEdge('derive_fields', 'classify_document')
    .addEdge('classify_document', 'detect_language')
    .addEdge('detect_language', 'detect_duplicate')
    .addEdge('detect_duplicate', 'store_verification')
    .addEdge('store_verification', 'evaluate_expiry')
    .addEdge('evaluate_expiry', 'check_docs_ready')
    .addConditionalEdges('check_docs_ready', docsReadyRouter, {
      run_cross_verification: 'run_cross_verification',
      __end__: 'sync_checklist',
    })
    .addEdge('run_cross_verification', 'sync_checklist')
    .addEdge('sync_checklist', 'sync_profile')
    .addEdge('sync_profile', END);

  return graph.compile();
}

export type CompiledDocumentGraph = ReturnType<typeof buildDocumentGraph>;
