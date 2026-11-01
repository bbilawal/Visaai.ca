/**
 * Live validation harness for the Azure Document Intelligence OCR provider —
 * closes RT-001.
 *
 * The provider's own header says it has NEVER spoken to a live Azure endpoint:
 * its polling, error and mapping paths are covered only against a mocked fetch.
 * Selecting it in production without exercising it once for real would mean
 * discovering any mismatch on a user's passport rather than in a script.
 *
 * Run it AFTER creating the Azure resource (Canada Central, for residency) and
 * BEFORE switching OCR_PROVIDER on the server:
 *
 *   cd apps/api
 *   AZURE_DOC_INTEL_ENDPOINT='https://<resource>.cognitiveservices.azure.com' \
 *   AZURE_DOC_INTEL_KEY='<key>' \
 *   npx ts-node -P tsconfig.json scripts/validate-azure-ocr.ts <signed-url-or-public-image-url>
 *
 * The URL must be reachable by Azure (a Supabase signed URL works). Use a
 * throwaway sample document, never a real applicant's.
 *
 * Exit code 0 = the provider works end to end against live Azure.
 */
import { AzureDocumentIntelligenceProvider } from '../src/modules/documents/ocr/azure-document-intelligence.provider';

async function main(): Promise<void> {
  const endpoint = process.env.AZURE_DOC_INTEL_ENDPOINT;
  const apiKey = process.env.AZURE_DOC_INTEL_KEY;
  const model = process.env.AZURE_DOC_INTEL_MODEL ?? 'prebuilt-idDocument';
  const region = process.env.AZURE_DOC_INTEL_REGION ?? 'ca-central-1';
  const url = process.argv[2];

  if (!endpoint || !apiKey) {
    console.error(
      'FAIL: set AZURE_DOC_INTEL_ENDPOINT and AZURE_DOC_INTEL_KEY in the environment.',
    );
    process.exit(2);
  }
  if (!url) {
    console.error('FAIL: pass a document URL Azure can fetch as argv[2].');
    process.exit(2);
  }

  // Mirrors the real upload allowlist: these are the types the provider claims
  // it can handle, and the ones openai currently rejects.
  const mimeType = process.env.SAMPLE_MIME ?? 'application/pdf';

  const provider = new AzureDocumentIntelligenceProvider({
    endpoint,
    apiKey,
    region,
    model,
  });

  console.log('provider     :', provider.name);
  console.log('regional     :', provider.regional);
  console.log('implemented  :', provider.capabilities.implemented);
  console.log('mimeTypes    :', provider.capabilities.mimeTypes.join(', '));
  console.log('model        :', model);
  console.log('sample mime  :', mimeType);
  console.log('--- calling live Azure ---');

  const started = Date.now();
  const res = await provider.extract({ signedUrl: url, mimeType, region });
  const ms = Date.now() - started;

  const fieldKeys = Object.keys(res.fields ?? {});
  console.log(`elapsed      : ${ms}ms`);
  console.log(`text length  : ${res.text?.length ?? 0}`);
  console.log(`field count  : ${fieldKeys.length}`);
  console.log(`field keys   : ${fieldKeys.join(', ') || '(none)'}`);

  // run_ocr marks a zero-field result as a verification failure, so an empty
  // extraction is a red flag even when the HTTP call succeeded.
  if (!res.text || res.text.length === 0) {
    console.error('FAIL: Azure returned no text — mapping path is wrong.');
    process.exit(1);
  }
  if (fieldKeys.length === 0) {
    console.error(
      'FAIL: no structured fields. run_ocr would mark this document failed. ' +
        'Check AZURE_DOC_INTEL_MODEL — prebuilt-read is text-only.',
    );
    process.exit(1);
  }

  console.log(
    '\nPASS — azure-di works against a live endpoint (RT-001 closed).',
  );
}

main().catch((err: unknown) => {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
