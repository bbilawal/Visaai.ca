import { buildIntakeGraph } from '../src/modules/intake/graphs/intake.graph';

/**
 * The wiring guard for the turn's latency.
 *
 * `update_checklist` derives the document requirements. Outside Canada — the
 * only country with a `country_framework` — that is `discoveryChecklist`, a
 * full structured generation, measured at 9.4–10.0s on production. It ran on
 * every turn of the interview, and for most of its history it ran in FRONT of
 * the reply, so the applicant paid all of it before reading a word.
 *
 * Two attempts to fix that are worth remembering, because both are the kind of
 * thing that looks right in a diff:
 *
 *   1. Fanning out from `update_profile` to `check_complete` and
 *      `update_checklist`. This looked parallel and was not. LangGraph runs
 *      SUPERSTEPS and a superstep is a barrier — every node in it finishes
 *      before the next starts — so `ask_question`, one superstep later, still
 *      waited the full 9.4s. The timings said so: `update_checklist` logged
 *      BEFORE `ask_question`, which two concurrent nodes cannot do.
 *   2. Pairing it with `ask_question` (same source, therefore same superstep).
 *      That genuinely overlapped them and got it off the critical path — but
 *      not off the bill. The same generation still fired every turn to rebuild
 *      a list nobody was reading yet.
 *
 * So the node is no longer in the per-turn graph at all. It runs once, on
 * demand, from `IntakeService.rebuildChecklist`, when the documents surface is
 * opened and the list is actually read.
 *
 * These assertions are on the compiled graph rather than on a timing, because a
 * timing test passes on a fast machine with the barrier still in place — which
 * is exactly how attempt 1 got through.
 */
describe('intake graph — the reply path', () => {
  const graph = buildIntakeGraph({} as never, 'sk-test');
  const edges = graph.getGraph().edges.map((e) => ({
    source: e.source,
    target: e.target,
    conditional: Boolean(e.conditional),
  }));
  const nodes = [...new Set(edges.flatMap((e) => [e.source, e.target]))];

  const targetsOf = (node: string) =>
    edges.filter((e) => e.source === node).map((e) => e.target);

  it('does not run the checklist as part of a turn', () => {
    // The regression in one line. Any edge that reintroduces this node puts a
    // ~10s structured generation back into every answer.
    expect(nodes).not.toContain('update_checklist');
  });

  it('reaches the reply through nothing but the profile and the completion check', () => {
    expect(targetsOf('process_answer')).toEqual(['update_profile']);
    expect(targetsOf('update_profile')).toEqual(['check_complete']);
    expect(targetsOf('check_complete')).toEqual(
      expect.arrayContaining(['ask_question']),
    );
  });

  it('keeps every remaining node on the path the applicant waits on', () => {
    // Anything registered here is, by construction, latency the applicant pays
    // per answer. Adding a node to this list is a deliberate act.
    expect(new Set(nodes)).toEqual(
      new Set([
        '__start__',
        'load_framework',
        'process_answer',
        'update_profile',
        'check_complete',
        'ask_question',
        '__end__',
      ]),
    );
  });

  it('still serves the first question without waiting on an answer to process', () => {
    expect(targetsOf('load_framework')).toEqual(['ask_question']);
  });
});
