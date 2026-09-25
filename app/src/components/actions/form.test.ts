import { describe, expect, it } from "vitest";
import type { ActionParameter } from "@contracts/actions";
import {
  emptyValues,
  missingRequired,
  prefillSignature,
  problemsByParam,
  toSubmitParams,
  valuesFromSearch,
} from "./form";
import { explorerHref, runHref, submissionHref } from "./links";

const params: ActionParameter[] = [
  { name: "employee", label: "Employee", type: "object", classIri: "hr:Person", required: true },
  { name: "lastDay", label: "Last working day", type: "date", required: true },
  { name: "reason", label: "Reason", type: "enum", options: ["resignation", "retirement"], required: true },
  { name: "note", label: "Note", type: "string", required: false },
  { name: "severance", label: "Severance", type: "number", required: false, min: 0 },
  { name: "rehire", label: "Eligible for rehire", type: "boolean", required: false },
];

describe("submission form values", () => {
  it("starts empty, with switches off", () => {
    expect(emptyValues(params)).toEqual({ employee: "", lastDay: "", reason: "", note: "", severance: "", rehire: false });
  });

  it("prefills from a deep link and ignores names that are not parameters", () => {
    const search = new URLSearchParams("run=record-termination&employee=hr%3APerson%2FE-0101&rehire=true&bogus=1");
    expect(valuesFromSearch(params, search)).toEqual({
      employee: "hr:Person/E-0101",
      lastDay: "",
      reason: "",
      note: "",
      severance: "",
      rehire: true,
    });
  });

  it("sends empty fields as null, numbers as numbers, and a bad number as typed", () => {
    const values = { employee: " hr:Person/E-0101 ", lastDay: "2026-10-31", reason: "", note: "", severance: "2500", rehire: false };
    expect(toSubmitParams(params, values)).toEqual({
      employee: "hr:Person/E-0101",
      lastDay: "2026-10-31",
      reason: null,
      note: null,
      severance: 2500,
      rehire: false,
    });
    expect(toSubmitParams(params, { ...values, severance: "lots" }).severance).toBe("lots");
  });

  it("lists required parameters still empty", () => {
    expect(missingRequired(params, emptyValues(params))).toEqual(["Employee", "Last working day", "Reason"]);
    expect(missingRequired(params, { ...emptyValues(params), employee: "x", lastDay: "2026-10-31", reason: "retirement" })).toEqual([]);
  });

  it("keys a deep link by its parameters only, so opening a submission keeps the form", () => {
    const a = new URLSearchParams("run=x&employee=e1");
    const b = new URLSearchParams("employee=e1&submission=4&run=x");
    expect(prefillSignature(a)).toBe(prefillSignature(b));
    expect(prefillSignature(new URLSearchParams("run=x&employee=e2"))).not.toBe(prefillSignature(a));
  });

  it("files API problems under the parameter they name", () => {
    expect(
      problemsByParam([
        { message: "Employee: no object hr:Person/X", path: "params.employee" },
        { message: "Reason is required", path: "params.reason" },
        { message: "A criterion", path: "criteria.0" },
        { message: "No path" },
      ]),
    ).toEqual({ employee: ["Employee: no object hr:Person/X"], reason: ["Reason is required"] });
  });

  it("builds links other pages use", () => {
    expect(runHref("reassign-manager", { employee: "hr:Person/E-0101" })).toBe(
      "/app/actions?run=reassign-manager&employee=hr%3APerson%2FE-0101",
    );
    expect(explorerHref("lgl:Contract/C-1")).toBe("/app/explorer?iri=lgl%3AContract%2FC-1");
    expect(submissionHref(12)).toBe("/app/actions?submission=12");
  });
});
