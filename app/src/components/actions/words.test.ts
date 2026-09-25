import { describe, expect, it } from "vitest";
import { actionDefinitionSchema, checkDefinition, type ActionDefinition } from "@contracts/actions";
import {
  asPlan,
  asProblems,
  describeCriterion,
  describeParameterType,
  describeRule,
  listWords,
  nameOf,
  planCounts,
  summariseSubmission,
  templateWords,
  touchedObjectIris,
  valueWords,
  type PlanLike,
} from "./words";

/** Definitions shaped like the seeded ones, checked the way the API checks them. */
function def(d: ActionDefinition): ActionDefinition {
  const parsed = actionDefinitionSchema.parse(d);
  expect(checkDefinition(parsed)).toEqual([]);
  return parsed;
}

const reassign = def({
  parameters: [
    { name: "employee", label: "Employee", type: "object", classIri: "hr:Person", required: true },
    { name: "manager", label: "New manager", type: "object", classIri: "hr:Person", required: true },
    { name: "effectiveDate", label: "Effective date", type: "date", required: true },
  ],
  criteria: [
    { kind: "distinct", a: "employee", b: "manager", message: "A person cannot report to themselves" },
    { kind: "compare", left: "{employee.status}", op: "neq", right: "terminated", message: "The employee has left" },
  ],
  rules: [
    { kind: "set_link", from: "employee", predicate: "hr:reportsTo", to: "manager" },
    { kind: "modify_object", object: "employee", properties: { managerSince: "{effectiveDate}" } },
  ],
  validation: { shacl: false },
  sideEffects: [],
});

const renew = def({
  parameters: [
    { name: "contract", label: "Contract", type: "object", classIri: "lgl:Contract", required: true },
    { name: "newEndDate", label: "New end date", type: "date", required: true },
    { name: "value", label: "New total value", type: "number", required: false, min: 0 },
  ],
  criteria: [
    { kind: "compare", left: "{contract.status}", op: "eq", right: "active", message: "Only an active contract" },
    { kind: "compare", left: "{newEndDate}", op: "gt", right: "{contract.endDate}", message: "Later than now" },
    { kind: "compare", left: "{value}", op: "lte", right: 1000000, message: "At most a million" },
  ],
  rules: [
    {
      kind: "modify_object",
      object: "contract",
      properties: { endDate: "{newEndDate}", value: "{value}", renewedBy: "{actor}", renewedOn: "{today}", oldNote: null },
    },
  ],
  validation: { shacl: false },
  sideEffects: [],
});

const onboard = def({
  parameters: [
    { name: "empId", label: "Employee ID", type: "string", required: true, maxLength: 16 },
    { name: "fullName", label: "Full name", type: "string", required: true },
    { name: "unit", label: "Org unit", type: "object", classIri: "hr:OrgUnit", required: true },
    { name: "manager", label: "Manager", type: "object", classIri: "hr:Person", required: false },
    { name: "reason", label: "Reason", type: "enum", options: ["hire", "transfer", "rehire"], required: false },
  ],
  criteria: [
    { kind: "compare", left: "{manager.isCeo}", op: "absent", message: "Not under the CEO" },
    { kind: "compare", left: "{reason}", op: "in", right: ["hire", "rehire"], message: "A hire" },
  ],
  rules: [
    {
      kind: "create_object",
      as: "person",
      classIri: "hr:Person",
      iri: "hr:Person/{empId}",
      label: "{fullName}",
      properties: { empId: "{empId}", status: "active" },
    },
    { kind: "add_link", from: "person", predicate: "hr:memberOf", to: "unit" },
    { kind: "add_link", from: "person", predicate: "hr:reportsTo", to: "manager" },
    { kind: "remove_link", from: "manager", predicate: "hr:vacancyIn", to: "unit" },
    { kind: "set_link", from: "unit", predicate: "hr:headcountReviewer" },
    { kind: "delete_object", object: "manager" },
  ],
  validation: { shacl: true },
  sideEffects: [{ kind: "webhook", url: "https://hooks.example.com/onboard" }],
});

