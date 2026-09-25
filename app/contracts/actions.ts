import { z } from "zod";

/**
 * Action types: named, parameterised edits to the knowledge graph. A
 * definition declares its parameters, the criteria a submission must meet, the
 * edits it makes, whether the result is checked against the classes' SHACL
 * shapes, and side effects the worker runs after the edits commit.
 *
 * Shared by the API (which validates and applies definitions) and the web app
 * (which edits them and builds submission forms from them).
 *
 * Templates are strings with `{name}` placeholders. `{param}` is a parameter's
 * value; for an object parameter or a created object's alias it is the
 * object's IRI, and `{param.label}` / `{param.someProperty}` read the object.
 * Built-ins: `{actor}` (who submitted), `{today}` (YYYY-MM-DD) and `{now}`
 * (ISO timestamp). A template that is exactly one placeholder keeps the value's
 * type, so `"{amount}"` stays a number.
 */

export const ACTION_ROLES = ["viewer", "editor", "ontologist", "admin"] as const;
export type ActionRole = (typeof ACTION_ROLES)[number];

export const ACTION_STATUSES = ["active", "draft", "disabled"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const SUBMISSION_STATUSES = ["applied", "rejected"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const BUILTIN_PLACEHOLDERS = ["actor", "today", "now"] as const;

/** Keys name action types in URLs and the API: lower-case words joined by hyphens. */
export const actionKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "lower-case words joined by hyphens, e.g. renew-contract")
  .max(64);

const identifier = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "letters, digits and underscores, starting with a letter")
  .max(64);

/** A prefixed name (hr:reportsTo) or an absolute IRI. */
const iri = z
  .string()
  .min(3)
  .max(512)
  .regex(/^[A-Za-z][\w.+-]*:\S+$/, "a prefixed name such as hr:Person or an absolute IRI");

/** A property key as it appears on an object: prefixed (hr:email) or local (email). */
const propertyKey = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z][\w.+-]*(:\S+)?$/, "a property such as hr:email, or email");

const template = z.string().max(1024);

const paramBase = {
  name: identifier,
  label: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  required: z.boolean(),
};

export const actionParameterSchema = z.discriminatedUnion("type", [
  z.object({ ...paramBase, type: z.literal("string"), maxLength: z.number().int().min(1).max(10_000).optional() }),
  z.object({
    ...paramBase,
    type: z.literal("number"),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
  }),
  z.object({ ...paramBase, type: z.literal("boolean") }),
  z.object({ ...paramBase, type: z.literal("date") }),
  z.object({ ...paramBase, type: z.literal("enum"), options: z.array(z.string().min(1).max(128)).min(1).max(100) }),
  z.object({ ...paramBase, type: z.literal("object"), classIri: iri }),
]);
export type ActionParameter = z.infer<typeof actionParameterSchema>;
export type ActionParameterType = ActionParameter["type"];

export const COMPARISON_OPS = ["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "present", "absent"] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];

export const actionCriterionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("compare"),
    /** A template, e.g. "{contract.status}" or "{newEndDate}". */
    left: template,
    op: z.enum(COMPARISON_OPS),
    /** A literal, a template such as "{today}", or a list for in / not_in. Unused by present / absent. */
    right: z.union([template, z.number(), z.boolean(), z.array(z.string().max(128)).max(100)]).optional(),
    message: z.string().min(1).max(300),
  }),
  z.object({
    kind: z.literal("distinct"),
    /** Two object parameters that must not be the same object. */
    a: identifier,
    b: identifier,
    message: z.string().min(1).max(300),
  }),
]);
export type ActionCriterion = z.infer<typeof actionCriterionSchema>;

/** Property values to write: a template, or null to remove the property. */
const propertyValues = z.record(propertyKey, z.union([template, z.null()]));

export const actionRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_object"),
    /** Name later rules and templates use for the new object. */
    as: identifier,
    classIri: iri,
    /** Module the object belongs to; defaults to the action type's module. */
    moduleKey: z.string().max(64).optional(),
    iri: template,
    label: template,
    properties: z.record(propertyKey, template).optional(),
  }),
  z.object({
    kind: z.literal("modify_object"),
    /** An object parameter or a created object's alias. */
    object: identifier,
    label: template.optional(),
    properties: propertyValues,
  }),
  z.object({ kind: z.literal("delete_object"), object: identifier }),
  z.object({ kind: z.literal("add_link"), from: identifier, predicate: iri, to: identifier }),
  z.object({ kind: z.literal("remove_link"), from: identifier, predicate: iri, to: identifier }),
  z.object({
    kind: z.literal("set_link"),
    /** Replaces every `predicate` link from `from` with one to `to`; with `to` empty, removes them all. */
    from: identifier,
    predicate: iri,
    to: identifier.optional(),
  }),
]);
export type ActionRule = z.infer<typeof actionRuleSchema>;
export type ActionRuleKind = ActionRule["kind"];

