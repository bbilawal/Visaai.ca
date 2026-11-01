import {
  RULE_FACTS,
  RULE_OPERATORS,
  isAll,
  isAny,
  isCondition,
  isNot,
  type RuleCondition,
  type RuleFact,
  type RuleFacts,
  type RuleNode,
  type RuleScalar,
  type RuleVerdict,
} from './rule.types';

const FACTS = new Set<string>(RULE_FACTS);
const OPS = new Set<string>(RULE_OPERATORS);

/** Operators that take an array value. */
const ARRAY_OPS = new Set(['in', 'nin']);
/** Operators that take no value at all. */
const NULLARY_OPS = new Set(['exists', 'not_exists']);
/** Operators that require both sides to be numeric. */
const NUMERIC_OPS = new Set(['lt', 'lte', 'gt', 'gte']);

export interface RuleValidationError {
  path: string;
  message: string;
}

/**
 * Structural validation. Called before a rule is written to
 * `visa_requirements.rule`, so a malformed rule is rejected at the data-quality
 * gate rather than discovered at render time as a requirement that silently
 * never fires.
 */
export function validateRule(node: unknown, path = '$'): RuleValidationError[] {
  const errors: RuleValidationError[] = [];

  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return [{ path, message: 'rule node must be an object' }];
  }

  const keys = Object.keys(node);
  const combinator = keys.find(
    (k) => k === 'all' || k === 'any' || k === 'not',
  );

  if (combinator) {
    if (keys.length > 1) {
      errors.push({
        path,
        message: `combinator "${combinator}" must be the only key, found: ${keys.join(', ')}`,
      });
    }
    const child = (node as Record<string, unknown>)[combinator];
    if (combinator === 'not') {
      return [...errors, ...validateRule(child, `${path}.not`)];
    }
    if (!Array.isArray(child) || child.length === 0) {
      // An empty all/any has no defensible meaning: `all: []` is vacuously
      // true and would make a conditional requirement unconditional, which is
      // the kind of silent wrong answer this layer exists to prevent.
      return [
        ...errors,
        { path: `${path}.${combinator}`, message: 'must be a non-empty array' },
      ];
    }
    return child.reduce<RuleValidationError[]>(
      (acc, c, i) => [
        ...acc,
        ...validateRule(c, `${path}.${combinator}[${i}]`),
      ],
      errors,
    );
  }

  const cond = node as Partial<RuleCondition>;
  if (typeof cond.fact !== 'string' || !FACTS.has(cond.fact)) {
    errors.push({
      path: `${path}.fact`,
      message: `unknown fact "${String(cond.fact)}"`,
    });
  }
  if (typeof cond.op !== 'string' || !OPS.has(cond.op)) {
    errors.push({
      path: `${path}.op`,
      message: `unknown operator "${String(cond.op)}"`,
    });
    return errors;
  }

  if (NULLARY_OPS.has(cond.op)) {
    if (cond.value !== undefined) {
      errors.push({
        path: `${path}.value`,
        message: `operator "${cond.op}" takes no value`,
      });
    }
  } else if (ARRAY_OPS.has(cond.op)) {
    if (!Array.isArray(cond.value) || cond.value.length === 0) {
      errors.push({
        path: `${path}.value`,
        message: `operator "${cond.op}" requires a non-empty array`,
      });
    }
  } else if (cond.value === undefined) {
    errors.push({
      path: `${path}.value`,
      message: `operator "${cond.op}" requires a value`,
    });
  } else if (NUMERIC_OPS.has(cond.op) && typeof cond.value !== 'number') {
    errors.push({
      path: `${path}.value`,
      message: `operator "${cond.op}" requires a numeric value`,
    });
  }

  return errors;
}

function normalize(v: unknown): RuleScalar | RuleScalar[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return v as RuleScalar | RuleScalar[];
}

/**
 * Case-insensitive for strings, exact for everything else. Nationality and
 * country codes arrive from a dozen surfaces (intake answers, OCR extraction,
 * partner API payloads) with inconsistent casing; a rule that misses because
 * the applicant typed "in" instead of "IN" is a wrong checklist.
 */
function sameValue(a: RuleScalar, b: RuleScalar): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return a === b;
}

