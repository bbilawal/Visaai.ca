/**
 * The visa knowledge system.
 *
 * Everything that decides an ANSWER is a pure module with no Nest context —
 * `chunking`, `rerank`, `answer-grounding`, `content-safety`, `source-policy`,
 * `mime`, `form-codes`, `version-diff`. That is deliberate: those are the
 * pieces whose correctness is a safety property, and they are testable with a
 * fixed input and a fixed expected output rather than against a live database.
 * This module only wires the I/O around them.
 *
 * THE EMBEDDING PROVIDER IS CHOSEN AT WIRE TIME, and the choice fails loudly.
 * An environment with no `OPENAI_API_KEY` gets the deterministic provider,
 * whose model id is `deterministic-hash-v1` — so a corpus embedded by it can
 * never be mistaken for a production one, and a query issued against a
 * production corpus with it simply matches nothing rather than returning
 * plausible-looking wrong results. A silent fallback to a "close enough"
 * embedding is the failure mode being designed out.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/configuration';
import { KNOWLEDGE_QUEUE } from '../shared/queue/queue.constants';
import { SupabaseModule } from '../shared/supabase/supabase.module';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { AiModule } from '../shared/ai/ai.module';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import { AuthModule } from '../auth/auth.module';

import { ExtractorRegistry } from './extract';
import {
  DeterministicEmbeddingProvider,
  EMBEDDING_PROVIDER,
  OpenAiEmbeddingProvider,
  type EmbeddingProvider,
} from './embeddings/embedding.provider';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import {
  KnowledgeAnswerService,
  CLAIM_GENERATOR,
  type ClaimGenerator,
} from './knowledge-answer.service';
import { KnowledgeFreshnessService } from './knowledge-freshness.service';
import { OpenAiClaimGenerator } from './claim-generator';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeAdminController } from './knowledge-admin.controller';
import { KnowledgeProcessor } from './knowledge.processor';
import { KnowledgeScheduler } from './knowledge.scheduler';

@Module({
  imports: [
    BullModule.registerQueue({ name: KNOWLEDGE_QUEUE }),
    SupabaseModule,
    AiModule,
    AuthModule,
  ],
  controllers: [KnowledgeController, KnowledgeAdminController],
  providers: [
    ExtractorRegistry,

    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env>): EmbeddingProvider => {
        const apiKey = config.get('OPENAI_API_KEY', { infer: true });
        // KNOWLEDGE_EMBEDDING_MODEL is read from the raw env rather than the
        // typed config so adding a model is not a config-schema change; the
        // value is validated by the provider, and an unknown model fails on
        // the first call rather than silently embedding into nothing.
        const model =
          process.env.KNOWLEDGE_EMBEDDING_MODEL ?? 'text-embedding-3-small';
        if (
          !apiKey ||
          process.env.KNOWLEDGE_EMBEDDING_PROVIDER === 'deterministic'
        ) {
          return new DeterministicEmbeddingProvider();
        }
        return new OpenAiEmbeddingProvider(apiKey, model);
      },
    },

    {
      provide: KnowledgeRetrievalService,
      inject: [SupabaseService, EMBEDDING_PROVIDER],
      useFactory: (supabase: SupabaseService, embeddings: EmbeddingProvider) =>
        // Service-role: `kb_search_hybrid` is SECURITY INVOKER and reads
        // `kb_embeddings`, which grants SELECT to no role but service_role.
        // The user's authorisation is enforced at the guard; the corpus itself
        // is public government text with nothing user-owned in it.
        new KnowledgeRetrievalService(supabase.admin, embeddings),
    },

    {
      provide: KnowledgeIngestionService,
      inject: [SupabaseService, ExtractorRegistry, EMBEDDING_PROVIDER],
      useFactory: (
        supabase: SupabaseService,
        extractors: ExtractorRegistry,
        embeddings: EmbeddingProvider,
      ) =>
        new KnowledgeIngestionService(supabase.admin, extractors, embeddings),
    },

    {
      provide: KnowledgeFreshnessService,
      inject: [SupabaseService],
      useFactory: (supabase: SupabaseService) =>
        new KnowledgeFreshnessService(supabase.admin),
    },

    {
      provide: CLAIM_GENERATOR,
      inject: [ConfigService, AiUsageMeter],
      useFactory: (config: ConfigService<Env>, meter: AiUsageMeter) =>
        new OpenAiClaimGenerator(config, meter),
    },

    {
      provide: KnowledgeAnswerService,
      inject: [SupabaseService, KnowledgeRetrievalService, CLAIM_GENERATOR],
      useFactory: (
        supabase: SupabaseService,
        retrieval: KnowledgeRetrievalService,
        generator: ClaimGenerator,
      ) => new KnowledgeAnswerService(supabase.admin, retrieval, generator),
    },

    KnowledgeProcessor,
    KnowledgeScheduler,
  ],
  exports: [
    KnowledgeRetrievalService,
    KnowledgeAnswerService,
    KnowledgeFreshnessService,
  ],
})
export class KnowledgeModule {}