describe("rules in words", () => {
  it("names parameters by their labels, as in the Actions page's example", () => {
    expect(describeRule(reassign.rules[0], reassign)).toBe("Replace Employee's hr:reportsTo link with one to New manager");
    expect(describeRule(reassign.rules[1], reassign)).toBe("Update Employee: set managerSince to Effective date");
  });

  it("reads built-ins, quotes literals and lists removals", () => {
    expect(describeRule(renew.rules[0], renew)).toBe(
      "Update Contract: set endDate to New end date, value to New total value, renewedBy to the submitter and renewedOn to today; remove oldNote",
    );
  });

  it("describes a created object, and refers to it later as the new object of its class", () => {
    expect(describeRule(onboard.rules[0], onboard)).toBe(
      "Create a new hr:Person with IRI “hr:Person/{Employee ID}” and label Full name, setting empId to Employee ID and status to “active”",
    );
    expect(describeRule(onboard.rules[1], onboard)).toBe("Link the new Person to Org unit with hr:memberOf");
  });

  it("says when a rule is skipped because an optional object parameter is empty", () => {
    expect(describeRule(onboard.rules[2], onboard)).toBe(
      "Link the new Person to Manager with hr:reportsTo (skipped when Manager is left empty)",
    );
    expect(describeRule(onboard.rules[5], onboard)).toBe("Delete Manager (skipped when Manager is left empty)");
  });

  it("covers removing one link, removing every link, and a label change", () => {
    expect(describeRule(onboard.rules[3], onboard)).toBe(
      "Remove Manager's hr:vacancyIn link to Org unit (skipped when Manager is left empty)",
    );
    expect(describeRule(onboard.rules[4], onboard)).toBe("Remove every hr:headcountReviewer link from Org unit");
    expect(
      describeRule({ kind: "modify_object", object: "employee", label: "{employee.fullName} (left)", properties: {} }, reassign),
    ).toBe("Update Employee: rename it to “{Employee's fullName} (left)”");
  });

  it("tells created objects of the same class apart by their alias", () => {
    const two = def({
      ...onboard,
      rules: [
        onboard.rules[0],
        { kind: "create_object", as: "buddy", classIri: "hr:Person", iri: "hr:Person/{empId}-b", label: "Buddy" },
        { kind: "add_link", from: "person", predicate: "hr:buddy", to: "buddy" },
      ],
    });
    expect(nameOf("buddy", two)).toBe("the new Person “buddy”");
    expect(describeRule(two.rules[2], two)).toBe("Link the new Person “person” to the new Person “buddy” with hr:buddy");
  });
});

describe("templates and criteria in words", () => {
  it("reads a single placeholder as what it names, and quotes mixed text", () => {
    expect(templateWords("{contract.endDate}", renew)).toBe("Contract's endDate");
    expect(templateWords("{now}", renew)).toBe("now");
    expect(templateWords("terminated", renew)).toBe("“terminated”");
    expect(templateWords("Renewed by {actor} on {today}", renew)).toBe("“Renewed by {the submitter} on {today}”");
  });

  it("describes each kind of criterion", () => {
    expect(describeCriterion(reassign.criteria[0], reassign)).toBe("Employee and New manager are different objects");
    expect(describeCriterion(reassign.criteria[1], reassign)).toBe("Employee's status is not “terminated”");
    expect(describeCriterion(renew.criteria[0], renew)).toBe("Contract's status is “active”");
    expect(describeCriterion(renew.criteria[2], renew)).toBe("New total value is at most 1000000");
    expect(describeCriterion(onboard.criteria[0], onboard)).toBe("Manager's isCeo is empty");
    expect(describeCriterion(onboard.criteria[1], onboard)).toBe("Reason is one of “hire” or “rehire”");
  });

  it("compares dates as before and after", () => {
    expect(describeCriterion(renew.criteria[1], renew)).toBe("New end date is after Contract's endDate");
    expect(
      describeCriterion({ kind: "compare", left: "{newEndDate}", op: "lte", right: "{today}", message: "x" }, renew),
    ).toBe("New end date is on or before today");
  });
});

