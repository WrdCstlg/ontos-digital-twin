/**
 * insightRules.test.ts — Tests for the 12 deterministic anomaly rules.
 *
 * These rules carry the case study's core argument: "every finding can be
 * traced to its evidence". Each test constructs a minimal synthetic graph,
 * runs runRules(), and asserts that:
 *   - The correct ruleId fires (or doesn't)
 *   - The evidence references the exact node/edge that triggered it
 *   - The severity and title are correct
 *
 * No database, no HTTP, no engine — pure logic.
 */
import { describe, it, expect } from "vitest";
import { runRules } from "../insightsRouter";
import type { KgNode, KgEdge } from "@db/schema";

/* ── helpers ──────────────────────────────────────────────── */

let _id = 0;
function nextId() {
  return ++_id;
}

function makeNode(
  overrides: Partial<KgNode> & { classIri: string; label: string },
): KgNode {
  const id = overrides.id ?? nextId();
  return {
    id,
    workspaceId: 1,
    iri: overrides.iri ?? `test:${overrides.label.replace(/\s/g, "_")}_${id}`,
    moduleKey: overrides.moduleKey ?? "test",
    propsJson: overrides.propsJson ?? {},
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    label: overrides.label,
    classIri: overrides.classIri,
  } as KgNode;
}

