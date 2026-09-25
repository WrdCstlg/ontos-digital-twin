import { describe, expect, it } from "vitest";
import { actionDefinitionSchema, checkDefinition, type ActionDefinition, type ActionParameter } from "@contracts/actions";
import {
  checkObjectParams,
  checkSubmitter,
  coerceParams,
  evaluateCriteria,
  planEdits,
  planIsEmpty,
  renderTemplate,
  resultingObjects,
  type ObjectSnapshot,
  type TemplateContext,
} from "../services/actions/engine";

const NOW = new Date("2026-09-24T10:00:00Z");

function obj(iri: string, over: Partial<ObjectSnapshot> = {}): ObjectSnapshot {
  return {
    id: Math.abs([...iri].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)),
    iri,
    classIri: "hr:Person",
    moduleKey: "hr",
    label: iri.split("/").pop() ?? iri,
    props: {},
    deleted: false,
    links: [],
    namespaces: ["hr"],
    ...over,
  };
}

function objects(...os: ObjectSnapshot[]) {
  return new Map(os.map((o) => [o.iri, o]));
}

function def(partial: Partial<ActionDefinition> & Pick<ActionDefinition, "rules">): ActionDefinition {
  return actionDefinitionSchema.parse({ parameters: [], criteria: [], validation: { shacl: false }, sideEffects: [], ...partial });
}

const person = (name: string, required = true): ActionParameter => ({ name, label: name, type: "object", classIri: "hr:Person", required });

describe("coerceParams", () => {
  const params: ActionParameter[] = [
    { name: "n", label: "N", type: "number", required: true, min: 0, max: 10, integer: true },
    { name: "d", label: "D", type: "date", required: false },
    { name: "b", label: "B", type: "boolean", required: false },
    { name: "e", label: "E", type: "enum", options: ["a", "b"], required: false },
    { name: "o", label: "O", type: "object", classIri: "hr:Person", required: false },
    { name: "s", label: "S", type: "string", required: false, maxLength: 3 },
  ];

  it("gives values their declared types", () => {
    const { values, problems } = coerceParams(params, { n: "7", d: "2026-02-28", b: "true", e: "b", o: " hr:Person/E-1 ", s: "abc" });
    expect(problems).toEqual([]);
    expect(values).toEqual({ n: 7, d: "2026-02-28", b: true, e: "b", o: "hr:Person/E-1", s: "abc" });
  });

  it("reports each bad value, a missing required one and an unknown one", () => {
    const { values, problems } = coerceParams(params, { n: 3.5, d: "2026-02-30", e: "c", s: "abcd", extra: 1 });
    expect(problems.map((p) => [p.code, p.path])).toEqual([
      ["param_unknown", "params.extra"],
      ["param_invalid", "params.n"],
      ["param_invalid", "params.d"],
      ["param_invalid", "params.e"],
      ["param_invalid", "params.s"],
    ]);
    expect(values.b).toBeNull();
    expect(coerceParams(params, {}).problems).toEqual([expect.objectContaining({ code: "param_required", path: "params.n" })]);
    expect(coerceParams(params, { n: 11 }).problems[0].message).toBe("N: at most 10");
  });
});

describe("checkSubmitter", () => {
  it("lets a system admin through, and holds others to the role and the module scope", () => {
    expect(checkSubmitter({ userRole: "admin", memberRole: "viewer", moduleScope: ["legal"] }, "admin", "hr")).toBeNull();
    expect(checkSubmitter({ userRole: "user", memberRole: "viewer", moduleScope: null }, "editor", "hr")?.code).toBe("forbidden_role");
    expect(checkSubmitter({ userRole: "ontologist", memberRole: "viewer", moduleScope: null }, "ontologist", "hr")).toBeNull();
    expect(checkSubmitter({ userRole: "user", memberRole: "editor", moduleScope: ["legal"] }, "editor", "hr")?.code).toBe("forbidden_scope");
    expect(checkSubmitter({ userRole: "user", memberRole: "editor", moduleScope: '["hr"]' }, "editor", "hr")).toBeNull();
    expect(checkSubmitter({ userRole: "user", memberRole: "editor", moduleScope: [] }, "editor", "finance")).toBeNull();
  });
});

