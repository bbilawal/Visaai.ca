#!/usr/bin/env node
/**
 * Generate docs/execution/MASTER_EXECUTION_STATE.json — the machine-readable
 * continuation state required by spec §0.2.
 *
 * WHY THIS IS GENERATED RATHER THAN WRITTEN
 *
 * A state file that says "tests pass, 8 pages live, working tree clean" is worth
 * exactly as much as the care taken the last time somebody edited it by hand.
 * The failure mode is not laziness, it is drift: the file keeps asserting what
 * was true at the moment it was typed, and a resuming session trusts it.
 *
 * That is the same failure this program has already hit three times — a doc
 * saying "20 sources" after the count reached 31, a checklist item marked done
 * whose evidence was a country-flag SVG, a coverage matrix that would have been
 * a claim if it were typed instead of queried. So this file measures what can be
 * measured and refuses to invent the rest.
 *
 * THE TWO HALVES, AND WHY THEY ARE KEPT APART
 *
 *   measured  — read from git, the database and the test run at generation time.
 *               Nobody types these. If a source cannot be reached, the field
 *               records the failure instead of dropping out of the file, because
 *               a missing field reads as "nothing to report".
 *
 *   asserted  — judgement that no command can produce: what the current item is,
 *               what the ordered backlog is, what blocks it, what to do next.
 *               These come from docs/execution/execution-assertions.json and are
 *               labelled as assertions in the output so a resuming session knows
 *               which half to re-verify before trusting it.
 *
 * Mixing them is what makes state files lie: an assertion sitting next to a
 * measurement inherits its authority without earning it.
 *
 * Usage:
 *   node scripts/execution/generate-master-state.mjs --docker supabase_db_VisaAI
 *   DATABASE_URL=postgres://... node scripts/execution/generate-master-state.mjs
 *   ... --run-tests     also execute the suites and record real results
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const dockerIdx = args.indexOf('--docker');
const container = dockerIdx >= 0 ? args[dockerIdx + 1] : null;
const runTests = args.includes('--run-tests');
const stampIdx = args.indexOf('--timestamp');
const timestamp = stampIdx >= 0 ? args[stampIdx + 1] : new Date().toISOString();

const REPO = process.cwd();
const OUT = 'docs/execution/MASTER_EXECUTION_STATE.json';
const ASSERTIONS = 'docs/execution/execution-assertions.json';
const SPEC = '../VisaAI_Claude_Master_Execution_Spec.md';

/** Run a command, returning its output or a structured failure. Never throws. */
function attempt(label, fn) {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    // Recorded, not swallowed: "could not measure" and "nothing to report" are
    // different states and a resuming session must be able to tell them apart.
    return { ok: false, error: `${label}: ${String(e.message ?? e).split('\n')[0]}` };
  }
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', cwd: REPO }).trim();

function measureGit() {
  const m = {};
  m.branch = attempt('branch', () => git('rev-parse', '--abbrev-ref', 'HEAD'));
  m.commit = attempt('commit', () => git('rev-parse', 'HEAD'));
  m.commit_subject = attempt('subject', () => git('log', '-1', '--pretty=%s'));
  m.commit_authored_at = attempt('authored', () => git('log', '-1', '--pretty=%aI'));
  m.worktree = attempt('status', () => {
    const dirty = git('status', '--porcelain');
    return dirty ? { clean: false, entries: dirty.split('\n') } : { clean: true, entries: [] };
  });
  m.unpushed_commits = attempt('unpushed', () => {
    const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
    return {
      upstream,
      count: Number(git('rev-list', '--count', `${upstream}..HEAD`)),
    };
  });
  m.repository_path = REPO;
  return m;
}

/**
 * The spec asks for its own revision/hash. A hash of the file is the only
 * honest answer — a version number typed into a doc is another thing that drifts.
 */
function measureSpec() {
  return attempt('spec', () => {
    if (!existsSync(SPEC)) throw new Error(`not found at ${SPEC}`);
    const body = readFileSync(SPEC);
    const sha = execFileSync('shasum', ['-a', '256', SPEC], { encoding: 'utf8' })
      .split(/\s+/)[0];
    return { path: SPEC, sha256: sha, bytes: body.length };
  });
}

