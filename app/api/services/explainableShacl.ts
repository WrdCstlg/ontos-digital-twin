import { createHash } from "node:crypto";
import type { ShaclViolation, ShaclValidationResult } from "./semanticEngine";

export type ViolationType =
  | "cardinality"
  | "value_type"
  | "value_range"
  | "pattern"
  | "class"
  | "other";

export type JustificationNodeType =
  | "conclusion"
  | "premise"
  | "evidence"
  | "remediation";

export type JustificationNode = {
  id: string;
  statement: string;
  type: JustificationNodeType;
  evidence?: string;
  children?: JustificationNode[];
};

export type JustificationTree = {
  root: JustificationNode;
  violationSignature: string;
};

export type ExplainedViolation = {
  focusNode: string;
  path?: string;
  constraint: string;
  violationType: ViolationType;
  severity: "Violation" | "Warning" | "Info";
  rawMessage?: string;
  signature: string;
  humanExplanation: string;
  remediationAction: string;
  justificationTree: JustificationTree;
};

export type SignatureGroup = {
  signature: string;
  constraint: string;
  path?: string;
  count: number;
  sampleFocusNodes: string[];
  humanExplanation: string;
  remediationAction: string;
};

export type ExplainedShaclReport = {
  conforms: boolean;
  focusNodes: number;
  violationCount: number;
  explainedViolations: ExplainedViolation[];
  signatureSummary: SignatureGroup[];
  raw?: unknown;
};

/**
 * In-memory Violation Knowledge Graph cache (xpSHACL Violation KG).
 * Caches explanations and remediation suggestions by canonical signature.
 */
class ViolationKgCache {
  private cache = new Map<
    string,
    { humanExplanation: string; remediationAction: string }
  >();

  public get(sig: string) {
    return this.cache.get(sig);
  }

  public set(
    sig: string,
    data: { humanExplanation: string; remediationAction: string },
  ) {
    this.cache.set(sig, data);
  }

  public clear() {
    this.cache.clear();
  }
}

export const violationKg = new ViolationKgCache();

/**
 * Computes a deterministic canonical signature for a SHACL violation (xpSHACL signature pattern).
 */
