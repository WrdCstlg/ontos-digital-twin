import { describe, expect, it } from "vitest";
import { evidenceObjectIris } from "./ruleMeta";

describe("evidenceObjectIris", () => {
  it("takes instance IRIs from missing edges and leaves class IRIs out", () => {
    const evidence = {
      nodeIds: [1, 2],
      edgeIds: [],
      missingEdges: [
        { fromIri: "hr:Person/E-0101", toIri: "hr:Person", predicate: "hr:reportsTo" },
        { fromIri: "cmp:Control", toIri: "cmp:Risk/R-07", predicate: "cmp:mitigates" },
        { fromIri: "hr:Person/E-0101", toIri: "hr:Person", predicate: "hr:reportsTo" },
      ],
    };
    expect(evidenceObjectIris(evidence)).toEqual(["hr:Person/E-0101", "cmp:Risk/R-07"]);
  });

  it("adds evidence nodes the caller resolved, after the missing edges, up to the limit", () => {
    const evidence = { nodeIds: [5], edgeIds: [], missingEdges: [{ fromIri: "lgl:Contract/C-9", toIri: "lgl:Matter", predicate: "lgl:relatesToMatter" }] };
    expect(evidenceObjectIris(evidence, ["lgl:Contract/C-9", "cmp:Policy/POL-07", "cmp:AuditFinding/AF-1"], 2)).toEqual([
      "lgl:Contract/C-9",
      "cmp:Policy/POL-07",
    ]);
  });

  it("names nothing for evidence without IRIs", () => {
    expect(evidenceObjectIris(null)).toEqual([]);
    expect(evidenceObjectIris({ nodeIds: [3], edgeIds: [4], missingEdges: [] })).toEqual([]);
  });
});