describe("checkObjectParams", () => {
  const ancestors = (c: string) => new Set(c === "hr:Contractor" ? ["hr:Person"] : []);
  it("accepts the class and its subclasses, and refuses missing, deleted and wrong-class objects", () => {
    const params = [person("a"), person("b"), person("c"), person("d")];
    const os = objects(
      obj("hr:Contractor/C-1", { classIri: "hr:Contractor" }),
      obj("hr:Person/E-2", { deleted: true }),
      obj("lgl:Contract/X", { classIri: "lgl:Contract" }),
    );
    const problems = checkObjectParams(params, { a: "hr:Contractor/C-1", b: "hr:Person/E-2", c: "lgl:Contract/X", d: "hr:Person/none" }, os, ancestors);
    expect(problems.map((p) => [p.code, p.path])).toEqual([
      ["object_not_found", "params.b"],
      ["object_wrong_class", "params.c"],
      ["object_not_found", "params.d"],
    ]);
  });
});

describe("renderTemplate", () => {
  const contract = obj("lgl:Contract/C-9", { classIri: "lgl:Contract", moduleKey: "legal", namespaces: ["legal", "lgl"], props: { status: "active", value: 5000 } });
  const ctx: TemplateContext = {
    values: { amount: 12, when: "2026-10-01", contract: contract.iri, empty: null },
    objects: new Map([["contract", contract]]),
    actor: "R. Alvarez",
    now: NOW,
  };

  it("keeps a lone placeholder's type and turns a mixed template into text", () => {
    expect(renderTemplate("{amount}", ctx)).toBe(12);
    expect(renderTemplate("{empty}", ctx)).toBeNull();
    expect(renderTemplate("#{amount} on {when} by {actor}", ctx)).toBe("#12 on 2026-10-01 by R. Alvarez");
    expect(renderTemplate("[{empty}]", ctx)).toBe("[]");
    expect(renderTemplate("{today}", ctx)).toBe("2026-09-24");
  });

  it("reads an object's IRI, label and properties, short or prefixed", () => {
    expect(renderTemplate("{contract}", ctx)).toBe("lgl:Contract/C-9");
    expect(renderTemplate("{contract.label}", ctx)).toBe("C-9");
    expect(renderTemplate("{contract.value}", ctx)).toBe(5000);
    expect(renderTemplate("{contract.lgl:status}", ctx)).toBe("active");
    expect(renderTemplate("{contract.missing}", ctx)).toBeNull();
  });
});

describe("evaluateCriteria", () => {
  const ctx: TemplateContext = {
    values: { a: "hr:Person/E-1", b: "hr:Person/E-1", n: 5, d: "2026-10-01", s: "draft" },
    objects: new Map(),
    actor: "x",
    now: NOW,
  };
  it("judges each kind of comparison", () => {
    const results = evaluateCriteria(
      [
        { kind: "distinct", a: "a", b: "b", message: "distinct" },
        { kind: "compare", left: "{n}", op: "eq", right: "5", message: "eq numeric" },
        { kind: "compare", left: "{s}", op: "in", right: ["active", "draft"], message: "in" },
        { kind: "compare", left: "{s}", op: "not_in", right: ["draft"], message: "not_in" },
        { kind: "compare", left: "{d}", op: "gt", right: "{today}", message: "date after today" },
        { kind: "compare", left: "{n}", op: "lte", right: 4, message: "lte" },
        { kind: "compare", left: "{s}", op: "gt", right: 3, message: "uncomparable" },
        { kind: "compare", left: "{missing}", op: "absent", message: "absent" },
        { kind: "compare", left: "{s}", op: "present", message: "present" },
      ],
      ctx,
    );
    expect(results.map((r) => [r.message, r.passed])).toEqual([
      ["distinct", false],
      ["eq numeric", true],
      ["in", true],
      ["not_in", false],
      ["date after today", true],
      ["lte", false],
      ["uncomparable", false],
      ["absent", true],
      ["present", true],
    ]);
    expect(results[6].detail).toMatch(/cannot be compared/);
  });
});