export function computeViolationSignature(
  constraint: string,
  path?: string,
  shapeId?: string,
): string {
  const normConstraint = (constraint || "unknown").toLowerCase().trim();
  const normPath = (path || "no-path").toLowerCase().trim();
  const normShape = (shapeId || "no-shape").toLowerCase().trim();
  const raw = `${normShape}|${normPath}|${normConstraint}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Categorizes a raw SHACL constraint string into an xpSHACL ViolationType.
 */
export function categorizeViolation(constraint: string): ViolationType {
  const c = (constraint || "").toLowerCase();
  if (c.includes("pattern")) return "pattern";
  if (c.includes("count") || c.includes("mincount") || c.includes("maxcount"))
    return "cardinality";
  if (c.includes("datatype") || c.includes("type")) return "value_type";
  if (
    c.includes("range") ||
    c.includes("inclusive") ||
    c.includes("exclusive") ||
    c.includes("minlength") ||
    c.includes("maxlength")
  )
    return "value_range";
  if (c.includes("class")) return "class";
  return "other";
}

/**
 * Formats a clean human-readable name for an IRI or property path.
 */
export function formatLabel(iri?: string): string {
  if (!iri) return "unspecified property";
  if (iri.includes("#")) return iri.split("#").pop() || iri;
  if (iri.includes("/")) return iri.split("/").pop() || iri;
  if (iri.includes(":")) return iri.split(":").pop() || iri;
  return iri;
}

/**
 * Builds a formal xpSHACL Justification Tree for a constraint violation.
 * Structure:
 *   [Root Conclusion: Node fails to conform]
 *      ├── [Premise: Shape specifies requirement]
 *      ├── [Evidence: Observed node value or state]
 *      └── [Remediation: Actionable steps to resolve failure]
 */
export function buildJustificationTree(
  v: ShaclViolation,
  signature: string,
): JustificationTree {
  const vType = categorizeViolation(v.constraint);
  const pathLabel = formatLabel(v.path);
  const nodeLabel = formatLabel(v.focusNode);

  const rootId = `root-${signature}`;
  const root: JustificationNode = {
    id: rootId,
    statement: `Focus node <${nodeLabel}> fails conformance on property '${pathLabel}'`,
    type: "conclusion",
    children: [],
  };

  switch (vType) {
    case "pattern": {
      root.children?.push({
        id: `${rootId}-premise-1`,
        statement: `Shape requires property '${pathLabel}' to match regex pattern`,
        type: "premise",
        evidence: v.message || "sh:pattern constraint active",
      });
      root.children?.push({
        id: `${rootId}-evidence-1`,
        statement: `Observed value does not satisfy the required regex pattern on '${pathLabel}'`,
        type: "evidence",
        evidence: v.value ? `Observed: "${v.value}"` : undefined,
      });
      root.children?.push({
        id: `${rootId}-remediation-1`,
        statement: `Update the value for '${pathLabel}' to match the valid syntax, or relax the regex in the SHACL shape definition`,
        type: "remediation",
      });
      break;
    }

    case "cardinality": {
      const isMin = v.constraint.toLowerCase().includes("min");
      root.children?.push({
        id: `${rootId}-premise-1`,
        statement: isMin
          ? `Shape specifies a minimum required occurrence for '${pathLabel}' (mandatory field)`
          : `Shape specifies a maximum allowed occurrence for '${pathLabel}'`,
        type: "premise",
        evidence: isMin ? "sh:minCount constraint" : "sh:maxCount constraint",
      });
      root.children?.push({
        id: `${rootId}-evidence-1`,
        statement: isMin
          ? `Missing property: Node <${nodeLabel}> has no statement for '${pathLabel}'`
          : `Excess property: Node <${nodeLabel}> has more values for '${pathLabel}' than permitted`,
        type: "evidence",
      });
      root.children?.push({
        id: `${rootId}-remediation-1`,
        statement: isMin
          ? `Ensure the data source or mapping populates a non-null value for '${pathLabel}'`
          : `Deduplicate or prune excess values for '${pathLabel}' on node <${nodeLabel}>`,
        type: "remediation",
      });
      break;
    }

    case "value_type": {
      root.children?.push({
        id: `${rootId}-premise-1`,
        statement: `Shape enforces a specific XML Schema datatype on '${pathLabel}'`,
        type: "premise",
        evidence: v.message || "sh:datatype constraint",
      });
      root.children?.push({
        id: `${rootId}-evidence-1`,
        statement: `The lexical representation on '${pathLabel}' is incompatible with the expected datatype`,
        type: "evidence",
      });
      root.children?.push({
        id: `${rootId}-remediation-1`,
        statement: `Cast or parse the incoming data to the appropriate datatype (e.g. integer, date, decimal) before ingest`,
        type: "remediation",
      });
      break;
    }

    case "class": {
      root.children?.push({
        id: `${rootId}-premise-1`,
        statement: `Shape requires object target of '${pathLabel}' to be an instance of the declared class`,
        type: "premise",
        evidence: "sh:class constraint",
      });
      root.children?.push({
        id: `${rootId}-evidence-1`,
        statement: `Linked target node is either missing from the graph or does not declare the expected rdf:type`,
        type: "evidence",
      });
      root.children?.push({
        id: `${rootId}-remediation-1`,
        statement: `Ensure the target entity is imported and typed properly in the ontology graph`,
        type: "remediation",
      });
      break;
    }

    default: {
      root.children?.push({
        id: `${rootId}-premise-1`,
        statement: `Shape constraint '${v.constraint}' was not satisfied for property '${pathLabel}'`,
        type: "premise",
        evidence: v.message,
      });
      root.children?.push({
        id: `${rootId}-evidence-1`,
        statement: `Constraint violation reported during graph validation`,
        type: "evidence",
      });
      root.children?.push({
        id: `${rootId}-remediation-1`,
        statement: `Review the data value on node <${nodeLabel}> against the constraint rules in the ontology editor`,
        type: "remediation",
      });
      break;
    }
  }

  return { root, violationSignature: signature };
}

/**
 * Generates natural language explanation and remediation texts for a violation.
 * Utilizes the Violation Knowledge Graph cache to reuse previously computed explanations.
 */
export function generateExplanationAndRemediation(
  v: ShaclViolation,
  signature: string,
): { humanExplanation: string; remediationAction: string } {
  const cached = violationKg.get(signature);
  if (cached) return cached;

  const vType = categorizeViolation(v.constraint);
  const pathLabel = formatLabel(v.path);
  const nodeLabel = formatLabel(v.focusNode);

  let humanExplanation = "";
  let remediationAction = "";

  switch (vType) {
    case "pattern":
      humanExplanation = `The value for '${pathLabel}' on node <${nodeLabel}> does not match the required formatting pattern.`;
      remediationAction = `Check source record for '${pathLabel}' and update the value to match the required format (e.g. verify email domain or code syntax).`;
      break;

    case "cardinality":
      if (v.constraint.toLowerCase().includes("min")) {
        humanExplanation = `Mandatory field '${pathLabel}' is missing on instance <${nodeLabel}>.`;
        remediationAction = `Provide a non-empty value for '${pathLabel}' in the connector column mapping.`;
      } else {
        humanExplanation = `Too many values were provided for field '${pathLabel}' on <${nodeLabel}>.`;
        remediationAction = `Ensure '${pathLabel}' is mapped to a single value, or adjust cardinality in the class schema to allow multiple values.`;
      }
      break;

    case "value_type":
      humanExplanation = `Datatype mismatch: '${pathLabel}' on <${nodeLabel}> does not conform to the expected datatype.`;
      remediationAction = `Verify that input values for '${pathLabel}' are correctly formatted numbers, dates, or booleans without invalid string characters.`;
      break;

    case "class":
      humanExplanation = `Relationship error: '${pathLabel}' links to an entity that does not have the expected class type.`;
      remediationAction = `Ensure the referenced entity exists in the target module and has the correct rdf:type declared.`;
      break;

    default:
      humanExplanation = `Validation rule '${v.constraint}' was violated on property '${pathLabel}' of node <${nodeLabel}>: ${v.message || "constraint failed"}.`;
      remediationAction = `Inspect the node and update its properties to align with the SHACL shape specifications.`;
      break;
  }

  const result = { humanExplanation, remediationAction };
  violationKg.set(signature, result);
  return result;
}

/**
 * Processes a raw ShaclValidationResult from open-ontologies into an xpSHACL ExplainedShaclReport.
 */
export function explainShaclReport(
  rawReport: ShaclValidationResult,
): ExplainedShaclReport {
  if (rawReport.conforms && rawReport.violations.length === 0) {
    return {
      conforms: true,
      focusNodes: rawReport.focusNodes,
      violationCount: 0,
      explainedViolations: [],
      signatureSummary: [],
      raw: rawReport.raw,
    };
  }

  const explainedViolations: ExplainedViolation[] = [];
  const groupMap = new Map<string, SignatureGroup>();

  for (const v of rawReport.violations) {
    const sig = computeViolationSignature(v.constraint, v.path);
    const { humanExplanation, remediationAction } =
      generateExplanationAndRemediation(v, sig);
    const jTree = buildJustificationTree(v, sig);

    explainedViolations.push({
      focusNode: v.focusNode,
      path: v.path,
      constraint: v.constraint,
      violationType: categorizeViolation(v.constraint),
      severity: v.severity ?? "Violation",
      rawMessage: v.message,
      signature: sig,
      humanExplanation,
      remediationAction,
      justificationTree: jTree,
    });

    const group = groupMap.get(sig) ?? {
      signature: sig,
      constraint: v.constraint,
      path: v.path,
      count: 0,
      sampleFocusNodes: [],
      humanExplanation,
      remediationAction,
    };
    group.count += 1;
    if (group.sampleFocusNodes.length < 5) {
      group.sampleFocusNodes.push(v.focusNode);
    }
    groupMap.set(sig, group);
  }

  return {
    conforms: false,
    focusNodes: rawReport.focusNodes,
    violationCount: rawReport.violationCount,
    explainedViolations,
    signatureSummary: Array.from(groupMap.values()),
    raw: rawReport.raw,
  };
}
