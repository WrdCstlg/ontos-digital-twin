import { describe, expect, it } from "vitest";
import { SEED_SHACL } from "@db/seedShacl";
import { parseShacl, shaclToTurtle as libraryTurtle } from "../components/library/lib";
import { constraintType, constraintValue, shaclToTurtle as studioTurtle, type ShaclShape } from "../components/studio/studio-utils";

/**
 * The Library and the Studio show a class's stored rules as read-only Turtle.
 * They must show each rule the server enforces: the HR date rule is enforced as
 * sh:lessThanOrEquals, and a view without it would hide it (docs/DECISIONS.md, D-032).
 */
const hrContract = SEED_SHACL["hr:EmploymentContract"] as ShaclShape;
const dateRule = hrContract.constraints.find((c) => c.path === "hr:startDate")!;

describe("the HR date rule in the UI", () => {
  it("is in the Library's Turtle", () => {
    expect(libraryTurtle(parseShacl(hrContract)!, "hr")).toContain("sh:lessThanOrEquals hr:endDate ;");
  });

  it("is in the Studio's Turtle", () => {
    const turtle = studioTurtle({
      id: 1,
      moduleId: 1,
      iri: "hr:EmploymentContract",
      label: "EmploymentContract",
      parentId: null,
      parentIri: null,
      definition: null,
      isCustom: false,
      deprecated: false,
      shaclJson: hrContract,
      createdAt: new Date(),
      instanceCount: 0,
    });
    expect(turtle).toContain("sh:lessThanOrEquals hr:endDate ;");
  });

  it("is named and valued in the Studio's list of constraints", () => {
    expect(dateRule).toBeDefined();
    expect(constraintType(dateRule)).toBe("lessThanOrEquals");
    expect(constraintValue(dateRule)).toBe("≤ hr:endDate");
  });
});
