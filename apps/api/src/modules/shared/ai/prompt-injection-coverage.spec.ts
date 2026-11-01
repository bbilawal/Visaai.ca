import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AI-001 coverage guard.
 *
 * The fence in `untrusted.ts` was built, documented, and then applied to
 * exactly ONE of seven prompt sites. Six others — including the two most
 * attacker-controllable paths, the raw OCR text of an uploaded PDF and the
 * document data that becomes a government form — interpolated untrusted
 * content straight into a prompt with no delimiting and no directive.
 *
 * A defence nobody applies is not a defence, and the gap was invisible because
 * nothing asserted the connection. This walks the source and fails when a new
 * prompt site appears without it, so the next one cannot be forgotten the same
 * way.
 */
const MODULES_DIR = join(__dirname, '..', '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
      out.push(full);
  }
  return out;
}

/**
 * Files that actually SEND a prompt to a model.
 *
 * Constructing message objects is not enough to qualify: `checkpoint.service.ts`
 * builds SystemMessage/HumanMessage instances to rehydrate persisted LangGraph
 * state and never talks to a model, so requiring a fence there would be noise.
 * The discriminator is the call, not the import.
 *
 * TWO SHAPES, because matching only the first hid three real gaps.
 *
 * The original filter required `new SystemMessage(` AND `new HumanMessage(`
 * AND `.invoke(` — the LangChain shape. Every prompt site that goes through
 * `AiService.completeJSON({ system, user })` instead was therefore invisible to
 * this guard, and all three of them turned out to be unfenced:
 * consultant/ai-review-assistant.service.ts, messaging/messaging-ai.service.ts
 * and voice/voice-orchestration.service.ts. A coverage test that cannot see a
 * whole calling convention is worse than no coverage test, because it reports
 * green over the gap.
 */
const LANGCHAIN_SITES = walk(MODULES_DIR).filter((f) => {
  const src = readFileSync(f, 'utf8');
  return (
    src.includes('new SystemMessage(') &&
    src.includes('new HumanMessage(') &&
    /\.invoke\(/.test(src)
  );
});

/** The AiService shape: `completeJSON({ system, user })`. */
const GATEWAY_SITES = walk(MODULES_DIR).filter((f) => {
  const src = readFileSync(f, 'utf8');
  return /\.completeJSON\(\s*\{/.test(src) && !f.includes('/shared/ai/');
});

const PROMPT_SITES = [...new Set([...LANGCHAIN_SITES, ...GATEWAY_SITES])];

describe('prompt-injection coverage (AI-001)', () => {
  it('finds the known prompt sites', () => {
    // Sanity: if this drops to zero the walk is broken and every assertion
    // below would vacuously pass.
    expect(PROMPT_SITES.length).toBeGreaterThanOrEqual(6);
    // Both calling conventions must be represented. If GATEWAY_SITES were
    // empty the regex has drifted and three sites go unchecked again.
    expect(LANGCHAIN_SITES.length).toBeGreaterThan(0);
    expect(GATEWAY_SITES.length).toBeGreaterThan(0);
  });

  it.each(PROMPT_SITES.map((f) => [f.split('/modules/')[1], f]))(
    '%s pairs untrusted interpolation with the directive',
    (_label, file) => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('UNTRUSTED_DATA_DIRECTIVE');
      expect(src).toContain('asUntrustedData');
    },
  );

  it('no prompt site JSON.stringifies a profile straight into a template', () => {
    // The original defect shape: `${JSON.stringify(state.context.profile)}`
    // inline in a prompt string, with nothing telling the model it is data.
    for (const file of PROMPT_SITES) {
      const src = readFileSync(file, 'utf8');
      const raw =
        /\$\{JSON\.stringify\([^)]*(profile|documentFields|draft)[^)]*\)\}/.exec(
          src,
        );
      expect(
        raw ? `${file.split('/modules/')[1]}: ${raw[0]}` : null,
      ).toBeNull();
    }
  });

  // SEC-6005: the `new SystemMessage(`/`new HumanMessage(` walk above is blind
  // to the other prompt-call shapes in this codebase — plain `{ role: 'system'
  // }` message arrays, `chat.completions.parse(...)`, and `ai.completeJSON(...)`
  // — which is exactly where the fenced-but-forgotten sites lived (SEC-6001..4).
  // These carry attacker-controllable applicant/OCR text and must keep the
  // fence. Referenced by path so a rename fails loudly rather than silently
  // dropping coverage.
  const REQUIRED_FENCED_SITES = [
    'vri/graphs/nodes/suggest-visa-categories.ts',
    'documents/translation/translation.service.ts',
    'visa/visa.agents.ts',
    'intake/graphs/nodes/update-checklist.ts',
  ];

  it.each(REQUIRED_FENCED_SITES)(
    '%s (non-LangChain prompt shape) pairs untrusted data with the directive',
    (rel) => {
      const src = readFileSync(join(MODULES_DIR, rel), 'utf8');
      expect(src).toContain('UNTRUSTED_DATA_DIRECTIVE');
      expect(src).toContain('asUntrustedData');
    },
  );
});