const COUNTS_QUERY = `
select json_build_object(
  'countries_total',        (select count(*) from visa_countries),
  'countries_publishable',  (select count(*) from visa_countries where support_state <> 'unsupported'),
  'countries_baseline_only',(select count(*) from visa_countries where support_state = 'unsupported'),
  'visa_types_active',      (select count(*) from visa_types where lifecycle_state = 'active'),
  'requirements_active',    (select count(*) from visa_requirements where status = 'active'),
  'requirements_without_provenance',
      (select count(*) from visa_requirements
        where status = 'active' and (source_version_id is null or source_excerpt is null)),
  'publishable_pages',      (select count(*) from visa_publishable_pages),
  'sources_total',          (select count(*) from visa_sources),
  'sources_blocked',        (select count(*) from visa_sources
                              where robots_state = 'disallowed' or failure_streak >= 3),
  'last_source_check_at',   (select max(checked_at) from visa_source_checks)
)::text;
`;

/**
 * The counts differ between databases — local currently carries Finland's five
 * unpublished pages that production does not — so the TARGET is recorded next to
 * them. A count without its database is a number a resuming session will read as
 * production truth, which is how "63 pages" becomes a false claim about a system
 * that has 58.
 */
function measureData() {
  return attempt('database', () => {
    let out;
    if (container) {
      out = execFileSync(
        'docker',
        ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', COUNTS_QUERY],
        { encoding: 'utf8' },
      );
    } else if (process.env.DATABASE_URL) {
      out = execFileSync('psql', [process.env.DATABASE_URL, '-t', '-A', '-c', COUNTS_QUERY], {
        encoding: 'utf8',
      });
    } else {
      throw new Error('no --docker container and no DATABASE_URL; refusing to guess a connection');
    }
    return {
      target: container ? `docker container ${container}` : redactUrl(process.env.DATABASE_URL),
      is_production: isProductionTarget(),
      counts: JSON.parse(out.trim()),
    };
  });
}