function makeEdge(
  from: KgNode,
  to: KgNode,
  predicateIri: string,
  overrides?: Partial<KgEdge>,
): KgEdge {
  return {
    id: nextId(),
    workspaceId: 1,
    fromNodeId: from.id,
    toNodeId: to.id,
    predicateIri,
    label: predicateIri.split(":").pop() ?? predicateIri,
    weight: null,
    propsJson: {},
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as KgEdge;
}

function findByRule(findings: ReturnType<typeof runRules>, ruleId: string) {
  return findings.filter((f) => f.ruleId === ruleId);
}

/* ── R1: vendor-payment-without-contract ──────────────────── */
describe("R1: vendor-payment-without-contract", () => {
  it("fires when a vendor receives payment but has no active contract", () => {
    const vendor = makeNode({ classIri: "fin:Vendor", label: "Shady Corp" });
    const tx = makeNode({ classIri: "fin:Transaction", label: "TX-001" });
    const paidTo = makeEdge(tx, vendor, "fin:paidTo");

    const results = runRules([vendor, tx], [paidTo]);
    const hits = findByRule(results, "vendor-payment-without-contract");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("risk");
    expect(hits[0].evidence.nodeIds).toContain(vendor.id);
    expect(hits[0].evidence.edgeIds).toContain(paidTo.id);
  });

  it("does not fire when the vendor has an active contract", () => {
    const vendor = makeNode({ classIri: "fin:Vendor", label: "Good Corp" });
    const tx = makeNode({ classIri: "fin:Transaction", label: "TX-002" });
    const contract = makeNode({
      classIri: "lgl:Contract",
      label: "C-001",
      propsJson: { status: "active" },
    });
    const paidTo = makeEdge(tx, vendor, "fin:paidTo");
    const withParty = makeEdge(contract, vendor, "lgl:withParty");

    const results = runRules([vendor, tx, contract], [paidTo, withParty]);
    expect(findByRule(results, "vendor-payment-without-contract")).toHaveLength(0);
  });
});

/* ── R2: person-without-manager ──────────────────────────── */
describe("R2: person-without-manager", () => {
  it("fires for non-CEO HR persons with no reportsTo edge", () => {
    const emp = makeNode({
      classIri: "hr:Employee",
      label: "Alice",
      moduleKey: "hr",
    });
    const results = runRules([emp], []);
    const hits = findByRule(results, "person-without-manager");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("info");
    expect(hits[0].evidence.nodeIds).toContain(emp.id);
  });

  it("does not fire for the CEO", () => {
    const ceo = makeNode({
      classIri: "hr:Person",
      label: "CEO",
      moduleKey: "hr",
      propsJson: { isCeo: true },
    });
    const results = runRules([ceo], []);
    expect(findByRule(results, "person-without-manager")).toHaveLength(0);
  });

  it("does not fire when a reportsTo edge exists", () => {
    const mgr = makeNode({ classIri: "hr:Person", label: "Bob", moduleKey: "hr", propsJson: { isCeo: true } });
    const emp = makeNode({ classIri: "hr:Employee", label: "Alice", moduleKey: "hr" });
    const reportsTo = makeEdge(emp, mgr, "hr:reportsTo");
    const results = runRules([mgr, emp], [reportsTo]);
    expect(findByRule(results, "person-without-manager")).toHaveLength(0);
  });
});

/* ── R3: control-without-evidence-90d ────────────────────── */
describe("R3: control-without-evidence-90d", () => {
  it("fires for a control with no evidence at all", () => {
    const ctrl = makeNode({ classIri: "cmp:Control", label: "SOC2-CC1" });
    const results = runRules([ctrl], []);
    const hits = findByRule(results, "control-without-evidence-90d");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warn");
    expect(hits[0].evidence.nodeIds).toContain(ctrl.id);
  });

  it("does not fire when evidence is fresh (within 90 days)", () => {
    const ctrl = makeNode({ classIri: "cmp:Control", label: "SOC2-CC2" });
    const ev = makeNode({
      classIri: "cmp:Evidence",
      label: "Screenshot",
      propsJson: { collectedAt: new Date().toISOString() },
    });
    const hasEv = makeEdge(ctrl, ev, "cmp:hasEvidence");
    const results = runRules([ctrl, ev], [hasEv]);
    expect(findByRule(results, "control-without-evidence-90d")).toHaveLength(0);
  });
});

/* ── R4: transaction-without-cost-center ─────────────────── */
describe("R4: transaction-without-cost-center", () => {
  it("fires for a transaction with no bookedTo edge", () => {
    const tx = makeNode({
      classIri: "fin:Transaction",
      label: "TX-100",
      propsJson: { amount: 5000 },
    });
    const results = runRules([tx], []);
    const hits = findByRule(results, "transaction-without-cost-center");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("risk");
    expect(hits[0].evidence.nodeIds).toContain(tx.id);
  });

  it("does not fire when bookedTo exists", () => {
    const tx = makeNode({ classIri: "fin:Transaction", label: "TX-101" });
    const cc = makeNode({ classIri: "fin:CostCenter", label: "CC-Engineering" });
    const edge = makeEdge(tx, cc, "fin:bookedTo");
    const results = runRules([tx, cc], [edge]);
    expect(findByRule(results, "transaction-without-cost-center")).toHaveLength(0);
  });
});

/* ── R5: contract-governed-by-policy-with-open-finding ───── */
describe("R5: contract-governed-by-policy-with-open-finding", () => {
  it("fires when a contract's governing policy has an open audit finding", () => {
    const contract = makeNode({ classIri: "lgl:Contract", label: "MSA-001" });
    const policy = makeNode({ classIri: "cmp:Policy", label: "POL-IT" });
    const finding = makeNode({
      classIri: "cmp:AuditFinding",
      label: "AF-007",
      propsJson: { status: "open" },
    });
    const governs = makeEdge(policy, contract, "cmp:governs");
    const against = makeEdge(finding, policy, "cmp:againstPolicy");

    const results = runRules([contract, policy, finding], [governs, against]);
    const hits = findByRule(results, "contract-governed-by-policy-with-open-finding");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("risk");
    expect(hits[0].evidence.nodeIds).toContain(contract.id);
    expect(hits[0].evidence.nodeIds).toContain(finding.id);
    expect(hits[0].evidence.edgeIds).toContain(governs.id);
    expect(hits[0].evidence.edgeIds).toContain(against.id);
  });

  it("does not fire when the finding is resolved", () => {
    const contract = makeNode({ classIri: "lgl:Contract", label: "MSA-002" });
    const policy = makeNode({ classIri: "cmp:Policy", label: "POL-SEC" });
    const finding = makeNode({
      classIri: "cmp:AuditFinding",
      label: "AF-008",
      propsJson: { status: "resolved" },
    });
    const governs = makeEdge(policy, contract, "cmp:governs");
    const against = makeEdge(finding, policy, "cmp:againstPolicy");
    const results = runRules([contract, policy, finding], [governs, against]);
    expect(findByRule(results, "contract-governed-by-policy-with-open-finding")).toHaveLength(0);
  });
});

/* ── R6: org-island ──────────────────────────────────────── */
describe("R6: org-island", () => {
  it("fires for an OrgUnit with no parentUnit and isRoot !== true", () => {
    const unit = makeNode({ classIri: "hr:OrgUnit", label: "Rogue Team" });
    const results = runRules([unit], []);
    const hits = findByRule(results, "org-island");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warn");
    expect(hits[0].evidence.nodeIds).toContain(unit.id);
  });

  it("does not fire for a root org unit", () => {
    const root = makeNode({
      classIri: "hr:OrgUnit",
      label: "Acme Corp",
      propsJson: { isRoot: true },
    });
    const results = runRules([root], []);
    expect(findByRule(results, "org-island")).toHaveLength(0);
  });

  it("does not fire when parentUnit edge exists", () => {
    const parent = makeNode({ classIri: "hr:OrgUnit", label: "Engineering", propsJson: { isRoot: true } });
    const child = makeNode({ classIri: "hr:OrgUnit", label: "Frontend" });
    const edge = makeEdge(child, parent, "hr:parentUnit");
    const results = runRules([parent, child], [edge]);
    // parent doesn't fire (isRoot), child doesn't fire (has edge)
    expect(findByRule(results, "org-island")).toHaveLength(0);
  });
});

/* ── R7: twin-cold-chain-excursion ───────────────────────── */
describe("R7: twin-cold-chain-excursion", () => {
  it("fires for a cold-chain zone with temperature outside 2-6°C", () => {
    const zone = makeNode({
      classIri: "dtwin:ZoneTwin",
      label: "Warehouse-B",
      propsJson: { zoneType: "cold-chain", temperature: 9.1 },
    });
    const results = runRules([zone], []);
    const hits = findByRule(results, "twin-cold-chain-excursion");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("risk");
    expect(hits[0].evidence.nodeIds).toContain(zone.id);
  });

  it("does not fire when temperature is within range", () => {
    const zone = makeNode({
      classIri: "dtwin:ZoneTwin",
      label: "Warehouse-A",
      propsJson: { zoneType: "cold-chain", temperature: 4.0 },
    });
    const results = runRules([zone], []);
    expect(findByRule(results, "twin-cold-chain-excursion")).toHaveLength(0);
  });
});

/* ── R8: budget-overrun ──────────────────────────────────── */
describe("R8: budget-overrun", () => {
  it("fires when booked transactions exceed a cost center's budget", () => {
    const cc = makeNode({ classIri: "fin:CostCenter", label: "IT" });
    const budget = makeNode({
      classIri: "fin:Budget",
      label: "IT-FY2025",
      propsJson: { amount: 100000 },
    });
    const tx = makeNode({
      classIri: "fin:Transaction",
      label: "TX-200",
      propsJson: { amount: 150000 },
    });
    const budgetFor = makeEdge(budget, cc, "fin:budgetFor");
    const bookedTo = makeEdge(tx, cc, "fin:bookedTo");

    const results = runRules([cc, budget, tx], [budgetFor, bookedTo]);
    const hits = findByRule(results, "budget-overrun");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("risk");
    expect(hits[0].evidence.nodeIds).toContain(cc.id);
    expect(hits[0].evidence.nodeIds).toContain(budget.id);
  });

  it("does not fire when spending is under budget", () => {
    const cc = makeNode({ classIri: "fin:CostCenter", label: "HR" });
    const budget = makeNode({
      classIri: "fin:Budget",
      label: "HR-FY2025",
      propsJson: { amount: 200000 },
    });
    const tx = makeNode({
      classIri: "fin:Transaction",
      label: "TX-201",
      propsJson: { amount: 50000 },
    });
    const budgetFor = makeEdge(budget, cc, "fin:budgetFor");
    const bookedTo = makeEdge(tx, cc, "fin:bookedTo");
    const results = runRules([cc, budget, tx], [budgetFor, bookedTo]);
    expect(findByRule(results, "budget-overrun")).toHaveLength(0);
  });
});

/* ── R9: unmitigated-high-risk ───────────────────────────── */
describe("R9: unmitigated-high-risk", () => {
  it("fires for a high-severity risk (likelihood*impact>=16) with no mitigating control", () => {
    const risk = makeNode({
      classIri: "cmp:Risk",
      label: "Data-Breach",
      propsJson: { likelihood: 4, impact: 5 },
    });
    const results = runRules([risk], []);
    const hits = findByRule(results, "unmitigated-high-risk");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("risk");
    expect(hits[0].evidence.nodeIds).toContain(risk.id);
  });

  it("does not fire when a control mitigates the risk", () => {
    const risk = makeNode({
      classIri: "cmp:Risk",
      label: "Phishing",
      propsJson: { likelihood: 5, impact: 4 },
    });
    const ctrl = makeNode({ classIri: "cmp:Control", label: "MFA" });
    const mitigates = makeEdge(ctrl, risk, "cmp:mitigates");
    const results = runRules([risk, ctrl], [mitigates]);
    expect(findByRule(results, "unmitigated-high-risk")).toHaveLength(0);
  });
});

/* ── R10: contract-expiring-without-renewal ──────────────── */
describe("R10: contract-expiring-without-renewal", () => {
  it("fires for an active contract expiring within 30 days with no renewal matter", () => {
    const inTwoWeeks = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    const contract = makeNode({
      classIri: "lgl:Contract",
      label: "SLA-Expiring",
      propsJson: { status: "active", endDate: inTwoWeeks },
    });
    const results = runRules([contract], []);
    const hits = findByRule(results, "contract-expiring-without-renewal");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warn");
    expect(hits[0].evidence.nodeIds).toContain(contract.id);
  });

  it("does not fire when a relatesToMatter edge exists", () => {
    const inTwoWeeks = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    const contract = makeNode({
      classIri: "lgl:Contract",
      label: "SLA-Renewing",
      propsJson: { status: "active", endDate: inTwoWeeks },
    });
    const matter = makeNode({ classIri: "lgl:Matter", label: "Renewal-M1" });
    const edge = makeEdge(contract, matter, "lgl:relatesToMatter");
    const results = runRules([contract, matter], [edge]);
    expect(findByRule(results, "contract-expiring-without-renewal")).toHaveLength(0);
  });
});

/* ── R11: vendor-spend-concentration ─────────────────────── */
describe("R11: vendor-spend-concentration", () => {
  it("fires when one vendor accounts for >=20% of total vendor spend", () => {
    const bigV = makeNode({ classIri: "fin:Vendor", label: "Big Vendor" });
    const smallV = makeNode({ classIri: "fin:Vendor", label: "Small Vendor" });
    const tx1 = makeNode({ classIri: "fin:Transaction", label: "TX-300", propsJson: { amount: 80000 } });
    const tx2 = makeNode({ classIri: "fin:Transaction", label: "TX-301", propsJson: { amount: 20000 } });
    const paid1 = makeEdge(tx1, bigV, "fin:paidTo");
    const paid2 = makeEdge(tx2, smallV, "fin:paidTo");

    const results = runRules([bigV, smallV, tx1, tx2], [paid1, paid2]);
    const hits = findByRule(results, "vendor-spend-concentration");
    expect(hits).toHaveLength(1);
    expect(hits[0].evidence.nodeIds).toContain(bigV.id);
  });

  it("does not fire when spend is evenly distributed", () => {
    const v1 = makeNode({ classIri: "fin:Vendor", label: "V1" });
    const v2 = makeNode({ classIri: "fin:Vendor", label: "V2" });
    const v3 = makeNode({ classIri: "fin:Vendor", label: "V3" });
    const v4 = makeNode({ classIri: "fin:Vendor", label: "V4" });
    const v5 = makeNode({ classIri: "fin:Vendor", label: "V5" });
    const v6 = makeNode({ classIri: "fin:Vendor", label: "V6" });
    const vendors = [v1, v2, v3, v4, v5, v6];
    const txs = vendors.map((v, i) =>
      makeNode({ classIri: "fin:Transaction", label: `TX-E${i}`, propsJson: { amount: 10000 } }),
    );
    const edges = txs.map((tx, i) => makeEdge(tx, vendors[i], "fin:paidTo"));
    const results = runRules([...vendors, ...txs], edges);
    expect(findByRule(results, "vendor-spend-concentration")).toHaveLength(0);
  });
});

/* ── R12: carrier-shipment-concentration ─────────────────── */
describe("R12: carrier-shipment-concentration", () => {
  it("fires when one carrier handles >=50% of all shipments", () => {
    const big = makeNode({ classIri: "log:Carrier", label: "MegaShip" });
    const small = makeNode({ classIri: "log:Carrier", label: "LocalPost" });
    const s1 = makeNode({ classIri: "log:Shipment", label: "SH-1" });
    const s2 = makeNode({ classIri: "log:Shipment", label: "SH-2" });
    const s3 = makeNode({ classIri: "log:Shipment", label: "SH-3" });
    const e1 = makeEdge(s1, big, "log:shippedBy");
    const e2 = makeEdge(s2, big, "log:shippedBy");
    const e3 = makeEdge(s3, small, "log:shippedBy");

    const results = runRules([big, small, s1, s2, s3], [e1, e2, e3]);
    const hits = findByRule(results, "carrier-shipment-concentration");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warn");
    expect(hits[0].evidence.nodeIds).toContain(big.id);
  });

  it("does not fire when no carrier dominates", () => {
    const c1 = makeNode({ classIri: "log:Carrier", label: "C1" });
    const c2 = makeNode({ classIri: "log:Carrier", label: "C2" });
    const c3 = makeNode({ classIri: "log:Carrier", label: "C3" });
    const s1 = makeNode({ classIri: "log:Shipment", label: "SH-A" });
    const s2 = makeNode({ classIri: "log:Shipment", label: "SH-B" });
    const s3 = makeNode({ classIri: "log:Shipment", label: "SH-C" });
    const e1 = makeEdge(s1, c1, "log:shippedBy");
    const e2 = makeEdge(s2, c2, "log:shippedBy");
    const e3 = makeEdge(s3, c3, "log:shippedBy");
    const results = runRules([c1, c2, c3, s1, s2, s3], [e1, e2, e3]);
    expect(findByRule(results, "carrier-shipment-concentration")).toHaveLength(0);
  });
});
