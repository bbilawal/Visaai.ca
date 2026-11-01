/**
 * Grounded answer generation.
 *
 * The shape of this service is the point: the model is given retrieved
 * passages and asked for CLAIMS WITH CITATIONS, not prose. Then
 * `answer-grounding.ts` — pure, tested, model-free — decides which claims may
 * ship. The model proposes; deterministic code disposes.
 *
 * Prose-in, prose-out would make the safety property unverifiable. You cannot
 * check that a paragraph is supported by a source; you can check that a
 * sentence quoting a span is, and that the span exists in the chunk the
 * sentence cites. So the contract is per claim.
 *
 * WHAT THE MODEL NEVER SEES: the applicant's documents, profile or identity.
 * Everything in the prompt is either the question or government text. That is
 * enforced structurally — `kb_chunks.source_version_id` is NOT NULL, so a
 * chunk cannot exist unless it came from an official source — and it is why
 * this task is classified `public` in the AI task registry.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../shared/ai/untrusted';
import {
  ANSWER_DISCLAIMER,
  buildRefusal,
  verifyGrounding,
  type Claim,
  type GroundingEvidence,
} from './answer-grounding';
import {
  KnowledgeRetrievalService,
  type RetrievalFilters,
  type RetrievedChunk,
} from './knowledge-retrieval.service';

/** What a model must return. Validated before anything is trusted. */
export interface ModelClaimOutput {
  claims: Array<{
    text: string;
    citations: string[];
    quote?: string;
    modality?: 'mandatory' | 'recommended' | 'informational';
  }>;
  /** The model's own signal that the evidence does not answer the question. */
  insufficient?: boolean;
  /** Set when two cited passages contradict each other. */
  conflicting?: boolean;
}

/** The port the service calls. Keeps this class free of a model dependency. */
export interface ClaimGenerator {
  generate(input: {
    question: string;
    prompt: string;
    system: string;
  }): Promise<ModelClaimOutput>;
}

export const CLAIM_GENERATOR = Symbol('CLAIM_GENERATOR');

export interface AnswerRequest {
  question: string;
  filters?: RetrievalFilters;
  userId?: string;
  applicationId?: string;
  /** Passages to consider. More costs tokens; fewer risks missing the answer. */
  evidenceLimit?: number;
}

export interface AnswerCitation {
  claimIndex: number;
  chunkId: string;
  url: string;
  authority: string;
  title: string | null;
  pageNumber: number | null;
  headingPath: string[];
  lastCheckedAt: string | null;
  versionNumber: number | null;
  stale: boolean;
  quote?: string;
}

export interface GroundedAnswer {
  answered: boolean;
  /** The short direct answer, then supporting detail. Empty when refusing. */
  answer: string;
  refusal?: string;
  claims: Array<{ index: number; text: string; modality: string }>;
  citations: AnswerCitation[];
  disclaimer: string;
  /** Oldest `last_checked_at` across cited sources — the answer's freshness. */
  freshnessAsOf: string | null;
  anyStaleSource: boolean;
  droppedClaims: Array<{ text: string; reason: string }>;
  retrievalId?: string;
  latencyMs: number;
}

const SYSTEM_PROMPT = `You answer immigration questions using ONLY the official government passages provided.

RULES, in priority order:
1. Every claim must be supported by at least one provided passage. If the passages do not answer the question, set "insufficient": true and return no claims. Never fill a gap from general knowledge.
2. Every claim must cite the passage id(s) it comes from, and must include a "quote": a VERBATIM span copied from one cited passage. Do not paraphrase inside the quote.
3. Never state or imply that an application will be approved, is guaranteed, or has any probability of success.
4. Never give legal advice. Report what the authority published.
5. Mark each claim's modality: "mandatory" when the authority says it is required, "recommended" when the authority suggests it, "informational" otherwise. Do not upgrade a suggestion into a requirement.
6. If two passages contradict each other on the same point, set "conflicting": true and return the claims from each side separately rather than choosing.
7. Answer about the requested country and visa type only. If a passage is about a different route, do not use it.

${UNTRUSTED_DATA_DIRECTIVE}

Return JSON: {"claims":[{"text":"...","citations":["<passage id>"],"quote":"...","modality":"mandatory|recommended|informational"}],"insufficient":false,"conflicting":false}`;

@Injectable()
export class KnowledgeAnswerService {
  private readonly log = new Logger(KnowledgeAnswerService.name);

  constructor(
    private readonly db: SupabaseClient,
    private readonly retrieval: KnowledgeRetrievalService,
    private readonly generator: ClaimGenerator,
  ) {}

