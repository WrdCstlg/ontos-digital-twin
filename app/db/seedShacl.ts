/**
 * The SHACL rules the demo seed stores on its key classes, by class IRI, in the
 * form `shaclJsonToTurtle` (api/services/rdfBridge.ts) compiles. In a module of
 * their own so tests can read them: importing seed.ts runs the seed.
 */
export const SEED_SHACL: Record<string, unknown> = {
  "hr:Person": {
    shape: "hr:PersonShape",
    constraints: [
      { path: "hr:fullName", minCount: 1, maxCount: 1, datatype: "xsd:string", severity: "Violation" },
      { path: "hr:email", minCount: 1, pattern: "^[^@]+@acme\\.com$", severity: "Violation" },
    ],
  },
  "hr:EmploymentContract": {
    shape: "hr:EmploymentContractShape",
    constraints: [
      { path: "hr:hireDate", minCount: 1, datatype: "xsd:date", severity: "Violation" },
      { path: "hr:startDate", lessThanOrEquals: "hr:endDate", severity: "Violation", message: "An employment contract cannot end before it starts" },
    ],
  },
  "lgl:Contract": {
    shape: "lgl:ContractShape",
    constraints: [
      { path: "lgl:contractNumber", minCount: 1, maxCount: 1, severity: "Violation" },
      { path: "lgl:withParty", minCount: 1, severity: "Warning" },
    ],
  },
  "cmp:Control": {
    shape: "cmp:ControlShape",
    constraints: [
      { path: "cmp:controlId", minCount: 1, pattern: "^CMP-\\d{3}$", severity: "Violation" },
      { path: "cmp:hasEvidence", minCount: 1, severity: "Warning", message: "Evidence must be refreshed every 90 days" },
    ],
  },
  "fin:Transaction": {
    shape: "fin:TransactionShape",
    constraints: [
      { path: "fin:amount", minCount: 1, datatype: "xsd:decimal", severity: "Violation" },
      { path: "fin:bookedTo", minCount: 1, severity: "Warning" },
    ],
  },
  "log:Shipment": {
    shape: "log:ShipmentShape",
    constraints: [{ path: "log:trackingId", minCount: 1, maxCount: 1, severity: "Violation" }],
  },
};