export const actionSideEffectSchema = z.object({
  kind: z.literal("webhook"),
  /** Receives a POST with the submission as JSON after the edits commit. */
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), "http or https"),
  description: z.string().max(300).optional(),
});
export type ActionSideEffect = z.infer<typeof actionSideEffectSchema>;

export const actionDefinitionSchema = z.object({
  parameters: z.array(actionParameterSchema).max(20),
  criteria: z.array(actionCriterionSchema).max(20),
  rules: z.array(actionRuleSchema).min(1).max(30),
  validation: z.object({ shacl: z.boolean() }),
  sideEffects: z.array(actionSideEffectSchema).max(5),
});
export type ActionDefinition = z.infer<typeof actionDefinitionSchema>;

/** The placeholders a template uses: `{a}` gives ["a"], `{a.b}` gives ["a.b"]. */
export function placeholders(tpl: string): string[] {
  return [...tpl.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1].trim());
}

export type DefinitionProblem = { path: string; message: string };

/**
 * Structural checks zod cannot express: unique names, references that resolve
 * to an object parameter or an earlier alias, and placeholders that name
 * something. Returns every problem, not just the first.
 */
export function checkDefinition(def: ActionDefinition): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];
  const params = new Map<string, ActionParameter>();
  def.parameters.forEach((p, i) => {
    if (params.has(p.name)) problems.push({ path: `parameters.${i}.name`, message: `"${p.name}" is used twice` });
    if ((BUILTIN_PLACEHOLDERS as readonly string[]).includes(p.name)) {
      problems.push({ path: `parameters.${i}.name`, message: `"${p.name}" is a built-in placeholder` });
    }
    if (p.type === "number" && p.min !== undefined && p.max !== undefined && p.min > p.max) {
      problems.push({ path: `parameters.${i}`, message: "min is greater than max" });
    }
    params.set(p.name, p);
  });

  const objectParams = new Set([...params.values()].filter((p) => p.type === "object").map((p) => p.name));
  const aliases = new Set<string>();

  const checkTemplate = (tpl: string, path: string) => {
    for (const ph of placeholders(tpl)) {
      const [head, ...rest] = ph.split(".");
      if ((BUILTIN_PLACEHOLDERS as readonly string[]).includes(head) && rest.length === 0) continue;
      if (aliases.has(head)) continue;
      const p = params.get(head);
      if (!p) {
        problems.push({ path, message: `{${ph}} names no parameter, created object or built-in` });
      } else if (rest.length > 0 && p.type !== "object") {
        problems.push({ path, message: `{${ph}} reads a property of "${head}", which is not an object parameter` });
      }
    }
  };
  const checkRef = (name: string, path: string) => {
    if (!objectParams.has(name) && !aliases.has(name)) {
      problems.push({ path, message: `"${name}" is neither an object parameter nor an object created by an earlier rule` });
    }
  };

  def.criteria.forEach((c, i) => {
    if (c.kind === "compare") {
      checkTemplate(c.left, `criteria.${i}.left`);
      if (typeof c.right === "string") checkTemplate(c.right, `criteria.${i}.right`);
      const needsRight = c.op !== "present" && c.op !== "absent";
      if (needsRight && c.right === undefined) problems.push({ path: `criteria.${i}.right`, message: `${c.op} needs a right-hand side` });
      if ((c.op === "in" || c.op === "not_in") && !Array.isArray(c.right)) {
        problems.push({ path: `criteria.${i}.right`, message: `${c.op} needs a list` });
      }
    } else {
      checkRef(c.a, `criteria.${i}.a`);
      checkRef(c.b, `criteria.${i}.b`);
    }
  });

  def.rules.forEach((r, i) => {
    const at = `rules.${i}`;
    switch (r.kind) {
      case "create_object":
        checkTemplate(r.iri, `${at}.iri`);
        checkTemplate(r.label, `${at}.label`);
        for (const [k, v] of Object.entries(r.properties ?? {})) checkTemplate(v, `${at}.properties.${k}`);
        if (params.has(r.as) || aliases.has(r.as)) problems.push({ path: `${at}.as`, message: `"${r.as}" is already a name` });
        aliases.add(r.as);
        break;
      case "modify_object":
        checkRef(r.object, `${at}.object`);
        if (r.label !== undefined) checkTemplate(r.label, `${at}.label`);
        for (const [k, v] of Object.entries(r.properties)) if (v !== null) checkTemplate(v, `${at}.properties.${k}`);
        if (r.label === undefined && Object.keys(r.properties).length === 0) {
          problems.push({ path: at, message: "changes nothing: give a label or at least one property" });
        }
        break;
      case "delete_object":
        checkRef(r.object, `${at}.object`);
        break;
      case "add_link":
      case "remove_link":
        checkRef(r.from, `${at}.from`);
        checkRef(r.to, `${at}.to`);
        break;
      case "set_link":
        checkRef(r.from, `${at}.from`);
        if (r.to !== undefined) checkRef(r.to, `${at}.to`);
        break;
    }
  });

  return problems;
}