  async answer(req: AnswerRequest): Promise<GroundedAnswer> {
    const startedAt = Date.now();
    const filters = req.filters ?? {};

    const retrieved = await this.retrieval.search(req.question, filters, {
      limit: req.evidenceLimit ?? 10,
      userId: req.userId,
      applicationId: req.applicationId,
    });

    if (retrieved.chunks.length === 0) {
      return this.refuse(
        req,
        retrieved.retrievalId,
        'no_evidence',
        startedAt,
        filters,
      );
    }

    // Only CURRENT passages go to the model. Superseded text is retrievable
    // for history and diffing, but a model given both will happily blend them,
    // and the blend reads as current.
    const current = retrieved.chunks.filter((c) => c.status === 'current');
    if (current.length === 0) {
      await this.markOutcome(retrieved.retrievalId, 'insufficient_evidence');
      return this.refuse(
        req,
        retrieved.retrievalId,
        'stale_only',
        startedAt,
        filters,
      );
    }

    const prompt = this.buildPrompt(req.question, current);

    let output: ModelClaimOutput;
    try {
      output = await this.generator.generate({
        question: req.question,
        prompt,
        system: SYSTEM_PROMPT,
      });
    } catch (err) {
      this.log.error(
        `claim generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.markOutcome(retrieved.retrievalId, 'error');
      return this.refuse(
        req,
        retrieved.retrievalId,
        'no_evidence',
        startedAt,
        filters,
      );
    }

    if (output.insufficient || output.claims.length === 0) {
      await this.markOutcome(retrieved.retrievalId, 'insufficient_evidence');
      return this.refuse(
        req,
        retrieved.retrievalId,
        output.conflicting ? 'conflicting' : 'insufficient_evidence',
        startedAt,
        filters,
      );
    }

    const claims: Claim[] = output.claims.map((c, i) => ({
      index: i,
      text: c.text.trim(),
      citedChunkIds: c.citations.filter((id) => typeof id === 'string'),
      supportingQuote: c.quote,
      modality: c.modality ?? 'informational',
    }));

    const evidence: GroundingEvidence[] = current.map((c) => ({
      chunkId: c.chunkId,
      text: c.text,
      countryId: c.countryId,
      visaTypeId: c.visaTypeId,
      status: c.status,
      authorityRank: c.authorityRank,
    }));

    const verdict = verifyGrounding(claims, evidence, {
      expectedCountryId: filters.countryId,
      expectedVisaTypeId: filters.visaTypeId,
      allowSuperseded: false,
    });

    if (verdict.mustRefuse) {
      this.log.warn(
        `all ${claims.length} claim(s) rejected by grounding: ` +
          verdict.rejected.map((r) => r.reason).join('; '),
      );
      await this.markOutcome(retrieved.retrievalId, 'insufficient_evidence');
      const refusal = this.refuse(
        req,
        retrieved.retrievalId,
        'insufficient_evidence',
        startedAt,
        filters,
      );
      refusal.droppedClaims = verdict.rejected.map((r) => ({
        text: r.claim.text,
        reason: r.reason,
      }));
      return refusal;
    }

    const byId = new Map(current.map((c) => [c.chunkId, c]));
    const citations: AnswerCitation[] = [];
    for (const claim of verdict.accepted) {
      for (const chunkId of claim.citedChunkIds) {
        const chunk = byId.get(chunkId);
        if (!chunk?.citation) continue;
        citations.push({
          claimIndex: claim.index,
          chunkId,
          url: chunk.citation.url,
          authority: chunk.citation.authority,
          title: chunk.citation.title,
          pageNumber: chunk.citation.pageNumber,
          headingPath: chunk.headingPath,
          lastCheckedAt: chunk.citation.lastCheckedAt,
          versionNumber: chunk.citation.versionNumber,
          stale: chunk.citation.stale,
          quote: claim.supportingQuote,
        });
      }
    }

    await this.persistCitations(
      retrieved.retrievalId,
      verdict.accepted,
      citations,
      byId,
    );

    // Mandatory first, then recommended, then informational: short direct
    // answer first, supporting detail after, as the spec requires.
    const ordered = [...verdict.accepted].sort(
      (a, b) =>
        modalityRank(a.modality) - modalityRank(b.modality) ||
        a.index - b.index,
    );

    const freshness =
      citations
        .map((c) => c.lastCheckedAt)
        .filter((d): d is string => Boolean(d))
        .sort()[0] ?? null;

    return {
      answered: true,
      answer: this.renderAnswer(ordered, output.conflicting ?? false),
      claims: ordered.map((c) => ({
        index: c.index,
        text: c.text,
        modality: c.modality,
      })),
      citations,
      disclaimer: ANSWER_DISCLAIMER,
      freshnessAsOf: freshness,
      anyStaleSource: citations.some((c) => c.stale),
      droppedClaims: verdict.rejected.map((r) => ({
        text: r.claim.text,
        reason: r.reason,
      })),
      retrievalId: retrieved.retrievalId,
      latencyMs: Date.now() - startedAt,
    };
  }

  /**
   * Build the evidence block.
   *
   * Every passage is fenced with `asUntrustedData` and carries a short id the
   * model cites. The id is `P1`, `P2`… rather than the chunk uuid: a uuid is
   * 36 tokens of noise the model must copy exactly, and it copies short ids
   * reliably where it truncates uuids. The mapping back is done here.
   */
  buildPrompt(question: string, chunks: RetrievedChunk[]): string {
    const blocks = chunks.map((c, i) => {
      const label = [
        c.citation?.authority ?? 'official source',
        c.citation?.countryName,
        c.citation?.visaTypeName,
        c.headingPath.join(' > ') || undefined,
        c.pageNumber ? `page ${c.pageNumber}` : undefined,
      ]
        .filter(Boolean)
        .join(' — ');
      return `[${c.chunkId}] ${label}\n${asUntrustedData(`passage ${i + 1}`, c.text)}`;
    });

    return [
      `QUESTION: ${question}`,
      '',
      'OFFICIAL PASSAGES. Cite by the bracketed id exactly as written.',
      '',
      ...blocks,
    ].join('\n');
  }

  private renderAnswer(claims: Claim[], conflicting: boolean): string {
    const lines: string[] = [];
    if (conflicting) {
      lines.push(
        'The official sources do not agree on this. Both positions are shown with their sources.',
        '',
      );
    }
    const mandatory = claims.filter((c) => c.modality === 'mandatory');
    const recommended = claims.filter((c) => c.modality === 'recommended');
    const info = claims.filter((c) => c.modality === 'informational');

    if (mandatory.length) {
      lines.push('Required by the authority:');
      for (const c of mandatory) lines.push(`• ${c.text}`);
    }
    if (recommended.length) {
      if (lines.length) lines.push('');
      lines.push('Recommended by the authority (not mandatory):');
      for (const c of recommended) lines.push(`• ${c.text}`);
    }
    if (info.length) {
      if (lines.length) lines.push('');
      for (const c of info) lines.push(c.text);
    }
    return lines.join('\n');
  }

  private refuse(
    req: AnswerRequest,
    retrievalId: string | undefined,
    reason:
      | 'no_evidence'
      | 'insufficient_evidence'
      | 'conflicting'
      | 'stale_only',
    startedAt: number,
    filters: RetrievalFilters,
  ): GroundedAnswer {
    return {
      answered: false,
      answer: '',
      refusal: buildRefusal({
        question: req.question,
        countryName: (filters as { countryName?: string }).countryName,
        visaTypeName: (filters as { visaTypeName?: string }).visaTypeName,
        officialUrl: (filters as { officialUrl?: string }).officialUrl,
        reason,
      }),
      claims: [],
      citations: [],
      disclaimer: ANSWER_DISCLAIMER,
      freshnessAsOf: null,
      anyStaleSource: false,
      droppedClaims: [],
      retrievalId,
      latencyMs: Date.now() - startedAt,
    };
  }

  private async markOutcome(
    retrievalId: string | undefined,
    outcome: 'answered' | 'insufficient_evidence' | 'conflicting' | 'error',
  ): Promise<void> {
    if (!retrievalId) return;
    await this.db
      .from('kb_retrieval_logs')
      .update({ outcome })
      .eq('id', retrievalId);
  }

  private async persistCitations(
    retrievalId: string | undefined,
    claims: Claim[],
    citations: AnswerCitation[],
    byId: Map<string, RetrievedChunk>,
  ): Promise<void> {
    if (!retrievalId || citations.length === 0) return;
    const claimText = new Map(claims.map((c) => [c.index, c.text]));

    // flatMap rather than map+filter(Boolean): `filter(Boolean)` does not
    // narrow the type, so the null branch survives into the insert payload and
    // the compiler is right to object.
    const rows = citations.flatMap((c) => {
      const chunk = byId.get(c.chunkId);
      if (!chunk) return [];
      return [
        {
          retrieval_id: retrievalId,
          chunk_id: c.chunkId,
          source_version_id: chunk.sourceVersionId,
          claim_index: c.claimIndex,
          claim_text: (claimText.get(c.claimIndex) ?? '').slice(0, 2000),
          supporting_quote: c.quote?.slice(0, 2000) ?? null,
          citation_url: c.url,
          authority: c.authority,
          page_number: c.pageNumber,
          last_checked_at: c.lastCheckedAt,
        },
      ];
    });

    const { error } = await this.db.from('kb_answer_citations').insert(rows);
    if (error) this.log.warn(`citation persist failed: ${error.message}`);
  }
}

function modalityRank(m: string): number {
  return m === 'mandatory' ? 0 : m === 'recommended' ? 1 : 2;
}
