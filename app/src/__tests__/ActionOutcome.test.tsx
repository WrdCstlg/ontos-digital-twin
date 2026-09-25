// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ActionDefinition } from "@contracts/actions";
import { OutcomeView } from "../components/actions/OutcomeView";
import { DefinitionView } from "../components/actions/DefinitionView";
import type { PlanLike } from "../components/actions/words";

// This vitest setup has no globals, so testing-library does not unmount on its own.
afterEach(cleanup);

const plan: PlanLike = {
  created: [{ iri: "hr:Person/E-0421", classIri: "hr:Person", label: "Grace Hopper" }],
  modified: [
    {
      iri: "lgl:Contract/C-0042",
      label: { from: "Old name", to: "New name" },
      set: { endDate: { from: "2026-10-01", to: "2027-10-01" }, value: { from: null, to: 125000 } },
      unset: ["note"],
    },
  ],
  deleted: [{ iri: "hr:Person/E-0999", label: "Gone Person" }],
  linksAdded: [{ from: "hr:Person/E-0101", predicate: "hr:reportsTo", to: "hr:Person/E-0007" }],
  linksRemoved: [{ from: "hr:Person/E-0101", predicate: "hr:reportsTo", to: "hr:Person/E-0003" }],
};

const criteria = [
  { index: 0, message: "Only an active contract can be renewed", passed: true, detail: '"active" against "active"' },
  { index: 1, message: "The new end date must be after the current one", passed: false, detail: '"2026-09-01" against "2026-10-01"' },
];

function renderOutcome(props: Partial<Parameters<typeof OutcomeView>[0]> = {}) {
  return render(
    <MemoryRouter>
      <OutcomeView
        problems={[
          { code: "criterion_failed", message: "The new end date must be after the current one", path: "criteria.1" },
          { code: "param_invalid", message: "New total value: at least 0", path: "params.value" },
        ]}
        criteria={criteria}
        plan={plan}
        shacl={{ status: "skipped", violations: [] }}
        declaredCriteria={2}
        shaclEnabled={false}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("action preview", () => {
  it("shows each criterion as passed or failed, with what was compared", () => {
    renderOutcome();
    const items = within(screen.getByRole("list", { name: "Criteria" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("data-passed")).toBe("true");
    expect(within(items[0]).getByLabelText("passed")).toBeTruthy();
    expect(items[0].textContent).toContain("Only an active contract can be renewed");
    expect(items[1].getAttribute("data-passed")).toBe("false");
    expect(within(items[1]).getByLabelText("failed")).toBeTruthy();
    expect(items[1].textContent).toContain('"2026-09-01" against "2026-10-01"');
  });

  it("lists problems other than failed criteria once", () => {
    renderOutcome();
    const problems = screen.getByRole("list", { name: "Problems" });
    expect(problems.textContent).toContain("New total value: at least 0");
    expect(problems.textContent).not.toContain("The new end date must be after");
  });

  it("shows planned changes: created, before → after, removed, deleted and links", () => {
    renderOutcome();
    const changes = screen.getByLabelText("Planned changes");
    expect(changes.textContent).toContain("Grace Hopper");
    expect(changes.textContent).toContain("a hr:Person");

    const endDate = screen.getByTestId("change-endDate");
    expect(endDate.textContent).toContain("2026-10-01");
    expect(endDate.textContent).toContain("2027-10-01");
    expect(within(endDate).getByLabelText("becomes")).toBeTruthy();
    expect(screen.getByTestId("change-value").textContent).toMatch(/nothing.*125000/);
    expect(screen.getByTestId("change-note").textContent).toContain("removed");
    expect(changes.textContent).toMatch(/Old name.*New name/);

    expect(changes.textContent).toContain("Gone Person");
    expect(changes.textContent).toContain("hr:Person/E-0101 —hr:reportsTo→ hr:Person/E-0007");
    expect(changes.textContent).toContain("hr:Person/E-0101 —hr:reportsTo→ hr:Person/E-0003");
  });

  it("links only objects that exist to the Explorer: not ones yet to be created, nor deleted ones", () => {
    renderOutcome();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/app/explorer?iri=lgl%3AContract%2FC-0042");
    expect(hrefs).not.toContain("/app/explorer?iri=hr%3APerson%2FE-0421");
    expect(hrefs).not.toContain("/app/explorer?iri=hr%3APerson%2FE-0999");
  });

  it("links created objects once the action has been applied", () => {
    renderOutcome({ applied: true, problems: [] });
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toContain("/app/explorer?iri=hr%3APerson%2FE-0421");
    expect(screen.getByText("Changes made")).toBeTruthy();
  });

  it("explains SHACL violations with their remediation", () => {
    renderOutcome({
      shacl: {
        status: "violations",
        violations: [
          {
            focusNode: "hr:Person/E-0421",
            path: "hr:email",
            severity: "Violation",
            message: "Work email must be an @acme.com address",
            remediation: "Use the person's @acme.com address",
          },
        ],
      },
    });
    const list = screen.getByRole("list", { name: "SHACL violations" });
    expect(list.textContent).toContain("Work email must be an @acme.com address");
    expect(list.textContent).toContain("Fix: Use the person's @acme.com address");
    expect(screen.getByText(/violates its classes’ SHACL shapes/)).toBeTruthy();
  });

  it("says when criteria were not evaluated and nothing would change", () => {
    renderOutcome({
      criteria: [],
      plan: { created: [], modified: [], deleted: [], linksAdded: [], linksRemoved: [] },
      shacl: { status: "skipped", violations: [] },
    });
    expect(screen.getByText("Not evaluated: the parameters have to be valid first.")).toBeTruthy();
    expect(screen.getByText("Nothing would change.")).toBeTruthy();
    expect(screen.getByText(/does not validate against SHACL/)).toBeTruthy();
  });
});

describe("definition view", () => {
  it("renders parameters, criteria, rules in words, SHACL and side effects", () => {
    const definition: ActionDefinition = {
      parameters: [
        { name: "employee", label: "Employee", type: "object", classIri: "hr:Person", required: true },
        { name: "manager", label: "New manager", type: "object", classIri: "hr:Person", required: true },
      ],
      criteria: [{ kind: "distinct", a: "employee", b: "manager", message: "A person cannot report to themselves" }],
      rules: [{ kind: "set_link", from: "employee", predicate: "hr:reportsTo", to: "manager" }],
      validation: { shacl: true },
      sideEffects: [{ kind: "webhook", url: "https://hooks.example.com/hr", description: "Tell payroll" }],
    };
    render(<DefinitionView definition={definition} />);
    expect(within(screen.getByRole("list", { name: "Parameters" })).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("list", { name: "Criteria" }).textContent).toContain(
      "Employee and New manager are different objects",
    );
    expect(screen.getByRole("list", { name: "Rules" }).textContent).toContain(
      "Replace Employee's hr:reportsTo link with one to New manager",
    );
    expect(screen.getByText(/SHACL on/)).toBeTruthy();
    expect(screen.getByText("POST https://hooks.example.com/hr")).toBeTruthy();
    expect(screen.getByText("Tell payroll")).toBeTruthy();
  });
});
