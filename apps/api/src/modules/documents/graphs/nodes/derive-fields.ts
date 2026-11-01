import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { DocumentState, ExtractedFields } from '../document.state';
import {
  extractionFieldsFor,
  extractionPromptFor,
  resolveExtractionType,
} from '../../ocr/extraction-schema';
import type { AiUsageMeter } from '../../../shared/ai/ai-usage.meter';
import { makeMeteringCallback } from '../../../shared/ai/metering-callback';
import {
  chatModelForTask,
  modelForTask,
} from '../../../shared/ai/model-factory';
import { safeLog } from '../../../shared/log/redact';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../../shared/ai/untrusted';
import type { ResidencyMode } from './run-ocr';

/**
 * Registry task, not a model name. `field_extraction` is exactly what this
 * node does: typed fields out of already-OCR'd text against a fixed schema.
 */
const TASK = 'field_extraction' as const;
/**
 * Cap the text sent to the model. A 40-page bank statement PDF OCRs into a lot
 * of text, and the fields we want (holder, bank, balance, period) sit in the
 * header/summary. Truncating bounds cost and latency without losing them.
 */
const MAX_TEXT_CHARS = 24_000;

/**
 * derive_fields node — vendor-agnostic structured extraction over the raw OCR
 * text.
 *
 * WHY THIS EXISTS: structured extraction differs per OCR vendor. Azure's
 * `prebuilt-idDocument` (the regional provider production must use) returns
 * identity fields ONLY, so an admission letter, a bank statement, a birth
 * certificate or a property deed produced no usable fields at all and the
 * applicant re-typed every detail by hand. Rather than couple business logic to
 * one vendor's model catalogue, this node reads the text every provider already
 * returns and extracts the per-type schema from `extraction-schema.ts`.
 *
 * It only ADDS keys — a value the OCR provider itself extracted always wins,
 * because that came from the vendor's own document model. It never overwrites,
 * never invents, and never fails the document: any error leaves `extractedFields`
 * exactly as the provider returned them.
 *
 * DATA RESIDENCY — READ BEFORE ENABLING. This pass runs on OpenAI, which is
 * NON-REGIONAL. It sends OCR text (names, passport numbers, balances,
 * addresses) to the US. `run_ocr` already refuses a non-regional OCR PROVIDER
 * under any residency mode other than 'global'; sending the same bytes here
 * would walk straight around that guard. So the gate FAILS CLOSED: under
 * 'regional' / 'jurisdiction-specific' the node is off unless an operator sets
 * OCR_DERIVE_FIELDS=on and accepts the egress. Do not "fix" a missing-fields
 * report by flipping this without that decision being made explicitly.
 */
export interface DeriveFieldsOptions {
  openaiKey?: string;
  residencyMode: ResidencyMode;
  /** OCR_DERIVE_FIELDS. 'auto' = follow residency (on only under 'global'). */
  mode?: 'auto' | 'on' | 'off';
}

/** True when this pass is allowed to ship document text out of region. */
export function deriveFieldsEnabled(
  residencyMode: ResidencyMode,
  mode: 'auto' | 'on' | 'off' = 'auto',
): boolean {
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return residencyMode === 'global';
}

