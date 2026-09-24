import { describe, it, expect } from "vitest";
import {
  computeViolationSignature,
  categorizeViolation,
  buildJustificationTree,
  generateExplanationAndRemediation,
  explainShaclReport,
  violationKg,
} from "../services/explainableShacl";
import type { ShaclValidationResult, ShaclViolation } from "../services/semanticEngine";

describe("xpSHACL Explainable SHACL Validation Framework", () => {
  describe("Signature & Categorization", () => {
    it("generates deterministic canonical violation signatures", () => {
      const sig1 = computeViolationSignature("pattern", "hr:email", "hr:PersonShape");
      const sig2 = computeViolationSignature("PATTERN", "hr:email", "hr:PersonShape");
      const sig3 = computeViolationSignature("minCount", "hr:fullName", "hr:PersonShape");

      expect(sig1).toBe(sig2);
      expect(sig1).not.toBe(sig3);
      expect(typeof sig1).toBe("string");
      expect(sig1.length).toBe(16);
    });

    it("categorizes SHACL constraints into standardized violation types", () => {
      expect(categorizeViolation("pattern")).toBe("pattern");
      expect(categorizeViolation("sh:PatternConstraintComponent")).toBe("pattern");
      expect(categorizeViolation("minCount")).toBe("cardinality");
      expect(categorizeViolation("sh:MaxCountConstraintComponent")).toBe("cardinality");
      expect(categorizeViolation("datatype")).toBe("value_type");
      expect(categorizeViolation("class")).toBe("class");
      expect(categorizeViolation("minInclusive")).toBe("value_range");
      expect(categorizeViolation("unknownRule")).toBe("other");
    });
  });

  describe("Justification Tree Construction (xpSHACL)", () => {
    it("builds a premise-evidence-conclusion tree for pattern violations", () => {
      const violation: ShaclViolation = {
        focusNode: "https://ontos.dev/ontology/hr/Person/E-0002",
        path: "https://ontos.dev/ontology/hr/email",
        constraint: "pattern",
        severity: "Violation",
        message: "Value does not match pattern ^[^@]+@acme\\.com$",
        value: "bad-email-domain.com",
      };

      const sig = computeViolationSignature(violation.constraint, violation.path);
      const tree = buildJustificationTree(violation, sig);

      expect(tree.violationSignature).toBe(sig);
      expect(tree.root.type).toBe("conclusion");
      expect(tree.root.statement).toContain("fails conformance on property 'email'");

      const children = tree.root.children || [];
      expect(children.length).toBe(3);

      const premise = children.find((c) => c.type === "premise");
      expect(premise).toBeDefined();
      expect(premise?.statement).toContain("requires property 'email' to match regex pattern");

      const evidence = children.find((c) => c.type === "evidence");
      expect(evidence).toBeDefined();
      expect(evidence?.statement).toContain("does not satisfy the required regex pattern");

      const remediation = children.find((c) => c.type === "remediation");
      expect(remediation).toBeDefined();
      expect(remediation?.statement).toContain("Update the value for 'email'");
    });

    it("builds a premise-evidence-conclusion tree for cardinality violations", () => {
      const violation: ShaclViolation = {
        focusNode: "https://ontos.dev/ontology/hr/Person/E-0003",
        path: "https://ontos.dev/ontology/hr/fullName",
        constraint: "minCount",
        severity: "Violation",
        message: "Property is required",
      };

      const sig = computeViolationSignature(violation.constraint, violation.path);
      const tree = buildJustificationTree(violation, sig);

      expect(tree.root.type).toBe("conclusion");
      const children = tree.root.children || [];
      expect(children.some((c) => c.statement.includes("mandatory field"))).toBe(true);
      expect(children.some((c) => c.type === "remediation" && c.statement.includes("Ensure the data source"))).toBe(true);
    });

    it("builds a premise-evidence-conclusion tree for datatype violations", () => {
      const violation: ShaclViolation = {
        focusNode: "https://ontos.dev/ontology/fin/Transaction/T-001",
        path: "https://ontos.dev/ontology/fin/amount",
        constraint: "datatype",
        severity: "Violation",
        message: "Expected xsd:decimal",
      };

      const sig = computeViolationSignature(violation.constraint, violation.path);
      const tree = buildJustificationTree(violation, sig);

      expect(tree.root.type).toBe("conclusion");
      const children = tree.root.children || [];
      expect(children.some((c) => c.type === "premise" && c.statement.includes("XML Schema datatype"))).toBe(true);
      expect(children.some((c) => c.type === "remediation" && c.statement.includes("Cast or parse"))).toBe(true);
    });
  });

  describe("Natural Language Explanation & KG Caching", () => {
    it("generates human-friendly explanations and caches them by signature", () => {
      violationKg.clear();
      const violation: ShaclViolation = {
        focusNode: "https://ontos.dev/ontology/hr/Person/E-0004",
        path: "hr:email",
        constraint: "pattern",
        severity: "Violation",
      };

      const sig = computeViolationSignature(violation.constraint, violation.path);
      const res1 = generateExplanationAndRemediation(violation, sig);

      expect(res1.humanExplanation).toContain("does not match the required formatting pattern");
      expect(res1.remediationAction).toContain("Check source record for 'email'");

      // Verify retrieved from KG cache on second access
      const cached = violationKg.get(sig);
      expect(cached).toBeDefined();
      expect(cached?.humanExplanation).toBe(res1.humanExplanation);
    });
  });

  describe("End-to-End Report Transformation", () => {
    it("transforms conforming SHACL results without errors", () => {
      const cleanResult: ShaclValidationResult = {
        conforms: true,
        focusNodes: 10,
        violationCount: 0,
        violations: [],
      };

      const explained = explainShaclReport(cleanResult);
      expect(explained.conforms).toBe(true);
      expect(explained.violationCount).toBe(0);
      expect(explained.explainedViolations.length).toBe(0);
      expect(explained.signatureSummary.length).toBe(0);
    });

    it("does NOT pass when engine reports conforms:false with an empty violations array", () => {
      // Fail-closed: an engine reply of conforms:false must never be reported
      // as a pass, even if the violations list came back empty.
      const suspiciousResult: ShaclValidationResult = {
        conforms: false,
        focusNodes: 3,
        violationCount: 1,
        violations: [],
      };

      const explained = explainShaclReport(suspiciousResult);
      expect(explained.conforms).toBe(false);
      expect(explained.violationCount).toBe(1);
      expect(explained.explainedViolations.length).toBe(0);
      expect(explained.signatureSummary.length).toBe(0);
    });

    it("preserves the engine violationCount even when it exceeds the violations array length", () => {
      const partialResult: ShaclValidationResult = {
        conforms: false,
        focusNodes: 5,
        violationCount: 7,
        violations: [
          {
            focusNode: "https://ontos.dev/ontology/hr/Person/9",
            path: "hr:email",
            constraint: "pattern",
            severity: "Violation",
            message: "Pattern mismatch",
          },
        ],
      };

      const explained = explainShaclReport(partialResult);
      expect(explained.conforms).toBe(false);
      expect(explained.violationCount).toBe(7);
      expect(explained.explainedViolations.length).toBe(1);
    });

    it("transforms violating SHACL results into enriched diagnostic reports", () => {
      const failingResult: ShaclValidationResult = {
        conforms: false,
        focusNodes: 5,
        violationCount: 2,
        violations: [
          {
            focusNode: "https://ontos.dev/ontology/hr/Person/1",
            path: "hr:email",
            constraint: "pattern",
            severity: "Violation",
            message: "Pattern mismatch",
            value: "bad@gmail.com",
          },
          {
            focusNode: "https://ontos.dev/ontology/hr/Person/2",
            path: "hr:email",
            constraint: "pattern",
            severity: "Violation",
            message: "Pattern mismatch",
            value: "bad@yahoo.com",
          },
        ],
      };

      const explained = explainShaclReport(failingResult);
      expect(explained.conforms).toBe(false);
      expect(explained.violationCount).toBe(2);
      expect(explained.explainedViolations.length).toBe(2);

      // Verify signature grouping aggregated both violations under 1 signature
      expect(explained.signatureSummary.length).toBe(1);
      const group = explained.signatureSummary[0];
      expect(group.count).toBe(2);
      expect(group.sampleFocusNodes.length).toBe(2);
      expect(group.humanExplanation).toBeDefined();
      expect(group.remediationAction).toBeDefined();

      // Check detailed justification tree inside first explained violation
      const first = explained.explainedViolations[0];
      expect(first.justificationTree).toBeDefined();
      expect(first.justificationTree.root.children?.length).toBe(3);
    });
  });
});
