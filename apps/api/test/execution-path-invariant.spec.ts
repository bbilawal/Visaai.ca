import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);
const norm = (p: string) => p.replace(/\\/g, '/');

/**
 * Phase 4 — static single-execution-path proof. These assertions fail the build
 * if a second EXECUTION_STARTED emit site, or an execution trigger in the
 * automation/event-bus layer, is ever introduced.
 */
describe('Execution path invariant (Phase 4 Scope A + D)', () => {
  it('has exactly ONE EXECUTION_STARTED emit site, in ExecutionService', () => {
    const emitSites = FILES.filter((f) =>
      readFileSync(f, 'utf8').includes("eventType: 'EXECUTION_STARTED'"),
    );
    expect(emitSites).toHaveLength(1);
    expect(norm(emitSites[0])).toContain(
      'modules/execution/execution.service.ts',
    );
  });

  it('the automation layer (service + gateway) never emits EXECUTION_STARTED', () => {
    const automation = FILES.filter((f) =>
      norm(f).includes('modules/automation/'),
    );
    for (const f of automation) {
      expect(readFileSync(f, 'utf8')).not.toContain(
        "eventType: 'EXECUTION_STARTED'",
      );
    }
  });

  it('the websocket gateway (event bus) cannot reach the execution choke point', () => {
    const gateway = readFileSync(
      join(SRC, 'modules/automation/automation.gateway.ts'),
      'utf8',
    );
    expect(gateway).not.toContain('ExecutionService');
    expect(gateway).not.toContain('ExecutionRequestService');
    expect(gateway).not.toContain("eventType: 'EXECUTION_STARTED'");
  });

  it('only ExecutionService (the choke point) consumes the single-use token store', () => {
    const consumers = FILES.filter((f) =>
      readFileSync(f, 'utf8').includes('EXECUTION_TOKEN_STORE'),
    )
      .map(norm)
      .filter((f) => !f.endsWith('execution-token.store.ts')) // the definition itself
      .filter((f) => !f.endsWith('execution.module.ts')); // DI binding
    expect(consumers).toEqual([
      expect.stringContaining('modules/execution/execution.service.ts'),
    ]);
  });
});

/**
 * Phase 4B — no client-side DOM-write path. Fails the build if any portal-write
 * primitive is reintroduced into the extension content script. The content
 * script is READ-ONLY (readback only); ExecutionService is the sole write path.
 */
describe('Single DOM-writer invariant (Phase 4B + 7H)', () => {
  const extFile = (f: string) =>
    readFileSync(join(SRC, '..', '..', 'extension', 'src', f), 'utf8');
  const CONTENT = extFile('content.ts');
  // Every portal-context script EXCEPT the designated executor must be write-free.
  // Phase 7H: DOM writes are allowed ONLY in executor/field-executor.ts.
  const READ_ONLY = [
    'content.ts',
    'background.ts',
    'portal-fill-executor.ts',
    'readback-engine.ts',
    'executor/readback.ts',
    'executor/safety-guards.ts',
    'executor/resolve-target.ts',
    'executor/control-actuator.ts',
  ];
  const WRITE_PRIMITIVES = [
    '.value =',
    '.checked =',
    '.files =',
    'DataTransfer',
    'dispatchEvent',
    'executeInstruction',
    'executeUpload',
    'nativeSetter',
  ];

  it('every portal-context script EXCEPT the executor is write-free', () => {
    for (const file of READ_ONLY) {
      const src = extFile(file);
      for (const forbidden of WRITE_PRIMITIVES) {
        expect(`${file}: ${src.includes(forbidden)}`).toBe(`${file}: false`);
      }
    }
  });

  it('field-executor.ts is the SOLE value writer (and has no submit/click/navigation)', () => {
    const exec = extFile('executor/field-executor.ts');
    // it is the designated writer
    expect(
      exec.includes('dispatchEvent') || exec.includes('nativeSetter'),
    ).toBe(true);
    // but never submits / clicks / navigates
    for (const forbidden of [
      '.click(',
      'submit',
      'location.href',
      'window.location',
      '.submit(',
    ]) {
      expect(`${exec.toLowerCase().includes(forbidden.toLowerCase())}`).toBe(
        'false',
      );
    }
  });

  it('backend performs no DOM writes (no event dispatch / native value injection)', () => {
    // Selector STRINGS (legacy upload mapping) + object-property `.value =` are data,
    // not DOM access. Guard only against actual DOM-write primitives in the backend.
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      for (const forbidden of [
        'dispatchEvent(',
        'nativeSetter',
        'DataTransfer',
      ]) {
        expect(`${norm(f)}: ${src.includes(forbidden)}`).toBe(
          `${norm(f)}: false`,
        );
      }
    }
  });

  it('the orchestrator has no submit / navigate path (server-side)', () => {
    const orch = readFileSync(
      join(SRC, 'modules', 'portal-fill', 'portal-fill-orchestrator.ts'),
      'utf8',
    );
    for (const forbidden of [
      'submit',
      'navigate',
      '.click(',
      'window.location',
      'location.href',
    ]) {
      expect(
        `orchestrator:${orch.toLowerCase().includes(forbidden.toLowerCase())}`,
      ).toBe('orchestrator:false');
    }
  });

  it('control-actuator.ts is the SOLE clicker, and never submits or navigates', () => {
    const files = [
      'content.ts',
      'background.ts',
      'sidepanel.ts',
      'portal-fill-executor.ts',
      'readback-engine.ts',
      'executor/field-executor.ts',
      'executor/readback.ts',
      'executor/resolve-target.ts',
      'executor/safety-guards.ts',
    ];
    for (const f of files) {
      expect(`${f}: ${extFile(f).includes('.click(')}`).toBe(`${f}: false`);
    }
    const act = extFile('executor/control-actuator.ts');
    expect(act.includes('.click(')).toBe(true);
    for (const forbidden of [
      '.submit(',
      'requestSubmit',
      'location.href',
      'window.location',
      'dispatchEvent',
      'nativeSetter',
      '.value =',
      '.checked =',
    ]) {
      expect(`actuator:${act.includes(forbidden)}`).toBe('actuator:false');
    }
    // Every click is behind a guard: radios, checkboxes, the page's add button,
    // the dialog's Save button. "Save and continue" (#next_path) is refused.
    expect(act).toContain('isSafeChoiceTarget');
    expect(act).toContain('isSafeAddButton');
    expect(act).toContain('isSafeDialogSave');
    expect(extFile('executor/safety-guards.ts')).toContain('next_path');
  });

  it('content.ts retains only read-only readback', () => {
    expect(CONTENT).toContain('readbackFields');
    expect(CONTENT).toContain('el.value'); // reads, never assigns
    expect(CONTENT).toContain('LEGACY_EXECUTION_DEPRECATED'); // legacy fill is inert
  });
});