export function makeDeriveFieldsNode(
  opts: DeriveFieldsOptions,
  meter?: AiUsageMeter,
) {
  const enabled = deriveFieldsEnabled(opts.residencyMode, opts.mode);
  if (!enabled && opts.openaiKey) {
    safeLog.warn(
      'documents.derive_fields',
      `disabled under DATA_RESIDENCY_MODE=${opts.residencyMode}: it would send ` +
        `document text to a non-regional provider. Set OCR_DERIVE_FIELDS=on to ` +
        `accept that egress, or extract these fields in-region instead.`,
    );
  }

  const llm =
    enabled && opts.openaiKey
      ? chatModelForTask(TASK, { apiKey: opts.openaiKey })
      : null;

  return async function deriveFields(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    if (state.error) return {};
    if (!llm) return {};

    const text = state.rawOcrText?.trim();
    if (!text) return {};

    // Nothing left to look for: the provider already returned every key this
    // document type has. Skip the call rather than spend a token on it.
    const wanted = extractionFieldsFor(state.documentType);
    const missing = wanted.filter(
      (f) => !hasValue(state.extractedFields[f.key]),
    );
    if (missing.length === 0) return {};

    try {
      // Metered per invoke, not per LLM instance: the document graph is compiled
      // once at module init and reused for every application, so the
      // applicationId can only be attached here.
      // Metered per invoke rather than by the factory: the document graph is
      // compiled once at module init and reused for every application, so the
      // applicationId is only knowable here.
      const callbacks = meter
        ? [
            makeMeteringCallback(
              meter,
              {
                operation: TASK,
                applicationId: state.applicationId,
              },
              modelForTask(TASK),
            ),
          ]
        : undefined;

      const response = await llm.invoke(
        [
          new SystemMessage(SYSTEM_PROMPT),
          new HumanMessage(buildUserPrompt(state, text)),
        ],
        callbacks ? { callbacks } : undefined,
      );

      const raw =
        typeof response.content === 'string'
          ? response.content
          : ((response.content[0] as { text?: string })?.text ?? '');

      const derived = parseFields(raw, new Set(missing.map((f) => f.key)));
      if (Object.keys(derived).length === 0) return {};

      // Provider-extracted values win; this pass only fills the gaps.
      const merged: ExtractedFields = { ...derived, ...state.extractedFields };

      return {
        extractedFields: merged,
        // run_ocr graded the document on the provider's field count alone. Now
        // that more fields are on the record the grade can only improve — an
        // upgrade, never a downgrade, so a provider that graded 'pass' keeps it.
        verificationResult: bestResult(
          state.verificationResult,
          gradeFieldCount(Object.keys(merged).length),
        ),
      };
    } catch (err) {
      // Never fail the document over an enrichment pass — the provider's own
      // fields are already in state and the pipeline continues on them.
      safeLog.warn(
        'documents.derive_fields',
        `field derivation skipped for ${state.documentId}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
      return {};
    }
  };
}

const SYSTEM_PROMPT = `You extract structured data from the text of a visa application document.

${UNTRUSTED_DATA_DIRECTIVE}

Rules:
- Use ONLY text that appears in the document. If a value is not clearly present, OMIT the key entirely.
- NEVER guess, infer, average, convert, or complete a value. A missing key is correct; a fabricated one is a defect.
- Copy names, identifiers and codes VERBATIM, in the document's own language and script. Do not translate or transliterate them.
- Dates as YYYY-MM-DD. Numbers as plain digits (no currency symbols, no thousands separators).
- Return ONLY a JSON object of key/value pairs. No prose, no markdown fences, no explanation.`;

function buildUserPrompt(state: DocumentState, text: string): string {
  const clipped =
    text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…` : text;
  const already = Object.keys(state.extractedFields).filter((k) =>
    hasValue(state.extractedFields[k]),
  );

  return `${extractionPromptFor(state.documentType)}

${
  already.length
    ? `Already extracted (do NOT return these keys again): ${already.join(', ')}`
    : ''
}

${asUntrustedData('Document text (OCR output)', clipped)}

Return the JSON object now.`;
}

/**
 * Parse and hard-filter the model's output.
 *
 * `allowed` is the set of keys still missing for this document type. Anything
 * outside it is dropped: without that gate a model is free to answer with
 * whatever key it likes, and an invented key lands in `document_verifications`
 * and then in a government form.
 */
function parseFields(raw: string, allowed: Set<string>): ExtractedFields {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const out: ExtractedFields = {};
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!allowed.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    // A model asked to omit unknowns still sometimes answers "N/A"/"unknown".
    if (!trimmed || NULLISH.has(trimmed.toLowerCase())) continue;
    out[key] = trimmed;
  }
  return out;
}

const NULLISH = new Set([
  'n/a',
  'na',
  'null',
  'none',
  'unknown',
  'not stated',
  'not specified',
  'not applicable',
  'not available',
  '-',
  '--',
]);

/** Same grading rule as `run_ocr`, kept here so the two cannot drift apart. */
function gradeFieldCount(count: number): 'pass' | 'warn' | 'fail' {
  return count >= 2 ? 'pass' : count === 1 ? 'warn' : 'fail';
}

const RESULT_RANK = { fail: 0, warn: 1, pass: 2 } as const;

function bestResult(
  a: 'pass' | 'warn' | 'fail',
  b: 'pass' | 'warn' | 'fail',
): 'pass' | 'warn' | 'fail' {
  return RESULT_RANK[a] >= RESULT_RANK[b] ? a : b;
}

function hasValue(v: string | number | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  return v.trim() !== '';
}

/** Exported for tests. */
export const __testing = { parseFields, resolveExtractionType };