describe("parameter types in words", () => {
  it("covers every type", () => {
    expect(describeParameterType(onboard.parameters[0])).toBe("Text, up to 16 characters");
    expect(describeParameterType(onboard.parameters[1])).toBe("Text");
    expect(describeParameterType(renew.parameters[2])).toBe("Number, at least 0");
    expect(describeParameterType({ name: "n", label: "N", type: "number", required: true, integer: true, min: 1, max: 5 })).toBe(
      "Whole number, 1 to 5",
    );
    expect(describeParameterType({ name: "b", label: "B", type: "boolean", required: false })).toBe("Yes or no");
    expect(describeParameterType(reassign.parameters[2])).toBe("Date");
    expect(describeParameterType(onboard.parameters[4])).toBe("One of “hire”, “transfer” or “rehire”");
    expect(describeParameterType(reassign.parameters[0])).toBe("Object: hr:Person or a subclass");
  });

  it("joins lists the way a sentence does", () => {
    expect(listWords([])).toBe("");
    expect(listWords(["a"])).toBe("a");
    expect(listWords(["a", "b"])).toBe("a and b");
    expect(listWords(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("submission summaries", () => {
  const plan: PlanLike = {
    created: [],
    modified: [{ iri: "hr:Person/E-0101", set: { managerSince: { from: null, to: "2026-10-01" } }, unset: [] }],
    deleted: [],
    linksAdded: [{ from: "hr:Person/E-0101", predicate: "hr:reportsTo", to: "hr:Person/E-0007" }],
    linksRemoved: [{ from: "hr:Person/E-0101", predicate: "hr:reportsTo", to: "hr:Person/E-0003" }],
  };

  it("counts what an applied submission changed", () => {
    expect(planCounts(plan)).toBe("changed 1 object, added 1 link, removed 1 link");
    expect(summariseSubmission({ status: "applied", resultJson: plan, errorsJson: null })).toBe(
      "Changed 1 object, added 1 link, removed 1 link",
    );
    expect(summariseSubmission({ status: "applied", resultJson: { odd: true }, errorsJson: null })).toBe("Applied");
  });

  it("gives a rejection's first reason and how many more there are", () => {
    const errors = [
      { code: "criterion_failed", message: "A person cannot report to themselves", path: "criteria.0" },
      { code: "param_required", message: "Effective date is required", path: "params.effectiveDate" },
    ];
    expect(summariseSubmission({ status: "rejected", resultJson: null, errorsJson: errors })).toBe(
      "A person cannot report to themselves (+1 more)",
    );
    expect(summariseSubmission({ status: "rejected", resultJson: null, errorsJson: [] })).toBe("Rejected");
    expect(asProblems([{ message: "x" }, "junk", null])).toEqual([{ code: "problem", message: "x", path: undefined }]);
  });

  it("lists the objects to open afterwards, without deleted ones", () => {
    expect(touchedObjectIris(plan)).toEqual(["hr:Person/E-0101"]);
    const withDelete: PlanLike = {
      ...plan,
      created: [{ iri: "hr:Person/E-0421", classIri: "hr:Person", label: "New Hire" }],
      deleted: [{ iri: "hr:Person/E-0101", label: "Gone" }],
    };
    expect(touchedObjectIris(withDelete)).toEqual(["hr:Person/E-0421"]);
    expect(asPlan(null)).toBeNull();
    expect(asPlan(plan)).toBe(plan);
  });

  it("shows values plainly", () => {
    expect(valueWords(null)).toBe("nothing");
    expect(valueWords("")).toBe("nothing");
    expect(valueWords(12)).toBe("12");
    expect(valueWords(false)).toBe("false");
    expect(valueWords({ a: 1 })).toBe('{"a":1}');
  });
});
