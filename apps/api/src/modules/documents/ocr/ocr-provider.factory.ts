import type { OcrProvider, OcrProviderName } from './ocr-provider.interface';
import { MockOcrProvider } from './mock-ocr.provider';
import { OpenAiOcrProvider } from './openai-ocr.provider';
import { AzureDocumentIntelligenceProvider } from './azure-document-intelligence.provider';
import { AwsTextractProvider } from './aws-textract.provider';
import { GoogleDocumentAiProvider } from './google-document-ai.provider';

export interface OcrFactoryConfig {
  provider: OcrProviderName;
  region: string;
  openaiKey?: string;
  azure?: { endpoint?: string; apiKey?: string; model?: string };
  aws?: { accessKeyId?: string; secretAccessKey?: string };
  google?: { processorId?: string; credentialsJson?: string };
}

/**
 * Resolves the configured OCR provider. Business code calls this and depends
 * only on the OcrProvider interface — adding a provider means a new class + one
 * case here, with no changes to the document pipeline.
 */
export function createOcrProvider(cfg: OcrFactoryConfig): OcrProvider {
  switch (cfg.provider) {
    case 'mock':
      return new MockOcrProvider();
    case 'openai':
      return new OpenAiOcrProvider(cfg.openaiKey ?? '');
    case 'azure-di':
      return new AzureDocumentIntelligenceProvider({
        ...cfg.azure,
        region: cfg.region,
      });
    case 'aws-textract':
      return new AwsTextractProvider({ ...cfg.aws, region: cfg.region });
    case 'google-docai':
      return new GoogleDocumentAiProvider({
        ...cfg.google,
        region: cfg.region,
      });
    default: {
      const _exhaustive: never = cfg.provider;
      throw new Error(`Unknown OCR provider: ${String(_exhaustive)}`);
    }
  }
}
