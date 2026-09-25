import {
  ACTION_ROLES,
  BUILTIN_PLACEHOLDERS,
  type ActionCriterion,
  type ActionDefinition,
  type ActionParameter,
  type ActionRole,
} from "@contracts/actions";

/**
 * The pure core of action types: checking parameters, evaluating criteria and
 * planning edits against a snapshot of the objects a submission names. No
 * database or engine here; services/actions/service.ts loads the snapshot and
 * applies the plan.
 */

export type ParamValue = string | number | boolean | null;
export type ParamValues = Record<string, ParamValue>;

export type Problem = {
  /** Machine-readable, e.g. "param_required", "criterion_failed". */
  code: string;
  message: string;
  /** Where in the submission or definition, e.g. "params.employee" or "criteria.0". */
  path?: string;
};

/** An existing object as the submission sees it. */
export type ObjectSnapshot = {
  id: number;
  iri: string;
  classIri: string;
  moduleKey: string;
  label: string;
  props: Record<string, unknown>;
  deleted: boolean;
  /** Its outgoing links. */
  links: { edgeId: number; predicate: string; toIri: string }[];
  /** Prefixes its short property keys stand for, e.g. ["legal", "lgl"]. */
  namespaces: string[];
};

export type EditPlan = {
  creates: {
    alias: string;
    iri: string;
    classIri: string;
    moduleKey: string;
    label: string;
    props: Record<string, ParamValue>;
  }[];
  modifies: {
    id: number;
    iri: string;
    label?: { from: string; to: string };
    set: Record<string, { from: unknown; to: ParamValue }>;
    unset: Record<string, unknown>;
  }[];
  deletes: { id: number; iri: string; label: string }[];
  linkAdds: { fromIri: string; predicate: string; toIri: string }[];
  linkRemoves: { edgeId: number; fromIri: string; predicate: string; toIri: string }[];
};

export function emptyPlan(): EditPlan {
  return { creates: [], modifies: [], deletes: [], linkAdds: [], linkRemoves: [] };
}

export function planIsEmpty(p: EditPlan): boolean {
  return !p.creates.length && !p.modifies.length && !p.deletes.length && !p.linkAdds.length && !p.linkRemoves.length;
}

/* ── permissions ─────────────────────────────────────────────── */

const RANK: Record<ActionRole, number> = { viewer: 0, editor: 1, ontologist: 2, admin: 3 };

function rankOf(role: string | null | undefined): number {
  return role && (ACTION_ROLES as readonly string[]).includes(role) ? RANK[role as ActionRole] : -1;
}

export type Submitter = {
  /** The account's own role; "admin" is a system administrator. */
  userRole: string;
  /** The role in this workspace. */
  memberRole: string;
  /** Module keys the membership is limited to; empty or null means every module. */
  moduleScope: unknown;
};

