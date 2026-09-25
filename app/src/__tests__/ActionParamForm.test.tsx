// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActionParameter } from "@contracts/actions";
import { ParamForm } from "../components/actions/ParamForm";
import { emptyValues } from "../components/actions/form";

/** graph.searchNodes, answered from a fixed set of objects; records what it was asked. */
const graph = vi.hoisted(() => {
  const nodes = [
    { id: 1, iri: "hr:Person/E-0101", label: "Ada Byron", classIri: "hr:Person", moduleKey: "hr" },
    { id: 2, iri: "hr:Person/E-0102", label: "Alan Turing", classIri: "hr:Employee", moduleKey: "hr" },
  ];
  const calls: { q: string; classIri?: string }[] = [];
  return { nodes, calls };
});

vi.mock("@/providers/trpc", () => ({
  trpc: {
    graph: {
      searchNodes: {
        useQuery: (input: { q: string; classIri?: string }, opts?: { enabled?: boolean }) => {
          if (opts?.enabled === false) return { data: undefined, isLoading: false, isFetching: false };
          graph.calls.push(input);
          const q = input.q.toLowerCase();
          const data = graph.nodes.filter((n) => `${n.label} ${n.iri}`.toLowerCase().includes(q));
          return { data, isLoading: false, isFetching: false };
        },
      },
    },
  },
}));

const PARAMS: ActionParameter[] = [
  { name: "employee", label: "Employee", type: "object", classIri: "hr:Person", required: true, description: "Who is leaving." },
  { name: "fullName", label: "Full name", type: "string", required: true, maxLength: 200 },
  { name: "note", label: "Note", type: "string", required: false, maxLength: 500 },
  { name: "severance", label: "Severance", type: "number", required: false, min: 0, integer: true },
  { name: "rehire", label: "Eligible for rehire", type: "boolean", required: false },
  { name: "lastDay", label: "Last working day", type: "date", required: true },
  { name: "reason", label: "Reason", type: "enum", options: ["resignation", "retirement", "dismissal"], required: true },
];

beforeAll(() => {
  // Radix measures some controls; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

// This vitest setup has no globals, so testing-library does not unmount on its own.
afterEach(() => {
  cleanup();
  graph.calls.length = 0;
});

function renderForm(values = emptyValues(PARAMS), errors?: Record<string, string[]>) {
  const onChange = vi.fn();
  render(<ParamForm parameters={PARAMS} values={values} onChange={onChange} errors={errors} />);
  return onChange;
}

describe("ParamForm", () => {
  it("renders a control for each parameter type", () => {
    renderForm();
    expect((screen.getByRole("textbox", { name: /Full name/ }) as HTMLInputElement).type).toBe("text");
    expect(screen.getByRole("textbox", { name: /Note/ }).tagName).toBe("TEXTAREA");
    const severance = screen.getByRole("spinbutton", { name: /Severance/ }) as HTMLInputElement;
    expect(severance.min).toBe("0");
    expect(severance.step).toBe("1");
    expect(screen.getByRole("switch", { name: /Eligible for rehire/ }).getAttribute("aria-checked")).toBe("false");
    expect((screen.getByLabelText(/Last working day/) as HTMLInputElement).type).toBe("date");
    const reason = screen.getByRole("combobox", { name: /Reason/ });
    expect(reason.tagName).toBe("SELECT");
    expect(within(reason).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose…",
      "resignation",
      "retirement",
      "dismissal",
    ]);
    const picker = screen.getByRole("combobox", { name: /Employee/ }) as HTMLInputElement;
    expect(picker.tagName).toBe("INPUT");
    expect(picker.placeholder).toContain("hr:Person");
  });

  it("marks required parameters and shows descriptions and types", () => {
    renderForm();
    for (const name of ["Employee", "Full name", "Last working day", "Reason"]) {
      expect(screen.getByTestId(`param-${PARAMS.find((p) => p.label === name)!.name}`).querySelector("label")!.textContent).toContain("*");
    }
    for (const name of ["note", "severance", "rehire"]) {
      const label = screen.getByTestId(`param-${name}`).querySelector("label")!;
      expect(label.textContent).not.toContain("*");
      expect(screen.getByTestId(`param-${name}`).textContent).toContain("optional");
    }
    expect(screen.getByText("Who is leaving.")).toBeTruthy();
    expect(screen.getByTestId("param-severance").textContent).toContain("Whole number, at least 0");
    expect(screen.getByRole("combobox", { name: /Employee/ }).getAttribute("aria-labelledby")).toBeTruthy();
    // Screen readers hear "required" rather than the asterisk.
    const fullName = screen.getByRole("textbox", { name: /Full name/ });
    expect(fullName.id).toBeTruthy();
    const label = document.querySelector(`label[for="${fullName.id}"]`)!;
    expect(label.querySelector("[aria-hidden]")!.textContent).toBe("*");
    expect(label.querySelector(".sr-only")!.textContent).toContain("(required)");
  });

  it("reports changes by parameter name, with switches as booleans", () => {
    const onChange = renderForm();
    fireEvent.change(screen.getByRole("textbox", { name: /Full name/ }), { target: { value: "Grace Hopper" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Severance/ }), { target: { value: "2500" } });
    fireEvent.click(screen.getByRole("switch", { name: /Eligible for rehire/ }));
    fireEvent.change(screen.getByLabelText(/Last working day/), { target: { value: "2026-10-31" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Reason/ }), { target: { value: "retirement" } });
    expect(onChange.mock.calls).toEqual([
      ["fullName", "Grace Hopper"],
      ["severance", "2500"],
      ["rehire", true],
      ["lastDay", "2026-10-31"],
      ["reason", "retirement"],
    ]);
  });

  it("searches objects of the parameter's class and picks one", async () => {
    const onChange = renderForm();
    const picker = screen.getByRole("combobox", { name: /Employee/ });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "turing" } });
    const option = await screen.findByRole("option", { name: /Alan Turing/ });
    expect(graph.calls.some((c) => c.q === "turing" && c.classIri === "hr:Person")).toBe(true);
    fireEvent.click(within(option).getByRole("button"));
    expect(onChange).toHaveBeenCalledWith("employee", "hr:Person/E-0102");
  });

  it("shows a prefilled object by its label, and can clear it", async () => {
    const onChange = renderForm({ ...emptyValues(PARAMS), employee: "hr:Person/E-0101" });
    const field = screen.getByTestId("param-employee");
    await waitFor(() => expect(field.textContent).toContain("Ada Byron"));
    expect(field.textContent).toContain("hr:Person/E-0101");
    fireEvent.click(within(field).getByRole("button", { name: /Clear the chosen object/ }));
    expect(onChange).toHaveBeenCalledWith("employee", "");
  });

  it("shows the API's problems under the parameter they are about", () => {
    renderForm(emptyValues(PARAMS), { reason: ["Reason is required"] });
    expect(screen.getByTestId("param-reason").textContent).toContain("Reason is required");
    expect(screen.getByRole("combobox", { name: /Reason/ }).getAttribute("aria-invalid")).toBe("true");
  });

  it("says so when an action takes no parameters", () => {
    render(<ParamForm parameters={[]} values={{}} onChange={() => {}} />);
    expect(screen.getByText("This action takes no parameters.")).toBeTruthy();
  });
});