describe("planEdits", () => {
  const plan = (d: ActionDefinition, values: Record<string, string | number | null>, os: Map<string, ObjectSnapshot>) =>
    planEdits(d, { values, objects: os, actor: "R. Alvarez", now: NOW, actionModuleKey: "hr" });

  const reassign = def({
    parameters: [person("employee"), person("manager")],
    rules: [{ kind: "set_link", from: "employee", predicate: "hr:reportsTo", to: "manager" }],
  });

  it("replaces a reporting line, and changes nothing when it is already right", () => {
    const old = obj("hr:Person/M-OLD");
    const mgr = obj("hr:Person/M-NEW");
    const emp = obj("hr:Person/E-1", { links: [{ edgeId: 41, predicate: "hr:reportsTo", toIri: old.iri }, { edgeId: 42, predicate: "hr:memberOf", toIri: "hr:OrgUnit/X" }] });
    const { plan: p, problems } = plan(reassign, { employee: emp.iri, manager: mgr.iri }, objects(emp, mgr, old));
    expect(problems).toEqual([]);
    expect(p.linkRemoves).toEqual([{ edgeId: 41, fromIri: emp.iri, predicate: "hr:reportsTo", toIri: old.iri }]);
    expect(p.linkAdds).toEqual([{ fromIri: emp.iri, predicate: "hr:reportsTo", toIri: mgr.iri }]);

    const already = obj("hr:Person/E-2", { links: [{ edgeId: 43, predicate: "hr:reportsTo", toIri: mgr.iri }] });
    expect(planIsEmpty(plan(reassign, { employee: already.iri, manager: mgr.iri }, objects(already, mgr)).plan)).toBe(true);
  });

  it("creates an object, links it, and skips a link to an optional object left empty", () => {
    const d = def({
      parameters: [
        { name: "empId", label: "Id", type: "string", required: true },
        { name: "unit", label: "Unit", type: "object", classIri: "hr:OrgUnit", required: true },
        person("manager", false),
      ],
      rules: [
        { kind: "create_object", as: "p", classIri: "hr:Person", iri: "hr:Person/{empId}", label: "New {empId}", properties: { empId: "{empId}", status: "active" } },
        { kind: "add_link", from: "p", predicate: "hr:memberOf", to: "unit" },
        { kind: "add_link", from: "p", predicate: "hr:reportsTo", to: "manager" },
      ],
    });
    const unit = obj("hr:OrgUnit/OU-1", { classIri: "hr:OrgUnit" });
    const { plan: p, problems } = plan(d, { empId: "E-9", unit: unit.iri, manager: null }, objects(unit));
    expect(problems).toEqual([]);
    expect(p.creates).toEqual([
      { alias: "p", iri: "hr:Person/E-9", classIri: "hr:Person", moduleKey: "hr", label: "New E-9", props: { empId: "E-9", status: "active" } },
    ]);
    expect(p.linkAdds).toEqual([{ fromIri: "hr:Person/E-9", predicate: "hr:memberOf", toIri: unit.iri }]);
  });

  it("refuses an IRI that already exists or is not an IRI", () => {
    const d = def({
      parameters: [{ name: "id", label: "Id", type: "string", required: true }],
      rules: [{ kind: "create_object", as: "p", classIri: "hr:Person", iri: "hr:Person/{id}", label: "{id}" }],
    });
    const existing = obj("hr:Person/E-1");
    expect(plan(d, { id: "E-1" }, objects(existing)).problems[0].code).toBe("object_exists");
    expect(plan(d, { id: "has space" }, objects()).problems[0].code).toBe("bad_iri");
  });

  it("modifies properties under the key the object already uses, leaves empty optionals alone and unsets on null", () => {
    const d = def({
      parameters: [
        { name: "contract", label: "Contract", type: "object", classIri: "lgl:Contract", required: true },
        { name: "end", label: "End", type: "date", required: true },
        { name: "value", label: "Value", type: "number", required: false },
      ],
      rules: [{ kind: "modify_object", object: "contract", properties: { "lgl:endDate": "{end}", value: "{value}", note: null, renewedBy: "{actor}" } }],
    });
    const c = obj("lgl:Contract/C-1", { classIri: "lgl:Contract", moduleKey: "legal", namespaces: ["legal", "lgl"], props: { endDate: "2026-10-01", value: 100, note: "x" } });
    const { plan: p } = plan(d, { contract: c.iri, end: "2027-10-01", value: null }, objects(c));
    expect(p.modifies).toEqual([
      {
        id: c.id,
        iri: c.iri,
        set: { endDate: { from: "2026-10-01", to: "2027-10-01" }, renewedBy: { from: null, to: "R. Alvarez" } },
        unset: { note: "x" },
      },
    ]);
    expect(resultingObjects(p, objects(c))[0].props).toEqual({ endDate: "2027-10-01", value: 100, renewedBy: "R. Alvarez" });
  });

  it("deletes an existing object but not one it creates", () => {
    const d = def({ parameters: [person("x")], rules: [{ kind: "delete_object", object: "x" }] });
    const x = obj("hr:Person/E-5", { label: "Five" });
    expect(plan(d, { x: x.iri }, objects(x)).plan.deletes).toEqual([{ id: x.id, iri: x.iri, label: "Five" }]);

    const both = def({
      parameters: [],
      rules: [
        { kind: "create_object", as: "n", classIri: "hr:Person", iri: "hr:Person/NEW", label: "n" },
        { kind: "delete_object", object: "n" },
      ],
    });
    expect(plan(both, {}, objects()).problems[0].code).toBe("delete_created");
  });

  it("hands back a context in which criteria see the objects before the edits", () => {
    const d = def({
      parameters: [{ name: "contract", label: "Contract", type: "object", classIri: "lgl:Contract", required: true }, { name: "end", label: "End", type: "date", required: true }],
      criteria: [{ kind: "compare", left: "{end}", op: "gt", right: "{contract.endDate}", message: "later than now" }],
      rules: [{ kind: "modify_object", object: "contract", properties: { endDate: "{end}", status: "renewed" } }],
    });
    const c = obj("lgl:Contract/C-2", { classIri: "lgl:Contract", props: { endDate: "2026-10-09", status: "active" } });
    const { plan: p, context } = plan(d, { contract: c.iri, end: "2027-10-30" }, objects(c));
    expect(p.modifies[0].set.endDate).toEqual({ from: "2026-10-09", to: "2027-10-30" });
    expect(evaluateCriteria(d.criteria, context)).toEqual([expect.objectContaining({ passed: true })]);
    expect(renderTemplate("{contract.status}", context)).toBe("active");
  });

  it("treats removing and re-adding the same link as no change", () => {
    const d = def({
      parameters: [person("a"), person("b")],
      rules: [
        { kind: "remove_link", from: "a", predicate: "hr:reportsTo", to: "b" },
        { kind: "add_link", from: "a", predicate: "hr:reportsTo", to: "b" },
      ],
    });
    const b = obj("hr:Person/B");
    const a = obj("hr:Person/A", { links: [{ edgeId: 7, predicate: "hr:reportsTo", toIri: b.iri }] });
    expect(planIsEmpty(plan(d, { a: a.iri, b: b.iri }, objects(a, b)).plan)).toBe(true);
  });
});

describe("checkDefinition", () => {
  it("finds names that do not resolve, duplicates and rules that change nothing", () => {
    const problems = checkDefinition(
      def({
        parameters: [person("a"), person("a"), { name: "s", label: "S", type: "string", required: true }],
        criteria: [{ kind: "compare", left: "{s.x}", op: "in", right: "not a list", message: "m" }],
        rules: [
          { kind: "modify_object", object: "s", properties: {} },
          { kind: "add_link", from: "a", predicate: "hr:x", to: "ghost" },
          { kind: "create_object", as: "a", classIri: "hr:Person", iri: "hr:Person/{nope}", label: "x" },
        ],
      }),
    );
    expect(problems.map((p) => p.path)).toEqual([
      "parameters.1.name",
      "criteria.0.left",
      "criteria.0.right",
      "rules.0.object",
      "rules.0",
      "rules.1.to",
      "rules.2.iri",
      "rules.2.as",
    ]);
  });
});
