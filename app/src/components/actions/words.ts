import type {
  ActionCriterion,
  ActionDefinition,
  ActionParameter,
  ActionRule,
  ComparisonOp,
} from '@contracts/actions';

/**
 * Action type definitions in words, for people who read them rather than
 * write them: "Replace Employee's hr:reportsTo link with one to New manager".
 * Pure: no React, no API.
 */

const BUILTIN_WORDS: Record<string, string> = {
  actor: 'the submitter',
  today: 'today',
  now: 'now',
};

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

/** "a", "a and b", "a, b and c". */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function localClass(classIri: string): string {
  const afterColon = classIri.includes(':') ? classIri.slice(classIri.indexOf(':') + 1) : classIri;
  return afterColon.split(/[/#]/).filter(Boolean).pop() ?? classIri;
}

/**
 * How the definition refers to a name: an object parameter by its label, an
 * object a create rule makes as "the new Person".
 */
export function nameOf(name: string, def: ActionDefinition): string {
  const param = def.parameters.find((p) => p.name === name);
  if (param) return param.label;
  const creates = def.rules.filter((r): r is Extract<ActionRule, { kind: 'create_object' }> => r.kind === 'create_object');
  const created = creates.find((r) => r.as === name);
  if (created) {
    const cls = localClass(created.classIri);
    const sameClass = creates.filter((r) => localClass(r.classIri) === cls).length;
    return sameClass > 1 ? `the new ${cls} “${name}”` : `the new ${cls}`;
  }
  return name;
}

/** A placeholder in words: `{employee.status}` is "Employee's status", `{today}` is "today". */
export function placeholderWords(ph: string, def: ActionDefinition): string {
  const [head, ...rest] = ph.split('.');
  if (rest.length === 0 && head in BUILTIN_WORDS) return BUILTIN_WORDS[head];
  const who = nameOf(head, def);
  if (rest.length === 0) return who;
  return `${who}'s ${rest.join('.')}`;
}

/**
 * A template in words. A single placeholder reads as what it names; text
 * without placeholders is quoted; anything else is quoted with each
 * placeholder named, e.g. “hr:Person/{Employee ID}”.
 */
export function templateWords(tpl: string, def: ActionDefinition): string {
  const whole = /^\{([^{}]+)\}$/.exec(tpl.trim());
  if (whole) return placeholderWords(whole[1].trim(), def);
  if (!/\{[^{}]+\}/.test(tpl)) return `“${tpl}”`;
  return `“${tpl.replace(/\{([^{}]+)\}/g, (_, ph: string) => `{${placeholderWords(ph.trim(), def)}}`)}”`;
}

/** Object parameters a rule names that may be left empty; the rule is skipped when they are. */
function optionalRefs(rule: ActionRule, def: ActionDefinition): ActionParameter[] {
  const refs =
    rule.kind === 'create_object'
      ? []
      : rule.kind === 'modify_object' || rule.kind === 'delete_object'
        ? [rule.object]
        : [rule.from, rule.to].filter((r): r is string => !!r);
  return def.parameters.filter((p) => p.type === 'object' && !p.required && refs.includes(p.name));
}

function ruleCore(rule: ActionRule, def: ActionDefinition): string {
  switch (rule.kind) {
    case 'create_object': {
      let s = `Create a new ${rule.classIri} with IRI ${templateWords(rule.iri, def)} and label ${templateWords(rule.label, def)}`;
      const props = Object.entries(rule.properties ?? {});
      if (props.length) s += `, setting ${listWords(props.map(([k, v]) => `${k} to ${templateWords(v, def)}`))}`;
      if (rule.moduleKey) s += `, in module ${rule.moduleKey}`;
      return s;
    }
    case 'modify_object': {
      const parts: string[] = [];
      if (rule.label !== undefined) parts.push(`rename it to ${templateWords(rule.label, def)}`);
      const entries = Object.entries(rule.properties);
      const sets = entries.flatMap(([k, v]) => (v === null ? [] : [`${k} to ${templateWords(v, def)}`]));
      const unsets = entries.flatMap(([k, v]) => (v === null ? [k] : []));
      if (sets.length) parts.push(`set ${listWords(sets)}`);
      if (unsets.length) parts.push(`remove ${listWords(unsets)}`);
      return `Update ${nameOf(rule.object, def)}: ${parts.join('; ')}`;
    }
    case 'delete_object':
      return `Delete ${nameOf(rule.object, def)}`;
    case 'add_link':
      return `Link ${nameOf(rule.from, def)} to ${nameOf(rule.to, def)} with ${rule.predicate}`;
    case 'remove_link':
      return `Remove ${nameOf(rule.from, def)}'s ${rule.predicate} link to ${nameOf(rule.to, def)}`;
    case 'set_link':
      return rule.to
        ? `Replace ${nameOf(rule.from, def)}'s ${rule.predicate} link with one to ${nameOf(rule.to, def)}`
        : `Remove every ${rule.predicate} link from ${nameOf(rule.from, def)}`;
  }
}

/** A rule in words, e.g. "Replace Employee's hr:reportsTo link with one to New manager". */
export function describeRule(rule: ActionRule, def: ActionDefinition): string {
  const core = ruleCore(rule, def);
  const optional = optionalRefs(rule, def);
  return optional.length ? `${core} (skipped when ${listWords(optional.map((p) => p.label))} is left empty)` : core;
}

const OP_WORDS: Record<ComparisonOp, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  not_in: 'is not one of',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  present: 'is set',
  absent: 'is empty',
};

const DATE_OP_WORDS: Partial<Record<ComparisonOp, string>> = {
  gt: 'is after',
  gte: 'is on or after',
  lt: 'is before',
  lte: 'is on or before',
};

/** Whether a criterion side reads a date: a date parameter, {today} / {now}, or a date literal. */
function isDateSide(side: unknown, def: ActionDefinition): boolean {
  if (typeof side !== 'string') return false;
  if (DATE_TEXT.test(side)) return true;
  const whole = /^\{([^{}.]+)\}$/.exec(side.trim());
  if (!whole) return false;
  const name = whole[1].trim();
  return name === 'today' || name === 'now' || def.parameters.some((p) => p.name === name && p.type === 'date');
}

function rightWords(right: Extract<ActionCriterion, { kind: 'compare' }>['right'], def: ActionDefinition): string {
  if (right === undefined) return '';
  if (Array.isArray(right)) return listWords(right.map((r) => `“${r}”`)).replace(/ and (?=[^,]*$)/, ' or ');
  if (typeof right === 'string') return templateWords(right, def);
  return String(right);
}

/** The condition a criterion checks, in words, e.g. "New end date is after Contract's endDate". */
export function describeCriterion(c: ActionCriterion, def: ActionDefinition): string {
  if (c.kind === 'distinct') return `${nameOf(c.a, def)} and ${nameOf(c.b, def)} are different objects`;
  const dates = isDateSide(c.left, def) || isDateSide(c.right, def);
  const op = (dates && DATE_OP_WORDS[c.op]) || OP_WORDS[c.op];
  const left = templateWords(c.left, def);
  if (c.op === 'present' || c.op === 'absent') return `${left} ${op}`;
  return `${left} ${op} ${rightWords(c.right, def)}`;
}

/** A parameter's type in words, e.g. "Object: hr:Person or a subclass", "Number, at least 0". */
export function describeParameterType(p: ActionParameter): string {
  switch (p.type) {
    case 'string':
      return p.maxLength ? `Text, up to ${p.maxLength} characters` : 'Text';
    case 'number': {
      const base = p.integer ? 'Whole number' : 'Number';
      if (p.min !== undefined && p.max !== undefined) return `${base}, ${p.min} to ${p.max}`;
      if (p.min !== undefined) return `${base}, at least ${p.min}`;
      if (p.max !== undefined) return `${base}, at most ${p.max}`;
      return base;
    }
    case 'boolean':
      return 'Yes or no';
    case 'date':
      return 'Date';
    case 'enum':
      return `One of ${listWords(p.options.map((o) => `“${o}”`)).replace(/ and (?=[^,]*$)/, ' or ')}`;
    case 'object':
      return `Object: ${p.classIri} or a subclass`;
  }
}

/* ── results ─────────────────────────────────────────────────── */

type Link = { from: string; predicate: string; to: string };

/** The shape of an applied submission's result (the API's PlanSummary). */
export type PlanLike = {
  created: { iri: string; classIri: string; label: string }[];
  modified: { iri: string; label?: { from: string; to: string }; set: Record<string, { from: unknown; to: unknown }>; unset: string[] }[];
  deleted: { iri: string; label: string }[];
  linksAdded: Link[];
  linksRemoved: Link[];
};

export type ProblemLike = { code: string; message: string; path?: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A stored result as a plan summary, or null when it is not one. */
export function asPlan(json: unknown): PlanLike | null {
  if (!isObj(json)) return null;
  const keys = ['created', 'modified', 'deleted', 'linksAdded', 'linksRemoved'] as const;
  if (!keys.every((k) => Array.isArray(json[k]))) return null;
  return json as unknown as PlanLike;
}

/** Stored problems (a rejection's reasons), dropping anything malformed. */
export function asProblems(json: unknown): ProblemLike[] {
  if (!Array.isArray(json)) return [];
  return json.filter((p): p is ProblemLike => isObj(p) && typeof p.message === 'string').map((p) => ({
    code: typeof p.code === 'string' ? p.code : 'problem',
    message: p.message,
    path: typeof p.path === 'string' ? p.path : undefined,
  }));
}

export function planIsEmpty(p: PlanLike): boolean {
  return !p.created.length && !p.modified.length && !p.deleted.length && !p.linksAdded.length && !p.linksRemoved.length;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "created 1 object, changed 2 objects, added 1 link". */
export function planCounts(p: PlanLike): string {
  const parts: string[] = [];
  if (p.created.length) parts.push(`created ${plural(p.created.length, 'object')}`);
  if (p.modified.length) parts.push(`changed ${plural(p.modified.length, 'object')}`);
  if (p.deleted.length) parts.push(`deleted ${plural(p.deleted.length, 'object')}`);
  if (p.linksAdded.length) parts.push(`added ${plural(p.linksAdded.length, 'link')}`);
  if (p.linksRemoved.length) parts.push(`removed ${plural(p.linksRemoved.length, 'link')}`);
  return parts.join(', ') || 'no change';
}

/** One line for a submission in the history: what it changed, or why it was rejected. */
export function summariseSubmission(s: { status: string; resultJson: unknown; errorsJson: unknown }): string {
  if (s.status === 'applied') {
    const plan = asPlan(s.resultJson);
    if (!plan) return 'Applied';
    const counts = planCounts(plan);
    return counts.charAt(0).toUpperCase() + counts.slice(1);
  }
  const problems = asProblems(s.errorsJson);
  if (problems.length === 0) return 'Rejected';
  return problems.length > 1 ? `${problems[0].message} (+${problems.length - 1} more)` : problems[0].message;
}

/** Objects that exist after the plan and were created or changed by it, for links to the Explorer. */
export function touchedObjectIris(p: PlanLike): string[] {
  const deleted = new Set(p.deleted.map((d) => d.iri));
  const out: string[] = [];
  const add = (iri: string) => {
    if (!deleted.has(iri) && !out.includes(iri)) out.push(iri);
  };
  p.created.forEach((c) => add(c.iri));
  p.modified.forEach((m) => add(m.iri));
  [...p.linksAdded, ...p.linksRemoved].forEach((l) => add(l.from));
  return out;
}

/** A property value as it reads in a before → after line. */
export function valueWords(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'nothing';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