export function scopeOf(moduleScope: unknown): string[] {
  if (Array.isArray(moduleScope)) return moduleScope.filter((k): k is string => typeof k === "string");
  if (typeof moduleScope === "string" && moduleScope.trim()) {
    try {
      return scopeOf(JSON.parse(moduleScope));
    } catch {
      return moduleScope.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * Whether this person may submit an action of `minRole` in `moduleKey`. A
 * system administrator always may; anyone else needs the role in the workspace
 * (or as their account role) and, if their membership is scoped to modules,
 * the action's module among them.
 */
export function checkSubmitter(s: Submitter, minRole: ActionRole, moduleKey: string): Problem | null {
  if (s.userRole === "admin") return null;
  const rank = Math.max(rankOf(s.memberRole), rankOf(s.userRole));
  if (rank < RANK[minRole]) {
    return { code: "forbidden_role", message: `Submitting this action needs the ${minRole} role or higher` };
  }
  const scope = scopeOf(s.moduleScope);
  if (scope.length > 0 && !scope.includes(moduleKey)) {
    return { code: "forbidden_scope", message: `This action belongs to module "${moduleKey}", outside your module scope` };
  }
  return null;
}

/* ── parameters ──────────────────────────────────────────────── */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/** Checks raw submission values against the declared parameters and gives them their declared types. */
export function coerceParams(
  params: ActionParameter[],
  raw: Record<string, unknown>,
): { values: ParamValues; problems: Problem[] } {
  const values: ParamValues = {};
  const problems: Problem[] = [];
  const declared = new Set(params.map((p) => p.name));
  for (const k of Object.keys(raw)) {
    if (!declared.has(k)) problems.push({ code: "param_unknown", message: `"${k}" is not a parameter of this action`, path: `params.${k}` });
  }
  for (const p of params) {
    const path = `params.${p.name}`;
    const v = raw[p.name];
    if (isEmpty(v)) {
      values[p.name] = null;
      if (p.required) problems.push({ code: "param_required", message: `${p.label} is required`, path });
      continue;
    }
    const bad = (why: string) => problems.push({ code: "param_invalid", message: `${p.label}: ${why}`, path });
    switch (p.type) {
      case "string": {
        if (typeof v !== "string") {
          bad("must be text");
          break;
        }
        const max = p.maxLength ?? 2000;
        if (v.length > max) bad(`at most ${max} characters`);
        else values[p.name] = v;
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
        if (!Number.isFinite(n)) bad("must be a number");
        else if (p.integer && !Number.isInteger(n)) bad("must be a whole number");
        else if (p.min !== undefined && n < p.min) bad(`at least ${p.min}`);
        else if (p.max !== undefined && n > p.max) bad(`at most ${p.max}`);
        else values[p.name] = n;
        break;
      }
      case "boolean": {
        if (typeof v === "boolean") values[p.name] = v;
        else if (v === "true" || v === "false") values[p.name] = v === "true";
        else bad("must be true or false");
        break;
      }
      case "date": {
        if (typeof v !== "string" || !isValidDate(v)) bad("must be a date, YYYY-MM-DD");
        else values[p.name] = v;
        break;
      }
      case "enum": {
        if (typeof v !== "string" || !p.options.includes(v)) bad(`must be one of ${p.options.join(", ")}`);
        else values[p.name] = v;
        break;
      }
      case "object": {
        if (typeof v !== "string" || v.length > 512) bad("must name an object by its IRI");
        else values[p.name] = v.trim();
        break;
      }
    }
  }
  return { values, problems };
}

/**
 * Checks each object parameter names a live object of the declared class, or a
 * subclass of it. `ancestors(classIri)` gives every class `classIri` is a
 * subclass of, transitively.
 */
export function checkObjectParams(
  params: ActionParameter[],
  values: ParamValues,
  objects: Map<string, ObjectSnapshot>,
  ancestors: (classIri: string) => Set<string>,
): Problem[] {
  const problems: Problem[] = [];
  for (const p of params) {
    if (p.type !== "object") continue;
    const iri = values[p.name];
    if (typeof iri !== "string") continue;
    const path = `params.${p.name}`;
    const obj = objects.get(iri);
    if (!obj || obj.deleted) {
      problems.push({ code: "object_not_found", message: `${p.label}: no object ${iri}`, path });
    } else if (obj.classIri !== p.classIri && !ancestors(obj.classIri).has(p.classIri)) {
      problems.push({ code: "object_wrong_class", message: `${p.label}: ${iri} is a ${obj.classIri}, not a ${p.classIri}`, path });
    }
  }
  return problems;
}

/* ── templates ───────────────────────────────────────────────── */

/** A created object while its rule list is planned. */
type WorkingObject = {
  id?: number;
  iri: string;
  classIri: string;
  moduleKey: string;
  label: string;
  props: Record<string, unknown>;
  links: { edgeId?: number; predicate: string; toIri: string }[];
  namespaces: string[];
  deleted: boolean;
  created: boolean;
};

export type TemplateContext = {
  values: ParamValues;
  /** Object parameters and created objects, by parameter name or alias. */
  objects: Map<string, WorkingObject | ObjectSnapshot>;
  actor: string;
  now: Date;
};

/** The key a property is stored under on this object: as written, or its short or prefixed twin. */
export function findPropKey(obj: { props: Record<string, unknown>; namespaces: string[] }, key: string): string | undefined {
  if (key in obj.props) return key;
  const colon = key.indexOf(":");
  if (colon > 0) {
    const ns = key.slice(0, colon);
    const local = key.slice(colon + 1);
    if (obj.namespaces.includes(ns) && local in obj.props) return local;
    return undefined;
  }
  for (const ns of obj.namespaces) {
    if (`${ns}:${key}` in obj.props) return `${ns}:${key}`;
  }
  return undefined;
}

export function readProp(obj: { props: Record<string, unknown>; namespaces: string[] }, key: string): unknown {
  const k = findPropKey(obj, key);
  return k === undefined ? null : obj.props[k];
}

function resolvePlaceholder(ph: string, ctx: TemplateContext): ParamValue {
  const [head, ...rest] = ph.split(".");
  if (rest.length === 0) {
    if (head === "actor") return ctx.actor;
    if (head === "today") return ctx.now.toISOString().slice(0, 10);
    if (head === "now") return ctx.now.toISOString();
  }
  const obj = ctx.objects.get(head);
  if (obj) {
    if (rest.length === 0) return obj.iri;
    const field = rest.join(".");
    if (field === "iri") return obj.iri;
    if (field === "label") return obj.label;
    const v = readProp(obj, field);
    return v === undefined || v === null ? null : typeof v === "object" ? JSON.stringify(v) : (v as ParamValue);
  }
  if (head in ctx.values) return rest.length === 0 ? ctx.values[head] : null;
  return null;
}

/**
 * Renders a template. One placeholder and nothing else keeps the value's type
 * (and null when it has none); anything else is text, with empty values as "".
 */
export function renderTemplate(tpl: string, ctx: TemplateContext): ParamValue {
  const whole = /^\{([^{}]+)\}$/.exec(tpl);
  if (whole) return resolvePlaceholder(whole[1].trim(), ctx);
  return tpl.replace(/\{([^{}]+)\}/g, (_, ph: string) => {
    const v = resolvePlaceholder(ph.trim(), ctx);
    return v === null ? "" : String(v);
  });
}

/* ── criteria ────────────────────────────────────────────────── */

export type CriterionResult = { index: number; message: string; passed: boolean; detail?: string };

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function show(v: unknown): string {
  return v === null || v === undefined || v === "" ? "nothing" : JSON.stringify(v);
}

function compare(left: ParamValue, op: ActionCriterion & { kind: "compare" }, ctx: TemplateContext): { ok: boolean; detail: string } {
  if (op.op === "present") return { ok: !isEmpty(left), detail: `is ${show(left)}` };
  if (op.op === "absent") return { ok: isEmpty(left), detail: `is ${show(left)}` };
  if (op.op === "in" || op.op === "not_in") {
    const list = Array.isArray(op.right) ? op.right : [];
    const found = left !== null && list.includes(String(left));
    return { ok: op.op === "in" ? found : !found, detail: `is ${show(left)}` };
  }
  const right: ParamValue = typeof op.right === "string" ? renderTemplate(op.right, ctx) : ((op.right ?? null) as ParamValue);
  const ln = asNumber(left);
  const rn = asNumber(right);
  const detail = `${show(left)} against ${show(right)}`;
  if (op.op === "eq" || op.op === "neq") {
    const equal = ln !== null && rn !== null ? ln === rn : String(left ?? "") === String(right ?? "");
    return { ok: op.op === "eq" ? equal : !equal, detail };
  }
  let c: number | null = null;
  if (ln !== null && rn !== null) c = ln - rn;
  else if (typeof left === "string" && typeof right === "string" && DATE.test(left) && DATE.test(right)) {
    c = left < right ? -1 : left > right ? 1 : 0;
  }
  if (c === null) return { ok: false, detail: `${detail} cannot be compared` };
  const ok = op.op === "gt" ? c > 0 : op.op === "gte" ? c >= 0 : op.op === "lt" ? c < 0 : c <= 0;
  return { ok, detail };
}

export function evaluateCriteria(criteria: ActionCriterion[], ctx: TemplateContext): CriterionResult[] {
  return criteria.map((c, index) => {
    if (c.kind === "distinct") {
      const a = ctx.values[c.a];
      const b = ctx.values[c.b];
      const passed = a === null || b === null || a !== b;
      return { index, message: c.message, passed, detail: passed ? undefined : `both are ${show(a)}` };
    }
    const { ok, detail } = compare(renderTemplate(c.left, ctx), c, ctx);
    return { index, message: c.message, passed: ok, detail };
  });
}

/* ── planning ────────────────────────────────────────────────── */

function isWholePlaceholderOfEmpty(tpl: string, ctx: TemplateContext): boolean {
  const whole = /^\{([^{}]+)\}$/.exec(tpl);
  return !!whole && resolvePlaceholder(whole[1].trim(), ctx) === null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const an = asNumber(a);
  const bn = asNumber(b);
  return an !== null && bn !== null && typeof a === typeof b && an === bn;
}

const IRI_TEXT = /^[A-Za-z][\w.+-]*:[^\s{}<>"]+$/;

/**
 * Plans the edits the rules make, in order, against the snapshot. A rule that
 * names an optional object parameter left empty is skipped, as is a property
 * whose template is a single empty placeholder. Links that already exist are
 * not added again, and removing a link that is not there does nothing.
 */
export function planEdits(
  def: ActionDefinition,
  input: { values: ParamValues; objects: Map<string, ObjectSnapshot>; actor: string; now: Date; actionModuleKey: string },
): { plan: EditPlan; problems: Problem[]; context: TemplateContext } {
  const plan = emptyPlan();
  const problems: Problem[] = [];
  const named = new Map<string, WorkingObject | ObjectSnapshot>();
  for (const p of def.parameters) {
    const v = input.values[p.name];
    if (p.type === "object" && typeof v === "string") {
      const obj = input.objects.get(v);
      if (obj) named.set(p.name, obj);
    }
  }
  // Templates in later rules see what earlier rules did; the returned context
  // does not, so criteria judge the objects as they were submitted against.
  const ctx: TemplateContext = { values: input.values, objects: named, actor: input.actor, now: input.now };
  const before: TemplateContext = { ...ctx, objects: new Map(named) };

  // The working state of each existing object the rules touch, by IRI.
  const working = new Map<string, WorkingObject>();
  const touch = (o: WorkingObject | ObjectSnapshot): WorkingObject => {
    let w = working.get(o.iri);
    if (!w) {
      w = {
        ...o,
        props: { ...o.props },
        links: o.links.map((l) => ({ ...l })),
        created: "created" in o ? o.created : false,
      };
      working.set(o.iri, w);
    }
    return w;
  };
  const modified = new Map<string, EditPlan["modifies"][number]>();
  const modifyEntry = (w: WorkingObject) => {
    let m = modified.get(w.iri);
    if (!m) {
      m = { id: w.id as number, iri: w.iri, set: {}, unset: {} };
      modified.set(w.iri, m);
    }
    return m;
  };
  const addLink = (from: WorkingObject, predicate: string, toIri: string) => {
    if (from.links.some((l) => l.predicate === predicate && l.toIri === toIri)) return;
    from.links.push({ predicate, toIri });
    plan.linkAdds.push({ fromIri: from.iri, predicate, toIri });
  };
  const removeLinks = (from: WorkingObject, predicate: string, toIri?: string) => {
    const keep: WorkingObject["links"] = [];
    for (const l of from.links) {
      if (l.predicate === predicate && (toIri === undefined || l.toIri === toIri)) {
        if (l.edgeId !== undefined) plan.linkRemoves.push({ edgeId: l.edgeId, fromIri: from.iri, predicate, toIri: l.toIri });
        else plan.linkAdds = plan.linkAdds.filter((a) => !(a.fromIri === from.iri && a.predicate === predicate && a.toIri === l.toIri));
      } else keep.push(l);
    }
    from.links = keep;
  };

  def.rules.forEach((rule, i) => {
    const path = `rules.${i}`;
    const get = (name: string): WorkingObject | null => {
      const o = named.get(name);
      if (!o) return null;
      const w = touch(o);
      named.set(name, w);
      return w;
    };
    switch (rule.kind) {
      case "create_object": {
        const iri = String(renderTemplate(rule.iri, ctx) ?? "").trim();
        if (!IRI_TEXT.test(iri)) {
          problems.push({ code: "bad_iri", message: `The new object's IRI "${iri}" is not a valid IRI`, path });
          return;
        }
        if (working.has(iri) || [...input.objects.values()].some((o) => o.iri === iri && !o.deleted)) {
          problems.push({ code: "object_exists", message: `An object ${iri} already exists`, path });
          return;
        }
        const props: Record<string, ParamValue> = {};
        for (const [k, tpl] of Object.entries(rule.properties ?? {})) {
          const v = renderTemplate(tpl, ctx);
          if (v !== null && v !== "") props[k] = v;
        }
        const label = String(renderTemplate(rule.label, ctx) ?? "").trim() || iri;
        const moduleKey = rule.moduleKey ?? input.actionModuleKey;
        const w: WorkingObject = {
          iri,
          classIri: rule.classIri,
          moduleKey,
          label,
          props,
          links: [],
          namespaces: [moduleKey],
          deleted: false,
          created: true,
        };
        working.set(iri, w);
        named.set(rule.as, w);
        plan.creates.push({ alias: rule.as, iri, classIri: rule.classIri, moduleKey, label, props });
        return;
      }
      case "modify_object": {
        const w = get(rule.object);
        if (!w) return;
        if (w.deleted) {
          problems.push({ code: "object_deleted", message: `"${rule.object}" was deleted by an earlier rule`, path });
          return;
        }
        const created = plan.creates.find((c) => c.iri === w.iri);
        if (rule.label !== undefined && !isWholePlaceholderOfEmpty(rule.label, ctx)) {
          const to = String(renderTemplate(rule.label, ctx) ?? "").trim();
          if (to && to !== w.label) {
            if (created) created.label = to;
            else {
              const m = modifyEntry(w);
              m.label = { from: m.label?.from ?? w.label, to };
            }
            w.label = to;
          }
        }
        for (const [key, tpl] of Object.entries(rule.properties)) {
          const storedKey = findPropKey(w, key) ?? key;
          if (tpl === null) {
            if (!(storedKey in w.props)) continue;
            if (created) delete created.props[storedKey];
            else {
              const m = modifyEntry(w);
              if (storedKey in m.set) delete m.set[storedKey];
              else m.unset[storedKey] = w.props[storedKey];
            }
            delete w.props[storedKey];
            continue;
          }
          if (isWholePlaceholderOfEmpty(tpl, ctx)) continue;
          const to = renderTemplate(tpl, ctx);
          if (sameValue(w.props[storedKey], to)) continue;
          if (created) created.props[storedKey] = to;
          else {
            const m = modifyEntry(w);
            const from = storedKey in m.set ? m.set[storedKey].from : w.props[storedKey] ?? null;
            delete m.unset[storedKey];
            m.set[storedKey] = { from, to };
          }
          w.props[storedKey] = to;
        }
        return;
      }
      case "delete_object": {
        const w = get(rule.object);
        if (!w || w.deleted) return;
        if (w.created) {
          problems.push({ code: "delete_created", message: `"${rule.object}" is created by this action and cannot also be deleted`, path });
          return;
        }
        w.deleted = true;
        modified.delete(w.iri);
        plan.deletes.push({ id: w.id as number, iri: w.iri, label: w.label });
        return;
      }
      case "add_link":
      case "remove_link":
      case "set_link": {
        const from = get(rule.from);
        const to = rule.to !== undefined ? get(rule.to) : null;
        if (!from) return;
        if (from.deleted || to?.deleted) {
          problems.push({ code: "object_deleted", message: "a link to or from an object deleted by an earlier rule", path });
          return;
        }
        if (rule.kind === "add_link") {
          if (to) addLink(from, rule.predicate, to.iri);
        } else if (rule.kind === "remove_link") {
          if (to) removeLinks(from, rule.predicate, to.iri);
        } else {
          const target = to?.iri;
          const already = target !== undefined && from.links.some((l) => l.predicate === rule.predicate && l.toIri === target);
          for (const l of [...from.links]) {
            if (l.predicate === rule.predicate && l.toIri !== target) removeLinks(from, rule.predicate, l.toIri);
          }
          if (target !== undefined && !already) addLink(from, rule.predicate, target);
        }
        return;
      }
    }
  });

  plan.modifies = [...modified.values()].filter((m) => m.label || Object.keys(m.set).length || Object.keys(m.unset).length);
  // A link removed and added back by later rules is no change.
  plan.linkRemoves = plan.linkRemoves.filter(
    (r) => !plan.linkAdds.some((a) => a.fromIri === r.fromIri && a.predicate === r.predicate && a.toIri === r.toIri),
  );
  plan.linkAdds = plan.linkAdds.filter(
    (a) => !(input.objects.get(a.fromIri)?.links ?? []).some((l) => l.predicate === a.predicate && l.toIri === a.toIri),
  );
  // Links of a deleted object go with it.
  const deleted = new Set(plan.deletes.map((d) => d.iri));
  plan.linkAdds = plan.linkAdds.filter((a) => !deleted.has(a.fromIri) && !deleted.has(a.toIri));
  return { plan, problems, context: before };
}

/** The objects as they would be after the plan: created and modified ones, with their outgoing links. */
export function resultingObjects(
  plan: EditPlan,
  objects: Map<string, ObjectSnapshot>,
): { iri: string; classIri: string; moduleKey: string; label: string; props: Record<string, unknown>; links: { predicate: string; toIri: string }[] }[] {
  const out = new Map<string, { iri: string; classIri: string; moduleKey: string; label: string; props: Record<string, unknown>; links: { predicate: string; toIri: string }[] }>();
  for (const c of plan.creates) out.set(c.iri, { iri: c.iri, classIri: c.classIri, moduleKey: c.moduleKey, label: c.label, props: { ...c.props }, links: [] });
  for (const m of plan.modifies) {
    const o = objects.get(m.iri);
    if (!o) continue;
    const props = { ...o.props };
    for (const k of Object.keys(m.unset)) delete props[k];
    for (const [k, v] of Object.entries(m.set)) props[k] = v.to;
    out.set(m.iri, { iri: o.iri, classIri: o.classIri, moduleKey: o.moduleKey, label: m.label?.to ?? o.label, props, links: o.links.map(({ predicate, toIri }) => ({ predicate, toIri })) });
  }
  for (const a of plan.linkAdds) {
    const from = out.get(a.fromIri);
    if (from) from.links.push({ predicate: a.predicate, toIri: a.toIri });
  }
  for (const r of plan.linkRemoves) {
    const from = out.get(r.fromIri);
    if (from) from.links = from.links.filter((l) => !(l.predicate === r.predicate && l.toIri === r.toIri));
  }
  return [...out.values()];
}

/** The IRIs a definition's object parameters name in these values. */
export function objectParamIris(def: ActionDefinition, values: ParamValues): string[] {
  return def.parameters.filter((p) => p.type === "object").map((p) => values[p.name]).filter((v): v is string => typeof v === "string");
}

export { BUILTIN_PLACEHOLDERS };
