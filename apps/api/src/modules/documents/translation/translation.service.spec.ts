import { TranslationService } from './translation.service';
import type { AiService } from '../../shared/ai/ai.service';
import type { SupabaseService } from '../../shared/supabase/supabase.service';

function makeAi(opts: {
  available?: boolean;
  content?: string;
  completeJSON?: jest.Mock;
}) {
  const completeJSON =
    opts.completeJSON ??
    jest.fn().mockResolvedValue(opts.content ?? '{"translated_text":"Hello"}');
  return {
    ai: {
      available: opts.available ?? true,
      completeJSON,
    } as unknown as AiService,
    completeJSON,
  };
}

function makeSupabase(
  upsertResult: { error: { message: string } | null } = { error: null },
) {
  const upsert = jest.fn().mockResolvedValue(upsertResult);
  const from = jest.fn().mockReturnValue({ upsert });
  return {
    svc: { admin: { from } } as unknown as SupabaseService,
    from,
    upsert,
  };
}

const INPUT = {
  documentId: 'doc-1',
  applicationId: 'app-1',
  sourceLang: 'fr',
  rawText: 'Bonjour le monde',
};

describe('TranslationService.translateDocument', () => {
  it('translates via the metered AiService and upserts document_translations', async () => {
    const { ai, completeJSON } = makeAi({
      content: '{"translated_text":"Hello world"}',
    });
    const { svc, from, upsert } = makeSupabase();

    const res = await new TranslationService(ai, svc).translateDocument(INPUT);

    expect(res.translated).toBe(true);
    // Goes through AiService (not a raw SDK) and is metered as 'translation'.
    expect(completeJSON).toHaveBeenCalledTimes(1);
    const params = completeJSON.mock.calls[0][0];
    expect(params.json).toBe(true);
    expect(params.meta).toMatchObject({
      operation: 'translation',
      applicationId: 'app-1',
    });

    expect(from).toHaveBeenCalledWith('document_translations');
    const row = upsert.mock.calls[0][0];
    expect(row).toMatchObject({
      document_id: 'doc-1',
      application_id: 'app-1',
      source_lang: 'fr',
      target_lang: 'en',
      translated_text: 'Hello world',
    });
    expect(upsert.mock.calls[0][1]).toMatchObject({
      onConflict: 'document_id,target_lang',
    });
  });

  it('falls back to raw content when the provider returns non-JSON', async () => {
    const { ai } = makeAi({ content: 'Hello world (plain)' });
    const { svc, upsert } = makeSupabase();
    const res = await new TranslationService(ai, svc).translateDocument(INPUT);
    expect(res.translated).toBe(true);
    expect(upsert.mock.calls[0][0].translated_text).toBe('Hello world (plain)');
  });

  it('skips when no AI provider is available (no upsert)', async () => {
    const { ai, completeJSON } = makeAi({ available: false });
    const { svc, upsert } = makeSupabase();
    const res = await new TranslationService(ai, svc).translateDocument(INPUT);
    expect(res.translated).toBe(false);
    expect(completeJSON).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('skips when source language already equals target', async () => {
    const { ai, completeJSON } = makeAi({});
    const { svc } = makeSupabase();
    const res = await new TranslationService(ai, svc).translateDocument({
      ...INPUT,
      sourceLang: 'en',
    });
    expect(res.translated).toBe(false);
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it('skips empty source text', async () => {
    const { ai, completeJSON } = makeAi({});
    const { svc } = makeSupabase();
    const res = await new TranslationService(ai, svc).translateDocument({
      ...INPUT,
      rawText: '   ',
    });
    expect(res.translated).toBe(false);
    expect(completeJSON).not.toHaveBeenCalled();
  });
});