function evaluateCondition(cond: RuleCondition, facts: RuleFacts): RuleVerdict {
  const raw = normalize(facts[cond.fact]);

  if (cond.op === 'exists') return raw === undefined ? 'false' : 'true';
  if (cond.op === 'not_exists') return raw === undefined ? 'true' : 'false';

  // The fact was never supplied. Not false — unknown. See RuleVerdict.
  if (raw === undefined) return 'unknown';

  switch (cond.op) {
    case 'eq':
      return sameValue(raw as RuleScalar, cond.value as RuleScalar)
        ? 'true'
        : 'false';
    case 'neq':
      return sameValue(raw as RuleScalar, cond.value as RuleScalar)
        ? 'false'
        : 'true';
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      const left = typeof raw === 'number' ? raw : Number(raw);
      const right = cond.value as number;
      // A non-numeric answer to a numeric rule is not a false — it is a fact
      // we cannot compare. Returning 'false' here would quietly drop an
      // age-gated or duration-gated requirement.
      if (!Number.isFinite(left)) return 'unknown';
      const ok =
        cond.op === 'lt'
          ? left < right
          : cond.op === 'lte'
            ? left <= right
            : cond.op === 'gt'
              ? left > right
              : left >= right;
      return ok ? 'true' : 'false';
    }
    case 'in':
    case 'nin': {
      const list = (cond.value as RuleScalar[]) ?? [];
      const hit = list.some((v) => sameValue(raw as RuleScalar, v));
      return (cond.op === 'in' ? hit : !hit) ? 'true' : 'false';
    }
    case 'contains': {
      if (Array.isArray(raw)) {
        return raw.some((v) => sameValue(v, cond.value as RuleScalar))
          ? 'true'
          : 'false';
      }
      if (typeof raw === 'string' && typeof cond.value === 'string') {
        return raw.toLowerCase().includes(cond.value.toLowerCase())
          ? 'true'
          : 'false';
      }
      return 'unknown';
    }
    default:
      // Unreachable for a validated rule; an unvalidated one gets 'unknown'
      // rather than a throw, because evaluation runs inside checklist
      // rendering and must never take a page down.
      return 'unknown';
  }
}

/**
 * Kleene three-valued AND: false dominates, then unknown.
 * `false AND unknown` is false — the requirement genuinely does not apply,
 * regardless of the missing fact — so a missing answer does not inflate the
 * checklist with things a known fact already ruled out.
 */
function andVerdicts(vs: RuleVerdict[]): RuleVerdict {
  if (vs.includes('false')) return 'false';
  if (vs.includes('unknown')) return 'unknown';
  return 'true';
}

/** Kleene three-valued OR: true dominates, then unknown. */
function orVerdicts(vs: RuleVerdict[]): RuleVerdict {
  if (vs.includes('true')) return 'true';
  if (vs.includes('unknown')) return 'unknown';
  return 'false';
}

/**
 * Evaluate a rule against applicant facts.
 *
 * `null`/`undefined` rule = unconditional = 'true'. That is how an
 * always-required document is stored: no rule at all, rather than a
 * tautology someone has to read and verify.
 */
export function evaluateRule(
  rule: RuleNode | null | undefined,
  facts: RuleFacts,
): RuleVerdict {
  if (rule === null || rule === undefined) return 'true';
  if (typeof rule !== 'object') return 'unknown';

  if (isAll(rule)) {
    return andVerdicts(rule.all.map((n) => evaluateRule(n, facts)));
  }
  if (isAny(rule)) {
    return orVerdicts(rule.any.map((n) => evaluateRule(n, facts)));
  }
  if (isNot(rule)) {
    const inner = evaluateRule(rule.not, facts);
    return inner === 'unknown'
      ? 'unknown'
      : inner === 'true'
        ? 'false'
        : 'true';
  }
  if (isCondition(rule)) return evaluateCondition(rule, facts);
  return 'unknown';
}

/**
 * The facts a rule reads. Drives two things:
 *   - conditional questioning: ask only what some rule actually depends on,
 *     which is the difference between a 40-question intake and a 12-question one
 *   - the "why are you asking me this?" explanation, which names the
 *     requirement a question unlocks
 */
export function factsUsed(rule: RuleNode | null | undefined): RuleFact[] {
  const out = new Set<RuleFact>();
  const walk = (n: RuleNode | null | undefined): void => {
    if (!n || typeof n !== 'object') return;
    if (isAll(n)) return n.all.forEach(walk);
    if (isAny(n)) return n.any.forEach(walk);
    if (isNot(n)) return walk(n.not);
    if (isCondition(n)) out.add(n.fact);
  };
  walk(rule);
  return [...out];
}

/**
 * Human-readable rendering of a rule, for the "why is this required?" panel
 * and for admin review of a detected government change. Plain English, no
 * jargon, no rule syntax leaking into the UI.
 */
export function explainRule(rule: RuleNode | null | undefined): string {
  if (!rule) return 'Always required.';

  const phrase = (c: RuleCondition): string => {
    const f = c.fact.replace(/_/g, ' ');
    const v = Array.isArray(c.value) ? c.value.join(', ') : String(c.value);
    switch (c.op) {
      case 'eq':
        return `${f} is ${v}`;
      case 'neq':
        return `${f} is not ${v}`;
      case 'lt':
        return `${f} is under ${v}`;
      case 'lte':
        return `${f} is ${v} or less`;
      case 'gt':
        return `${f} is over ${v}`;
      case 'gte':
        return `${f} is ${v} or more`;
      case 'in':
        return `${f} is one of ${v}`;
      case 'nin':
        return `${f} is not one of ${v}`;
      case 'exists':
        return `${f} is provided`;
      case 'not_exists':
        return `${f} is not provided`;
      case 'contains':
        return `${f} includes ${v}`;
      default:
        return `${f} matches`;
    }
  };

  const walk = (n: RuleNode): string => {
    if (isAll(n)) return n.all.map(walk).join(' and ');
    if (isAny(n)) return n.any.map(walk).join(' or ');
    if (isNot(n)) return `not (${walk(n.not)})`;
    if (isCondition(n)) return phrase(n);
    return 'an unrecognised condition';
  };

  return `Required when ${walk(rule)}.`;
}
