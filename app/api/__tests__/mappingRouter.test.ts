import { describe, expect, it } from "vitest";
import { appRouter } from "../router";
import { parseCsv } from "../mappingRouter";
import {
  createMockContext,
  mockViewerUser,
  mockViewerMembership,
  mockWorkspace,
} from "./testHarness";

describe("Mapping Router & CSV Processing Tests", () => {
  describe("parseCsv unit tests", () => {
    it("parses standard CSV with headers and rows", () => {
      const csv = "id,name,role\n1,Alice,Engineer\n2,Bob,Designer";
      const { headers, rows } = parseCsv(csv);
      expect(headers).toEqual(["id", "name", "role"]);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: "1", name: "Alice", role: "Engineer" });
      expect(rows[1]).toEqual({ id: "2", name: "Bob", role: "Designer" });
    });

    it("parses CSV with quoted values containing commas", () => {
      const csv = 'id,title,tags\n101,"Senior Engineer, Core","dev,lead"\n102,"Product Manager","pm"';
      const { headers, rows } = parseCsv(csv);
      expect(headers).toEqual(["id", "title", "tags"]);
      expect(rows).toHaveLength(2);
      expect(rows[0].title).toBe("Senior Engineer, Core");
      expect(rows[0].tags).toBe("dev,lead");
    });

    it("parses CSV with escaped internal quotes", () => {
      const csv = 'code,label\nXYZ,"He said ""Approved"" to proceed"';
      const { headers, rows } = parseCsv(csv);
      expect(headers).toEqual(["code", "label"]);
      expect(rows[0].label).toBe('He said "Approved" to proceed');
    });

    it("handles both CRLF (Windows) and LF (Unix) line breaks", () => {
      const crlf = "a,b\r\n1,2\r\n3,4";
      const lf = "a,b\n1,2\n3,4";
      const resCrlf = parseCsv(crlf);
      const resLf = parseCsv(lf);
      expect(resCrlf).toEqual(resLf);
      expect(resCrlf.rows).toHaveLength(2);
    });

    it("returns empty headers and rows for empty or whitespace-only input", () => {
      expect(parseCsv("")).toEqual({ headers: [], rows: [] });
      expect(parseCsv("   \n\r\n  ")).toEqual({ headers: [], rows: [] });
    });

    it("respects maxRows parameter", () => {
      const csv = "n\n1\n2\n3\n4\n5";
      const { rows } = parseCsv(csv, 3);
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.n)).toEqual(["1", "2", "3"]);
    });
  });

  describe("previewCsv tRPC query", () => {
    it("generates preview instances and RDF triples from ad-hoc CSV upload", async () => {
      const caller = appRouter.createCaller(
        createMockContext({
          user: mockViewerUser,
          membership: mockViewerMembership,
          workspace: mockWorkspace,
        }),
      );

      const csvContent = "sku,warehouse,qty\nSKU-001,East-Hub,50\nSKU-002,West-Hub,120";
      const result = await caller.mapping.previewCsv({
        filename: "inventory.csv",
        csvText: csvContent,
      });

      expect(result.filename).toBe("inventory.csv");
      expect(result.headers).toEqual(["sku", "warehouse", "qty"]);
      expect(result.sampleRows).toHaveLength(2);
      expect(result.instances).toHaveLength(2);

      const inst1 = result.instances[0];
      expect(inst1.row).toBe(1);
      expect(inst1.iri).toBe("row/1");
      expect(inst1.classIri).toBe("csv:Row");
      expect(inst1.props).toEqual({
        sku: "SKU-001",
        warehouse: "East-Hub",
        qty: "50",
      });
      expect(inst1.triples).toContain("row/1 a csv:Row ;");
      expect(inst1.triples).toContain('sku "SKU-001" ;');
      expect(inst1.triples).toContain('ontos:provenance "inventory.csv:row-2" .');
    });

    it("rejects unauthenticated request to preview CSV", async () => {
      const caller = appRouter.createCaller(
        createMockContext({ user: null, workspace: null, membership: null }),
      );

      await expect(
        caller.mapping.previewCsv({
          filename: "test.csv",
          csvText: "a,b\n1,2",
        }),
      ).rejects.toThrow("Authentication required");
    });
  });
});