/** Host and database only. A state file is committed; a password is not. */
function redactUrl(url) {
  try {
    const u = new URL(url);
    return `postgres://${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return 'DATABASE_URL (unparseable, redacted)';
  }
}

/**
 * Answered conservatively: anything that is not the known local container is
 * treated as UNKNOWN rather than assumed local, because the cost of mislabelling
 * production data as local is higher than the cost of an unknown.
 */
function isProductionTarget() {
  if (container) return container.includes('selfhosted') ? true : container.includes('_VisaAI') ? false : 'unknown';
  return 'unknown';
}

/**
 * Test results are only worth recording if they were produced now. A remembered
 * "3,051 passed" is the drift this file exists to prevent, so without
 * --run-tests the field says so rather than repeating the last known number.
 */
/** The commit the existing state file was generated at, if it has one. */
function priorCommit() {
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf8'));
    const c = prev?.measured?.git?.commit;
    return c?.ok ? c.value : null;
  } catch {
    return null;
  }
}

function measureTests() {
  if (!runTests) {
    // Regenerating for a routine reason — a new commit, a fresh count — must not
    // silently destroy the last real test evidence. It also must not let that
    // evidence quietly pass for current: it is carried forward with the commit
    // it was measured at, so a reader can see for themselves how far behind it
    // is rather than being told it is fine.
    const prior = existsSync(OUT)
      ? JSON.parse(readFileSync(OUT, 'utf8'))?.measured?.tests
      : null;
    if (prior?.executed || prior?.carried_forward) {
      return {
        executed: false,
        carried_forward: true,
        measured_at_commit: prior.measured_at_commit ?? priorCommit(),
        suites: prior.suites,
        note:
          'NOT run during this generation — carried forward from an earlier run. Compare ' +
          'measured_at_commit against the current commit before treating it as current.',
      };
    }
    return {
      executed: false,
      note: 'Not run during this generation. Re-run with --run-tests before trusting any pass claim.',
    };
  }

  // The script names are not symmetrical, and assuming they were cost two wrong
  // readings: `pnpm --filter web test` does not exist — web runs vitest under
  // `test:unit` — so it exited 0 having run nothing, which the first version of
  // this function would have recorded as a passing suite. A green no-op is the
  // worst possible entry in a state file.
  const suites = [
    { name: 'api', filter: 'api', script: 'test', runner: 'jest' },
    { name: 'web', filter: 'web', script: 'test:unit', runner: 'vitest' },
  ];

  const results = {};
  for (const suite of suites) {
    results[suite.name] = attempt(suite.name, () => {
      // spawnSync, not execFileSync: both runners print their summary to stderr,
      // and execFileSync hands back stdout alone on success. Reading one stream
      // is how a run with 3,051 passing tests came back with nothing to parse.
      const r = spawnSync('pnpm', ['--filter', suite.filter, suite.script], {
        encoding: 'utf8',
        cwd: REPO,
        maxBuffer: 64 * 1024 * 1024,
      });
      if (r.error) throw r.error;
      const combined = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;

      // pnpm says this when the script is absent. Silence about it is what let a
      // suite that never ran read as a suite that passed.
      if (/No script named|Command "[^"]+" not found/i.test(combined)) {
        return {
          passed: 'unknown',
          exit_code: r.status,
          summary: null,
          note: `pnpm has no "${suite.script}" script for ${suite.filter}. NOTHING RAN. This is not a pass.`,
        };
      }

      // jest:   "Tests:       3051 passed, 43 skipped, 3094 total"
      // vitest: "Tests  415 passed (415)"
      const line = combined.split('\n').find((l) => /^\s*Tests[:\s]/.test(l));
      if (!line) {
        return {
          passed: 'unknown',
          exit_code: r.status,
          summary: null,
          note: 'No summary line found in stdout or stderr. Do not read this as a pass.',
        };
      }

      const failed = Number(/(\d+)\s+failed/.exec(line)?.[1] ?? 0);
      const passedCount = Number(/(\d+)\s+passed/.exec(line)?.[1] ?? 0);
      return {
        runner: suite.runner,
        passed: failed === 0 && r.status === 0 && passedCount > 0,
        passed_count: passedCount,
        failed_count: failed,
        exit_code: r.status,
        summary: line.replace(/\s+/g, ' ').trim(),
      };
    });
  }
  return {
    executed: true,
    measured_at_commit: attempt('head', () => git('rev-parse', 'HEAD')).value ?? null,
    suites: results,
  };
}

function readAssertions() {
  if (!existsSync(ASSERTIONS)) {
    return {
      ok: false,
      error:
        `${ASSERTIONS} does not exist. The judgement half of the state — current item, ` +
        'ordered backlog, blockers, next action — cannot be measured and must be written there.',
    };
  }
  return attempt('assertions', () => JSON.parse(readFileSync(ASSERTIONS, 'utf8')));
}

const assertions = readAssertions();

const state = {
  $schema_version: 1,
  generated_at: timestamp,
  generated_by: 'scripts/execution/generate-master-state.mjs',
  how_to_read: {
    measured:
      'Read from git, the database and (when --run-tests is passed) the test suites at ' +
      'generation time. Not typed by anyone. A field carrying {"ok": false} means the ' +
      'measurement FAILED — that is not the same as a zero.',
    asserted:
      'Judgement from docs/execution/execution-assertions.json that no command can produce. ' +
      'Re-verify these against the measured half before acting on them.',
  },
  specification: measureSpec(),
  measured: {
    git: measureGit(),
    data: measureData(),
    tests: measureTests(),
  },
  asserted: assertions.ok === false ? assertions : (assertions.value ?? assertions),
};

writeFileSync(OUT, JSON.stringify(state, null, 2) + '\n');

const failures = [];
const walk = (o, path = '') => {
  if (o && typeof o === 'object') {
    if (o.ok === false && o.error) failures.push(`${path}: ${o.error}`);
    for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
  }
};
walk(state);

console.log(`Wrote ${OUT}`);
if (failures.length) {
  console.log(`\n${failures.length} measurement(s) could not be taken and are recorded as failures:`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log('\nThe state file is still valid: it reports what it could not learn rather');
  console.log('than leaving the field out, which would read as nothing to report.');
}
