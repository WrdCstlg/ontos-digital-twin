/**
 * Ontos demo seed — Acme Corp — Production.
 * Deterministic (mulberry32, fixed seed). Wipes and reseeds all Ontos tables;
 * NEVER touches `users`.
 *
 * PLANTED ANOMALIES (consumed by the insight engine + NLQ demos):
 *  (a) exactly 3 vendors — V-2291, V-2410, V-2555 — have payment transactions
 *      but no active contract (rule: vendor-payment-without-contract)
 *  (b) exactly 2 non-CEO people (hr:Person/E-0173 and hr:Person/E-0201)
 *      have no hr:reportsTo manager edge (rule: person-without-manager)
 *  (c) exactly 2 controls are evidence-stale: CMP-118 (latest evidence 94 days
 *      ago) and CMP-131 (no evidence at all) (rule: control-without-evidence-90d)
 *  (d) exactly 5 transactions (TXN-000801..TXN-000805) have no fin:bookedTo
 *      cost-center edge (rule: transaction-without-cost-center)
 *  (e) OrgUnit "Special Projects" (OU-90) has no hr:parentUnit — org island
 *      (rule: org-island)
 *  (f) exactly 1 contract (ACME-CTR-0042) is governed by a policy
 *      (POL-07 Data Protection Policy) with an open audit finding (AF-2025-014)
 *      (rule: contract-governed-by-policy-with-open-finding)
 */
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import {
  auditLog,
  connectors,
  graphSnapshots,
  insights,
  kgEdges,
  kgNodes,
  mappings,
  ontologyClasses,
  ontologyModules,
  ontologyProperties,
  ontologyVersions,
  syncJobs,
  twinStateLog,
  workspaceMembers,
  workspaces,
} from "@db/schema";
import { reconcileInsights } from "../api/insightsRouter";

/* ── deterministic RNG ───────────────────────────────────────── */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20250914);
const ri = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];

const DAY = 24 * 3600 * 1000;
const NOW = Date.now();
const daysAgo = (n: number, jitterH = 0) =>
  new Date(NOW - n * DAY - (jitterH ? ri(0, jitterH) * 3600 * 1000 : 0));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/* ── name pools ──────────────────────────────────────────────── */
const FIRST = [
  "Aisha","Ben","Carla","Dmitri","Elena","Farid","Grace","Henrik","Ines","Jamal",
  "Keiko","Liam","Mara","Noah","Olga","Priya","Quentin","Rosa","Sam","Tara",
  "Umar","Vera","Wendell","Ximena","Yusuf","Zoe","Anders","Bianca","Casper","Dalia",
  "Elliot","Freya","Gustav","Hana","Ivan","Jade","Kofi","Lena","Mateo","Nadia",
  "Oskar","Paloma","Ravi","Selin","Tomás","Uma","Viktor","Wren","Yara","Zane",
];
const LAST = [
  "Adler","Beaumont","Castillo","Dubois","Ellison","Fontaine","Gupta","Haugen","Iversen","Jimenez",
  "Kowalski","Larsen","Moreau","Nakamura","Okafor","Petrov","Quinn","Ramachandran","Silva","Tanaka",
  "Ueda","Vasquez","Whitfield","Xu","Yamamoto","Zhang","Almeida","Barros","Chen","Dahl",
  "Eriksen","Fischer","Grimaldi","Haddad","Ivanov","Jensen","Kaur","Lindqvist","Marek","Novak",
  "Osei","Park","Reinholt","Sørensen","Tan","Urban","Vogel","Webb","Yilmaz","Zielinski",
];
const usedNames = new Set<string>();
function personName() {
  for (let i = 0; i < 200; i++) {
    const n = `${pick(FIRST)} ${pick(LAST)}`;
    if (!usedNames.has(n)) {
      usedNames.add(n);
      return n;
    }
  }
  return `${pick(FIRST)} ${pick(LAST)} Jr.`;
}

/* ── module metadata ─────────────────────────────────────────── */
const MODULES = [
  {
    key: "hr",
    name: "Human Resources",
    prefix: "hr",
    color: "#FB7185",
    version: "2.3",
    description: "People, roles, org structure, skills, compensation, and reporting lines.",
    documentation:
      "# HR module\n\nModel people as `hr:Person` with subclasses `hr:Employee` and `hr:Contractor`. Org structure via `hr:OrgUnit` trees (`hr:parentUnit`) and `hr:memberOf`. Reporting lines via `hr:reportsTo`. Employment terms via `hr:EmploymentContract`; never store comp on the person node.",
  },
  {
    key: "legal",
    name: "Legal",
    prefix: "lgl",
    color: "#A78BFA",
    version: "1.8",
    description: "Contracts, clauses, parties, obligations, jurisdictions, matters, and precedent.",
    documentation:
      "# Legal module\n\n`lgl:Contract` is the hub: clauses (`lgl:hasClause`), parties (`lgl:withParty`), jurisdiction (`lgl:inJurisdiction`), obligations, matters. Signatures come from HR via `hr:signs`.",
  },
  {
    key: "compliance",
    name: "Compliance",
    prefix: "cmp",
    color: "#34D399",
    version: "3.1",
    description: "Controls, policies, regulations, risks, audit findings, evidence, attestations, and SOX/GDPR/ISO-27001 crosswalks.",
    documentation:
      "# Compliance module\n\n`cmp:Control` mapped to frameworks through `cmp:ControlMapping`. Evidence freshness policy: every control must have `cmp:hasEvidence` younger than 90 days. Policies govern contracts (`cmp:governs`).",
  },
  {
    key: "finance",
    name: "Finance",
    prefix: "fin",
    color: "#FBBF24",
    version: "2.0",
    description: "Accounts, cost centers, transactions, budgets, invoices, vendors, fiscal periods, GL mappings.",
    documentation:
      "# Finance module\n\nEvery `fin:Transaction` should be `fin:bookedTo` a `fin:CostCenter`. Vendor payments via `fin:paidTo`. Three-way match expects an active `lgl:Contract` party link for paid vendors.",
  },
  {
    key: "logistics",
    name: "Logistics",
    prefix: "log",
    color: "#38BDF8",
    version: "1.5",
    description: "Shipments, routes, warehouses, carriers, inventory, purchase orders, delivery windows, Incoterms.",
    documentation:
      "# Logistics module\n\n`log:Shipment` connects route, carrier, warehouse, PO and delivery window. Track `status` (delivered / in_transit / delayed) against `log:DeliveryWindow`.",
  },
] as const;

/* class inventory: [label, parentLabel|null, definition] */
const CLASS_DEFS: Record<string, [string, string | null, string][]> = {
  hr: [
    ["Person", null, "A human being known to the enterprise."],
    ["Employee", "Person", "A person employed by Acme under an employment contract."],
    ["Contractor", "Person", "External worker engaged via an agency; extends Person."],
    ["Role", null, "A named job role with a responsibility set."],
    ["OrgUnit", null, "An organizational unit in the company tree."],
    ["EmploymentContract", null, "The employment agreement between Acme and a person."],
    ["TempAgreement", "EmploymentContract", "Legacy fixed-term agreement — superseded by EmploymentContract."],
    ["Skill", null, "A certifiable skill."],
    ["ReportingLine", null, "A manager→report relationship record."],
    ["CompensationBand", null, "A salary band with min/max."],
    ["PerformanceReview", null, "A periodic performance assessment."],
  ],
  legal: [
    ["Contract", null, "A legally binding agreement."],
    ["Clause", null, "A single clause within a contract."],
    ["Party", null, "A legal party to an agreement."],
    ["Obligation", null, "A duty arising from a contract."],
    ["Jurisdiction", null, "A governing-law jurisdiction."],
    ["Matter", null, "A legal matter or case file."],
    ["Regulation", null, "A regulation tracked by Legal."],
    ["Precedent", null, "A precedent relevant to Acme's positions."],
  ],
  compliance: [
    ["Control", null, "A compliance control."],
    ["Policy", null, "An internal policy."],
    ["Regulation", null, "A regulatory framework (SOX, GDPR, ISO-27001…)."],
    ["Risk", null, "A registered risk."],
    ["AuditFinding", null, "A finding raised by an audit."],
    ["Evidence", null, "Evidence supporting a control's operation."],
    ["Attestation", null, "A signed attestation of control operation."],
    ["ControlMapping", null, "Crosswalk between a control and a framework clause."],
  ],
  finance: [
    ["Account", null, "A general-ledger account."],
    ["CostCenter", null, "A cost center for spend allocation."],
    ["Transaction", null, "A booked financial transaction."],
    ["Budget", null, "A budget for a cost center and fiscal period."],
    ["Invoice", null, "A vendor invoice."],
    ["Vendor", null, "A supplier of goods or services."],
    ["FiscalPeriod", null, "A fiscal period (quarter/year)."],
    ["GLMapping", null, "Mapping from source accounts to the GL."],
  ],
  logistics: [
    ["Shipment", null, "A physical shipment of goods."],
    ["Route", null, "A named logistics route."],
    ["Warehouse", null, "A warehouse facility."],
    ["Carrier", null, "A freight carrier."],
    ["InventoryItem", null, "A stocked item."],
    ["PurchaseOrder", null, "A purchase order issued to a vendor."],
    ["DeliveryWindow", null, "A promised delivery time window."],
    ["Incoterm", null, "An Incoterms 2020 rule (FOB, DAP…)."],
  ],
};

/* property inventory: [name, kind, domainLabel, rangeLabel|null, datatype|null, cardinality] */
type PropDef = [string, "object" | "datatype", string | null, string | null, string | null, string | null, string];
const PROP_DEFS: Record<string, PropDef[]> = {
  hr: [
    ["fullName", "datatype", "Person", null, "xsd:string", "1..1", "Legal full name."],
    ["email", "datatype", "Person", null, "xsd:string", "1..1", "Work email."],
    ["empId", "datatype", "Person", null, "xsd:string", "1..1", "Employee identifier."],
    ["hireDate", "datatype", "EmploymentContract", null, "xsd:date", "1..1", "Start date."],
    ["reportsTo", "object", "Person", "Person", null, "0..1", "Manager reporting line."],
    ["memberOf", "object", "Person", "OrgUnit", null, "1..1", "Org membership."],
    ["parentUnit", "object", "OrgUnit", "OrgUnit", null, "0..1", "Parent org unit."],
    ["hasSkill", "object", "Person", "Skill", null, "0..*", "Certified skills."],
    ["employedUnder", "object", "Person", "EmploymentContract", null, "0..1", "Employment terms."],
    ["signs", "object", "Person", null, null, "0..*", "Contract signature (range lgl:Contract — cross-module axiom)."],
    ["inBand", "object", "Person", "CompensationBand", null, "0..1", "Compensation band."],
    ["hasReview", "object", "Person", "PerformanceReview", null, "0..*", "Reviews received."],
  ],
  legal: [
    ["contractNumber", "datatype", "Contract", null, "xsd:string", "1..1", "Contract number."],
    ["effectiveDate", "datatype", "Contract", null, "xsd:date", "1..1", "Effective date."],
    ["contractValue", "datatype", "Contract", null, "xsd:decimal", "0..1", "Total value."],
    ["hasClause", "object", "Contract", "Clause", null, "1..*", "Clauses of the contract."],
    ["withParty", "object", "Contract", "Party", null, "1..*", "Counterparties (may reference fin:Vendor nodes — cross-module axiom)."],
    ["inJurisdiction", "object", "Contract", "Jurisdiction", null, "1..1", "Governing law."],
    ["hasObligation", "object", "Contract", "Obligation", null, "0..*", "Duties arising."],
    ["relatesToMatter", "object", "Contract", "Matter", null, "0..*", "Linked matters."],
  ],
  compliance: [
    ["controlId", "datatype", "Control", null, "xsd:string", "1..1", "Control identifier."],
    ["severity", "datatype", "AuditFinding", null, "xsd:string", "1..1", "Finding severity."],
    ["governs", "object", "Policy", null, null, "0..*", "Policy governs contract (range lgl:Contract — cross-module axiom)."],
    ["againstPolicy", "object", "AuditFinding", "Policy", null, "0..1", "Finding raised against a policy."],
    ["hasEvidence", "object", "Control", "Evidence", null, "0..*", "Evidence of operation."],
    ["monitors", "object", "Control", null, null, "0..*", "Control monitors transaction (range fin:Transaction — cross-module axiom)."],
    ["mitigates", "object", "Control", "Risk", null, "0..*", "Risk mitigation."],
    ["attestedBy", "object", "Control", "Attestation", null, "0..*", "Attestations."],
    ["mappedVia", "object", "Control", "ControlMapping", null, "0..*", "Framework crosswalk."],
    ["mapsToRegulation", "object", "ControlMapping", "Regulation", null, "1..1", "Target framework."],
  ],
  finance: [
    ["amount", "datatype", "Transaction", null, "xsd:decimal", "1..1", "Transaction amount."],
    ["currency", "datatype", "Transaction", null, "xsd:string", "1..1", "ISO currency."],
    ["txnDate", "datatype", "Transaction", null, "xsd:date", "1..1", "Booking date."],
    ["bookedTo", "object", "Transaction", "CostCenter", null, "1..1", "Cost-center allocation."],
    ["paidTo", "object", "Transaction", "Vendor", null, "0..1", "Vendor payment."],
    ["billedTo", "object", "Invoice", "Vendor", null, "1..1", "Invoice issuer."],
    ["budgetFor", "object", "Budget", "CostCenter", null, "1..1", "Budget allocation."],
    ["inPeriod", "object", "Transaction", "FiscalPeriod", null, "1..1", "Fiscal period."],
    ["mapsTo", "object", "GLMapping", "Account", null, "1..1", "GL target account."],
  ],
  logistics: [
    ["status", "datatype", "Shipment", null, "xsd:string", "1..1", "Shipment status."],
    ["eta", "datatype", "Shipment", null, "xsd:date", "0..1", "Estimated arrival."],
    ["trackingId", "datatype", "Shipment", null, "xsd:string", "1..1", "Tracking number."],
    ["onRoute", "object", "Shipment", "Route", null, "1..1", "Route taken."],
    ["shippedBy", "object", "Shipment", "Carrier", null, "1..1", "Carrier."],
    ["fromWarehouse", "object", "Shipment", "Warehouse", null, "1..1", "Origin warehouse."],
    ["fulfills", "object", "Shipment", "PurchaseOrder", null, "0..1", "Fulfilled PO."],
    ["poVendor", "object", "PurchaseOrder", null, null, "1..1", "PO vendor (range fin:Vendor — cross-module axiom)."],
    ["hasWindow", "object", "Shipment", "DeliveryWindow", null, "0..1", "Promised window."],
    ["underIncoterm", "object", "Shipment", "Incoterm", null, "1..1", "Incoterm."],
    ["stocks", "object", "Warehouse", "InventoryItem", null, "0..*", "Stocked items."],
  ],
};

/* SHACL constraints for key classes */
const SHACL: Record<string, unknown> = {
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
      { path: "hr:endDate", sparql: "endDate >= startDate", severity: "Violation" },
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

/* ── seed body ───────────────────────────────────────────────── */

type NodeSpec = {
  iri: string;
  moduleKey: string;
  classIri: string;
  label: string;
  props?: Record<string, unknown>;
  sourceMappingId?: number | null;
  createdAt?: Date;
};
type EdgeSpec = {
  from: string; // from-iri
  to: string; // to-iri
  predicate: string;
  moduleKey?: string | null;
};

async function main() {
  const db = getDb();
  console.log("Wiping Ontos tables (users untouched)…");
  await db.delete(auditLog);
  await db.delete(graphSnapshots);
  await db.delete(insights);
  await db.delete(syncJobs);
  await db.delete(mappings);
  await db.delete(connectors);
  await db.delete(twinStateLog); // twin data from a prior db/seed-twins.ts run, if any
  await db.delete(kgEdges);
  await db.delete(kgNodes);
  await db.delete(ontologyVersions);
  await db.delete(ontologyProperties);
  await db.delete(ontologyClasses);
  await db.delete(ontologyModules);
  await db.delete(workspaceMembers);
  await db.delete(workspaces);

  /* workspace */
  const [{ id: workspaceId }] = await db
    .insert(workspaces)
    .values({ name: "Acme Corp — Production", slug: "acme-corp-production", plan: "enterprise" })
    .$returningId();
  console.log("workspace id", workspaceId);

  /* modules */
  const moduleIdByKey = new Map<string, number>();
  for (const m of MODULES) {
    const [{ id }] = await db
      .insert(ontologyModules)
      .values({
        workspaceId,
        key: m.key,
        name: m.name,
        prefix: m.prefix,
        color: m.color,
        version: m.version,
        status: "active",
        description: m.description,
        documentation: m.documentation,
        createdAt: daysAgo(28),
      })
      .$returningId();
    moduleIdByKey.set(m.key, id);
  }

  /* classes (two passes: insert, then wire parents) */
  const classIdByIri = new Map<string, number>();
  for (const m of MODULES) {
    const mid = moduleIdByKey.get(m.key)!;
    for (const [label, , def] of CLASS_DEFS[m.key]) {
      const iri = `${m.prefix}:${label}`;
      const [{ id }] = await db
        .insert(ontologyClasses)
        .values({
          moduleId: mid,
          iri,
          label,
          definition: def,
          isCustom: m.key === "hr" && label === "Contractor",
          deprecated: m.key === "hr" && label === "TempAgreement",
          shaclJson: SHACL[iri] ?? null,
          createdAt: daysAgo(label === "Contractor" ? 6 : 28),
        })
        .$returningId();
      classIdByIri.set(iri, id);
    }
  }
  for (const m of MODULES) {
    for (const [label, parent] of CLASS_DEFS[m.key]) {
      if (!parent) continue;
      const iri = `${m.prefix}:${label}`;
      await db
        .update(ontologyClasses)
        .set({ parentId: classIdByIri.get(`${m.prefix}:${parent}`)! })
        .where(eq(ontologyClasses.id, classIdByIri.get(iri)!));
    }
  }

  /* properties */
  for (const m of MODULES) {
    const mid = moduleIdByKey.get(m.key)!;
    for (const [name, kind, domain, range, datatype, card, def] of PROP_DEFS[m.key]) {
      await db.insert(ontologyProperties).values({
        moduleId: mid,
        iri: `${m.prefix}:${name}`,
        label: name,
        kind,
        domainClassId: domain ? (classIdByIri.get(`${m.prefix}:${domain}`) ?? null) : null,
        rangeClassId:
          kind === "object" && range ? (classIdByIri.get(`${m.prefix}:${range}`) ?? null) : null,
        rangeDatatype: kind === "datatype" ? datatype : null,
        cardinality: card,
        definition: def,
        createdAt: daysAgo(28),
      });
    }
  }

  /* version histories (oldest → newest) */
  const VERSIONS: Record<string, [string, string, unknown, number][]> = {
    hr: [
      ["1.0", "Initial HR module: Person, Role, OrgUnit, EmploymentContract, Skill.", { added: { classes: ["hr:Person", "hr:Role", "hr:OrgUnit", "hr:EmploymentContract", "hr:Skill"], properties: ["hr:fullName", "hr:email", "hr:reportsTo", "hr:memberOf"] }, removed: { classes: [], properties: [] }, changed: [] }, 27],
      ["2.2", "Added CompensationBand, PerformanceReview; ReportingLine reified; deprecated hr:TempAgreement.", { added: { classes: ["hr:CompensationBand", "hr:PerformanceReview", "hr:ReportingLine"], properties: ["hr:inBand", "hr:hasReview"] }, removed: { classes: [], properties: [] }, changed: [{ iri: "hr:TempAgreement", note: "deprecated" }] }, 20],
      ["2.3", "Added custom class hr:Contractor (subclass of hr:Person) with contractRate/agency properties; hr:hasSkill cardinality relaxed 1..* → 0..*.", { added: { classes: ["hr:Contractor"], properties: ["hr:contractRate", "hr:agency"] }, removed: { classes: [], properties: [] }, changed: [{ iri: "hr:hasSkill", note: "cardinality 1..* → 0..*" }] }, 6],
    ],
    legal: [
      ["1.5", "Initial Legal module.", { added: { classes: ["lgl:Contract", "lgl:Clause", "lgl:Party", "lgl:Obligation"], properties: ["lgl:hasClause", "lgl:withParty"] }, removed: { classes: [], properties: [] }, changed: [] }, 26],
      ["1.8", "Added Jurisdiction, Matter, Regulation, Precedent; lgl:inJurisdiction mandatory.", { added: { classes: ["lgl:Jurisdiction", "lgl:Matter", "lgl:Regulation", "lgl:Precedent"], properties: ["lgl:inJurisdiction", "lgl:relatesToMatter"] }, removed: { classes: [], properties: [] }, changed: [] }, 12],
    ],
    compliance: [
      ["3.0", "SOX/GDPR/ISO-27001 crosswalks via ControlMapping.", { added: { classes: ["cmp:ControlMapping"], properties: ["cmp:mappedVia", "cmp:mapsToRegulation"] }, removed: { classes: [], properties: [] }, changed: [] }, 18],
      ["3.1", "Evidence freshness rule (90 days) encoded as SHACL Warning.", { added: { classes: [], properties: [] }, removed: { classes: [], properties: [] }, changed: [{ iri: "cmp:ControlShape", note: "evidence freshness constraint added" }] }, 9],
    ],
    finance: [
      ["1.9", "Initial Finance module.", { added: { classes: ["fin:Account", "fin:CostCenter", "fin:Transaction", "fin:Vendor"], properties: ["fin:bookedTo", "fin:paidTo"] }, removed: { classes: [], properties: [] }, changed: [] }, 24],
      ["2.0", "Added Budget, Invoice, FiscalPeriod, GLMapping.", { added: { classes: ["fin:Budget", "fin:Invoice", "fin:FiscalPeriod", "fin:GLMapping"], properties: ["fin:budgetFor", "fin:inPeriod", "fin:mapsTo"] }, removed: { classes: [], properties: [] }, changed: [] }, 10],
    ],
    logistics: [
      ["1.4", "Initial Logistics module.", { added: { classes: ["log:Shipment", "log:Route", "log:Warehouse", "log:Carrier"], properties: ["log:onRoute", "log:shippedBy"] }, removed: { classes: [], properties: [] }, changed: [] }, 22],
      ["1.5", "Added InventoryItem, PurchaseOrder, DeliveryWindow, Incoterm.", { added: { classes: ["log:InventoryItem", "log:PurchaseOrder", "log:DeliveryWindow", "log:Incoterm"], properties: ["log:fulfills", "log:hasWindow", "log:underIncoterm"] }, removed: { classes: [], properties: [] }, changed: [] }, 8],
    ],
  };
  for (const m of MODULES) {
    const mid = moduleIdByKey.get(m.key)!;
    for (const [v, changelog, diff, ago] of VERSIONS[m.key]) {
      await db.insert(ontologyVersions).values({
        moduleId: mid,
        version: v,
        changelog,
        diffJson: diff,
        publishedAt: daysAgo(ago),
      });
    }
  }
  console.log("ontology seeded");

  /* ── KG instances ──────────────────────────────────────────── */
  const nodeSpecs: NodeSpec[] = [];
  const edgeSpecs: EdgeSpec[] = [];
  const node = (s: NodeSpec) => nodeSpecs.push(s);
  const edge = (from: string, predicate: string, to: string, moduleKey?: string) =>
    edgeSpecs.push({ from, to, predicate, moduleKey: moduleKey ?? null });

  /* HR: org units (8) */
  const UNITS: [string, string, string | null][] = [
    // [code, name, parentCode] — Special Projects has NO parent: planted anomaly (e)
    ["OU-00", "Acme Corp", null],
    ["OU-10", "Engineering", "OU-00"],
    ["OU-11", "Product", "OU-00"],
    ["OU-20", "Sales", "OU-00"],
    ["OU-30", "Finance Operations", "OU-00"],
    ["OU-40", "People & Culture", "OU-00"],
    ["OU-50", "Logistics Operations", "OU-00"],
    ["OU-90", "Special Projects", null],
    ["OU-91", "Innovation Lab", null], // planted anomaly (e2) — also no parent
  ];
  for (const [code, name, parent] of UNITS) {
    node({
      iri: `hr:OrgUnit/${code}`,
      moduleKey: "hr",
      classIri: "hr:OrgUnit",
      label: name,
      props: { deptCode: code, ...(code === "OU-00" ? { isRoot: true } : {}) },
      createdAt: daysAgo(28),
    });
    if (parent) edge(`hr:OrgUnit/${code}`, "hr:parentUnit", `hr:OrgUnit/${parent}`, "hr");
  }

  /* HR: skills, bands */
  const SKILLS = ["TypeScript", "SAP FI", "Contract Drafting", "SOC 2 Auditing", "SQL", "Route Optimization", "GDPR", "React", "Procurement", "Forecasting", "ISO 27001", "Freight Brokerage"];
  for (const s of SKILLS)
    node({ iri: `hr:Skill/${s.replace(/\s+/g, "-")}`, moduleKey: "hr", classIri: "hr:Skill", label: s, createdAt: daysAgo(25) });
  const BANDS = ["B1", "B2", "B3", "B4", "B5", "B6"];
  for (const b of BANDS)
    node({ iri: `hr:CompensationBand/${b}`, moduleKey: "hr", classIri: "hr:CompensationBand", label: `Band ${b}`, props: { min: 52000 + ri(0, 4) * 12000, max: 98000 + ri(0, 8) * 14000 }, createdAt: daysAgo(25) });

  /* HR: 340 persons — org tree with CEO on top */
  const HEADCOUNT = 340;
  const CEO = { id: "E-0001", name: "Marcus Webb" };
  usedNames.add(CEO.name);
  const people: { id: string; name: string; unit: string; manager: string | null; title: string; band: string }[] = [];
  people.push({ id: CEO.id, name: CEO.name, unit: "OU-00", manager: null, title: "Chief Executive Officer", band: "B6" });
  const VP_UNITS = ["OU-10", "OU-11", "OU-20", "OU-30", "OU-40", "OU-50"];
  const TITLES = ["Engineer", "Senior Engineer", "Account Executive", "Analyst", "Counsel", "Auditor", "Coordinator", "Specialist", "Manager", "Lead"];
  // 6 VPs reporting to CEO
  for (let i = 0; i < VP_UNITS.length; i++) {
    people.push({ id: `E-${String(2 + i).padStart(4, "0")}`, name: personName(), unit: VP_UNITS[i], manager: CEO.id, title: `VP ${UNITS.find((u) => u[0] === VP_UNITS[i])![1]}`, band: "B5" });
  }
  // rest of the org: assign manager = random earlier person in same unit, else VP of unit
  const ORPHAN_IDS = new Set(["E-0173", "E-0201", "E-0287", "E-0312"]); // planted anomaly (b)
  for (let i = 8; i <= HEADCOUNT; i++) {
    const id = `E-${String(i).padStart(4, "0")}`;
    const unit = i >= HEADCOUNT - 20 ? (i % 2 === 0 ? "OU-90" : "OU-91") : pick(VP_UNITS);
    const unitPool = people.filter((p) => p.unit === unit && p.id !== id);
    const vp = people.find((p) => p.unit === unit && p.manager === CEO.id);
    const manager = ORPHAN_IDS.has(id) ? null : (unitPool.length && rng() < 0.7 ? pick(unitPool) : vp)?.id ?? CEO.id;
    people.push({ id, name: personName(), unit, manager, title: pick(TITLES), band: pick(BANDS.slice(0, 4)) });
  }
  for (const p of people) {
    node({
      iri: `hr:Person/${p.id}`,
      moduleKey: "hr",
      classIri: "hr:Person",
      label: p.name,
      props: {
        empId: p.id,
        title: p.title,
        email: `${p.name.toLowerCase().replace(/[^a-z]+/g, ".")}@acme.com`,
        hireDate: iso(daysAgo(ri(30, 1500))),
        band: p.band,
        status: "active",
        ...(p.id === CEO.id ? { isCeo: true } : {}),
      },
      createdAt: daysAgo(ri(20, 27)),
    });
    // planted anomaly (b): E-0173 & E-0201 get NO reportsTo edge
    if (p.manager) edge(`hr:Person/${p.id}`, "hr:reportsTo", `hr:Person/${p.manager}`, "hr");
    edge(`hr:Person/${p.id}`, "hr:memberOf", `hr:OrgUnit/${p.unit}`, "hr");
    edge(`hr:Person/${p.id}`, "hr:inBand", `hr:CompensationBand/${p.band}`, "hr");
    for (let k = 0; k < ri(1, 3); k++) edge(`hr:Person/${p.id}`, "hr:hasSkill", `hr:Skill/${pick(SKILLS).replace(/\s+/g, "-")}`, "hr");
  }

  /* HR: ~45 contractors (custom class hr:Contractor, added in v2.3) */
  for (let i = 1; i <= 45; i++) {
    const id = `C-${String(i).padStart(4, "0")}`;
    const unit = pick(VP_UNITS);
    const vp = people.find((p) => p.unit === unit && p.manager === CEO.id)!;
    node({
      iri: `hr:Contractor/${id}`,
      moduleKey: "hr",
      classIri: "hr:Contractor",
      label: personName(),
      props: { contractorId: id, agency: pick(["Adecco", "Randstad", "Hays", "Kelly"]), contractRate: ri(55, 140), status: "active" },
      createdAt: daysAgo(ri(2, 6)),
    });
    edge(`hr:Contractor/${id}`, "hr:reportsTo", `hr:Person/${vp.id}`, "hr");
    edge(`hr:Contractor/${id}`, "hr:memberOf", `hr:OrgUnit/${unit}`, "hr");
  }

  /* HR: sample employment contracts + performance reviews */
  const sampled = new Set<string>();
  for (let i = 0; i < 90; i++) {
    const p = people[ri(1, HEADCOUNT - 1)];
    if (sampled.has(p.id)) continue;
    sampled.add(p.id);
    const ec = `hr:EmploymentContract/EC-${p.id}`;
    node({ iri: ec, moduleKey: "hr", classIri: "hr:EmploymentContract", label: `Employment — ${p.name}`, props: { startDate: iso(daysAgo(ri(100, 1200))), type: "indefinite" }, createdAt: daysAgo(24) });
    edge(`hr:Person/${p.id}`, "hr:employedUnder", ec, "hr");
    const pr = `hr:PerformanceReview/PR-${p.id}-2025H1`;
    node({ iri: pr, moduleKey: "hr", classIri: "hr:PerformanceReview", label: `2025 H1 review — ${p.name}`, props: { period: "2025-H1", rating: ri(2, 5) }, createdAt: daysAgo(90) });
    edge(`hr:Person/${p.id}`, "hr:hasReview", pr, "hr");
  }
  console.log("hr instances planned:", nodeSpecs.length);

  /* ── Legal ─────────────────────────────────────────────────── */
  const JURISDICTIONS = ["Delaware", "New York", "England & Wales", "Germany", "Singapore", "California", "Netherlands", "Ireland"];
  for (const j of JURISDICTIONS)
    node({ iri: `lgl:Jurisdiction/${j.replace(/[\s&]+/g, "-")}`, moduleKey: "legal", classIri: "lgl:Jurisdiction", label: j, createdAt: daysAgo(24) });
  const LGL_REGULATIONS = ["GDPR", "CCPA", "SOX", "HIPAA", "DORA"];
  for (const r of LGL_REGULATIONS)
    node({ iri: `lgl:Regulation/${r}`, moduleKey: "legal", classIri: "lgl:Regulation", label: r, createdAt: daysAgo(24) });
  for (let i = 1; i <= 22; i++)
    node({ iri: `lgl:Matter/M-${String(i).padStart(3, "0")}`, moduleKey: "legal", classIri: "lgl:Matter", label: `Matter M-${String(i).padStart(3, "0")}`, props: { opened: iso(daysAgo(ri(10, 300))), status: pick(["open", "closed"]) }, createdAt: daysAgo(20) });
  for (let i = 1; i <= 15; i++)
    node({ iri: `lgl:Precedent/P-${String(i).padStart(2, "0")}`, moduleKey: "legal", classIri: "lgl:Precedent", label: `Precedent ${pick(["Roe", "Peak", "Halcyon", "Meridian", "Vortex"])} v. ${pick(["State", "Global Inc", "Union", "Board"])} (${ri(1998, 2024)})`, createdAt: daysAgo(20) });
  for (let i = 1; i <= 60; i++)
    node({ iri: `lgl:Party/PTY-${String(i).padStart(3, "0")}`, moduleKey: "legal", classIri: "lgl:Party", label: `${pick(LAST)} ${pick(["Ltd.", "GmbH", "Inc.", "BV", "SAS"])}`, createdAt: daysAgo(22) });

  const CLAUSE_KINDS = ["Liability Cap", "Termination for Convenience", "Data Processing", "IP Assignment", "Governing Law", "Indemnification", "Confidentiality", "Force Majeure"];
  // contracts: 95. Vendor-linked contracts cover all vendors EXCEPT the 5 planted bad ones.
  const BAD_VENDORS = new Set(["V-2291", "V-2410", "V-2555", "V-2618", "V-2734"]); // planted anomaly (a)
  const vendorIds: string[] = [];
  for (let i = 0; i < 48; i++) vendorIds.push(`V-${2200 + ri(0, 600)}`);
  // make vendor ids deterministic + include the planted five
  const VENDORS = [...new Set([...BAD_VENDORS, ...vendorIds])].slice(0, 48);
  while (VENDORS.length < 48) VENDORS.push(`V-${2800 + VENDORS.length}`);
  const goodVendors = VENDORS.filter((v) => !BAD_VENDORS.has(v));
  const MEGA_VENDOR = goodVendors[0]; // planted anomaly (g): vendor spend concentration

  const NUM_CONTRACTS = 95;
  for (let i = 1; i <= NUM_CONTRACTS; i++) {
    const num = `ACME-CTR-${String(i).padStart(4, "0")}`;
    const status = i <= 69 ? "active" : i <= 85 ? "expired" : "draft";
    const signer = people[ri(1, HEADCOUNT - 1)];
    const jur = pick(JURISDICTIONS);
    node({
      iri: `lgl:Contract/${num}`,
      moduleKey: "legal",
      classIri: "lgl:Contract",
      label: `Contract ${num}`,
      props: { number: num, status, value: ri(10, 900) * 1000, startDate: iso(daysAgo(ri(30, 700))), endDate: iso(daysAgo(ri(-365, -30))), },
      createdAt: daysAgo(ri(15, 24)),
    });
    edge(`hr:Person/${signer.id}`, "hr:signs", `lgl:Contract/${num}`, "hr");
    edge(`lgl:Contract/${num}`, "lgl:inJurisdiction", `lgl:Jurisdiction/${jur.replace(/[\s&]+/g, "-")}`, "legal");
    // vendor party links: only good vendors get contracts (anomaly a)
    if (status === "active" && i <= goodVendors.length) {
      edge(`lgl:Contract/${num}`, "lgl:withParty", `fin:Vendor/${goodVendors[i - 1]}`, "legal");
    } else {
      edge(`lgl:Contract/${num}`, "lgl:withParty", `lgl:Party/PTY-${String(ri(1, 60)).padStart(3, "0")}`, "legal");
    }
    for (let c = 0; c < ri(2, 4); c++) {
      const cl = `lgl:Clause/${num}-CL${c + 1}`;
      node({ iri: cl, moduleKey: "legal", classIri: "lgl:Clause", label: `${pick(CLAUSE_KINDS)} (${num})`, props: { kind: pick(CLAUSE_KINDS) }, createdAt: daysAgo(20) });
      edge(`lgl:Contract/${num}`, "lgl:hasClause", cl, "legal");
    }
    if (rng() < 0.5) {
      const ob = `lgl:Obligation/${num}-OB1`;
      node({ iri: ob, moduleKey: "legal", classIri: "lgl:Obligation", label: `Obligation — ${pick(["deliver", "pay", "report", "maintain"])} (${num})`, createdAt: daysAgo(19) });
      edge(`lgl:Contract/${num}`, "lgl:hasObligation", ob, "legal");
    }
    if (rng() < 0.3)
      edge(`lgl:Contract/${num}`, "lgl:relatesToMatter", `lgl:Matter/M-${String(ri(1, 22)).padStart(3, "0")}`, "legal");
  }

  // planted anomaly (h): 5 extra active contracts expiring within 5-25 days,
  // deliberately given NO lgl:relatesToMatter (no renewal in progress)
  for (let k = 0; k < 5; k++) {
    const num = `ACME-CTR-${String(NUM_CONTRACTS + 1 + k).padStart(4, "0")}`;
    const signer = people[ri(1, HEADCOUNT - 1)];
    node({
      iri: `lgl:Contract/${num}`,
      moduleKey: "legal",
      classIri: "lgl:Contract",
      label: `Contract ${num}`,
      props: { number: num, status: "active", value: ri(40, 600) * 1000, startDate: iso(daysAgo(ri(200, 700))), endDate: iso(daysAgo(-ri(5, 25))) },
      createdAt: daysAgo(ri(15, 24)),
    });
    edge(`hr:Person/${signer.id}`, "hr:signs", `lgl:Contract/${num}`, "hr");
    edge(`lgl:Contract/${num}`, "lgl:inJurisdiction", `lgl:Jurisdiction/${pick(JURISDICTIONS).replace(/[\s&]+/g, "-")}`, "legal");
    edge(`lgl:Contract/${num}`, "lgl:withParty", `lgl:Party/PTY-${String(ri(1, 60)).padStart(3, "0")}`, "legal");
  }

  /* ── Compliance ────────────────────────────────────────────── */
  const CMP_REGS = ["SOX", "GDPR", "ISO27001"];
  for (const r of CMP_REGS)
    node({ iri: `cmp:Regulation/${r}`, moduleKey: "compliance", classIri: "cmp:Regulation", label: r, props: { framework: r }, createdAt: daysAgo(18) });
  const POLICIES: [string, string][] = [
    ["POL-01", "Code of Conduct"], ["POL-02", "Information Security Policy"], ["POL-03", "Vendor Onboarding Policy"],
    ["POL-04", "Expense Policy"], ["POL-05", "Access Management Policy"], ["POL-06", "Records Retention Policy"],
    ["POL-07", "Data Protection Policy"], ["POL-08", "Anti-Bribery Policy"], ["POL-09", "Business Continuity Policy"],
    ["POL-10", "Acceptable Use Policy"], ["POL-11", "Change Management Policy"], ["POL-12", "Incident Response Policy"],
  ];
  for (const [pid, name] of POLICIES)
    node({ iri: `cmp:Policy/${pid}`, moduleKey: "compliance", classIri: "cmp:Policy", label: name, props: { policyId: pid, version: `v${ri(1, 4)}.${ri(0, 9)}` }, createdAt: daysAgo(18) });

  // planted anomaly (f): POL-07 governs ACME-CTR-0042 and has open finding AF-2025-014
  edge("cmp:Policy/POL-07", "cmp:governs", "lgl:Contract/ACME-CTR-0042", "compliance");
  // other policy→contract governance links (policies that will NOT get open findings)
  for (const pid of ["POL-03", "POL-04", "POL-08"]) {
    for (let k = 0; k < 4; k++) edge(`cmp:Policy/${pid}`, "cmp:governs", `lgl:Contract/ACME-CTR-${String(ri(5, 44)).padStart(4, "0")}`, "compliance");
  }

  // RISK-20..22 reserved as high-severity + deliberately unmitigated (anomaly i)
  const UNMITIGATED_HIGH_RISKS = new Set(["RISK-20", "RISK-21", "RISK-22"]);
  for (let i = 1; i <= 22; i++) {
    const rid = `RISK-${String(i).padStart(2, "0")}`;
    const high = UNMITIGATED_HIGH_RISKS.has(rid);
    node({
      iri: `cmp:Risk/${rid}`,
      moduleKey: "compliance",
      classIri: "cmp:Risk",
      label: `Risk ${pick(["vendor concentration", "data leakage", "fraud", "outage", "regulatory drift"])} #${i}`,
      props: { likelihood: high ? 5 : ri(1, 5), impact: high ? 5 : ri(1, 5) },
      createdAt: daysAgo(17),
    });
  }

  const STALE_NO_EVIDENCE = new Set(["CMP-131", "CMP-150"]); // planted anomaly (c1)
  const STALE_OLD_EVIDENCE = new Set(["CMP-118", "CMP-142"]); // planted anomaly (c2)
  const CONTROL_NAMES = ["Access recertification", "Change approval", "Vendor due diligence", "Backup verification", "Log review", "Segregation of duties", "Encryption at rest", "Incident drills", "Data deletion SLA", "Penetration testing"];
  const NUM_CONTROLS = 60;
  for (let i = 1; i <= NUM_CONTROLS; i++) {
    const cid = `CMP-${100 + i}`;
    node({
      iri: `cmp:Control/${cid}`,
      moduleKey: "compliance",
      classIri: "cmp:Control",
      label: `${cid} '${i === 18 ? "Access recertification" : pick(CONTROL_NAMES)}'`,
      props: { controlId: cid, framework: pick(CMP_REGS), owner: pick(people).name },
      createdAt: daysAgo(17),
    });
    // control mappings to frameworks
    const cm = `cmp:ControlMapping/${cid}-MAP`;
    node({ iri: cm, moduleKey: "compliance", classIri: "cmp:ControlMapping", label: `${cid} ↔ ${pick(CMP_REGS)}`, createdAt: daysAgo(16) });
    edge(`cmp:Control/${cid}`, "cmp:mappedVia", cm, "compliance");
    edge(cm, "cmp:mapsToRegulation", `cmp:Regulation/${pick(CMP_REGS)}`, "compliance");
    // random mitigation links only ever target RISK-01..19 — RISK-20..22 stay unmitigated (anomaly i)
    if (rng() < 0.5) edge(`cmp:Control/${cid}`, "cmp:mitigates", `cmp:Risk/RISK-${String(ri(1, 19)).padStart(2, "0")}`, "compliance");
    if (rng() < 0.35) {
      const at = `cmp:Attestation/ATT-${cid}`;
      node({ iri: at, moduleKey: "compliance", classIri: "cmp:Attestation", label: `Attestation ${cid} 2025-Q3`, props: { signedBy: pick(people).name, signedAt: iso(daysAgo(ri(5, 60))) }, createdAt: daysAgo(15) });
      edge(`cmp:Control/${cid}`, "cmp:attestedBy", at, "compliance");
    }
    // evidence: STALE_NO_EVIDENCE get NONE; STALE_OLD_EVIDENCE's latest is 94+ days old; others fresh
    if (STALE_NO_EVIDENCE.has(cid)) continue;
    const evCount = ri(1, 3);
    for (let e = 0; e < evCount; e++) {
      const ageDays = STALE_OLD_EVIDENCE.has(cid) ? 94 + e : ri(2, 80); // ALL evidence ≥94d old (anomaly c2)
      const ev = `cmp:Evidence/${cid}-EV${e + 1}`;
      node({ iri: ev, moduleKey: "compliance", classIri: "cmp:Evidence", label: `Evidence ${cid}.${e + 1}`, props: { collectedAt: iso(daysAgo(ageDays)), kind: pick(["screenshot", "log extract", "signed PDF", "ticket export"]) }, createdAt: daysAgo(ageDays) });
      edge(`cmp:Control/${cid}`, "cmp:hasEvidence", ev, "compliance");
    }
  }

  /* audit findings: 35, 12 open; exactly one (AF-2025-014) against POL-07 */
  for (let i = 1; i <= 35; i++) {
    const fid = `AF-2025-${String(i).padStart(3, "0")}`;
    const open = i <= 11 || i === 14; // 12 open; AF-2025-014 is the planted open finding vs POL-07 (anomaly f)
    node({
      iri: `cmp:AuditFinding/${fid}`,
      moduleKey: "compliance",
      classIri: "cmp:AuditFinding",
      label: `${fid} — ${pick(["missing approval trail", "stale evidence", "policy exception", "access review gap", "documentation drift"])}`,
      props: { findingId: fid, status: open ? "open" : "closed", severity: pick(["low", "medium", "high"]), raisedAt: iso(daysAgo(ri(3, 120))) },
      createdAt: daysAgo(14),
    });
    if (fid === "AF-2025-014") edge(`cmp:AuditFinding/${fid}`, "cmp:againstPolicy", "cmp:Policy/POL-07", "compliance");
    else if (open && rng() < 0.5) {
      // open findings only point at policies that govern NO contracts,
      // keeping anomaly (f) exactly one contract
      edge(`cmp:AuditFinding/${fid}`, "cmp:againstPolicy", `cmp:Policy/${pick(["POL-02", "POL-05", "POL-10"])}`, "compliance");
    } else if (!open && rng() < 0.5) {
      edge(`cmp:AuditFinding/${fid}`, "cmp:againstPolicy", `cmp:Policy/POL-${String(ri(1, 12)).padStart(2, "0")}`, "compliance");
    }
  }
  console.log("legal+compliance instances planned:", nodeSpecs.length);

  /* ── Finance ───────────────────────────────────────────────── */
  for (const v of VENDORS)
    node({
      iri: `fin:Vendor/${v}`,
      moduleKey: "finance",
      classIri: "fin:Vendor",
      label: `${pick(LAST)} ${pick(["Supply Co", "Logistics Ltd", "Consulting", "Industries", "Group"])} (${v})`,
      props: { vendorId: v, since: ri(2015, 2024), country: pick(["US", "DE", "NL", "SG", "IE"]) },
      createdAt: daysAgo(14),
    });

  const COST_CENTERS: [string, string][] = [
    ["CC-100", "Engineering"], ["CC-110", "Platform Infra"], ["CC-120", "Product"], ["CC-200", "Sales"],
    ["CC-210", "Marketing"], ["CC-300", "Finance"], ["CC-310", "Legal"], ["CC-320", "Compliance"],
    ["CC-400", "People Ops"], ["CC-500", "Logistics"], ["CC-510", "Warehousing"], ["CC-600", "Executive"],
  ];
  for (const [code, name] of COST_CENTERS)
    node({ iri: `fin:CostCenter/${code}`, moduleKey: "finance", classIri: "fin:CostCenter", label: `${name} (${code})`, props: { code, name }, createdAt: daysAgo(14) });
  for (const [code, name] of COST_CENTERS) {
    const b = `fin:Budget/BUD-2025-${code}`;
    // calibrated so most (not all) of the 12 cost centers land under budget:
    // ~1500 txns / 12 CCs * ~$24k avg ≈ $3M avg booked per CC
    node({ iri: b, moduleKey: "finance", classIri: "fin:Budget", label: `FY2025 budget — ${name}`, props: { amount: ri(3200, 5200) * 1000, fiscalYear: 2025 }, createdAt: daysAgo(13) });
    edge(b, "fin:budgetFor", `fin:CostCenter/${code}`, "finance");
  }
  for (let i = 1; i <= 10; i++)
    node({ iri: `fin:Account/GL-${4000 + i * 10}`, moduleKey: "finance", classIri: "fin:Account", label: `GL ${4000 + i * 10} ${pick(["Operating Expenses", "COGS", "Payroll", "Travel", "Software", "Freight"])}`, createdAt: daysAgo(13) });
  for (let i = 1; i <= 12; i++) {
    const g = `fin:GLMapping/GLM-${String(i).padStart(2, "0")}`;
    node({ iri: g, moduleKey: "finance", classIri: "fin:GLMapping", label: `GL mapping src-${1000 + i} → GL`, createdAt: daysAgo(13) });
    edge(g, "fin:mapsTo", `fin:Account/GL-${4000 + ri(1, 10) * 10}`, "finance");
  }
  const PERIODS = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"];
  for (const per of PERIODS)
    node({ iri: `fin:FiscalPeriod/${per}`, moduleKey: "finance", classIri: "fin:FiscalPeriod", label: per, createdAt: daysAgo(13) });

  // 1500 transactions; TXN-000801..809 have NO cost-center edge (planted anomaly d)
  const NO_CC = new Set([801, 802, 803, 804, 805, 806, 807, 808, 809]);
  const NUM_TXNS = 1500;
  for (let i = 1; i <= NUM_TXNS; i++) {
    const tid = `TXN-${String(i).padStart(6, "0")}`;
    const vendor = rng() < 0.38 ? pick(VENDORS) : null;
    node({
      iri: `fin:Transaction/${tid}`,
      moduleKey: "finance",
      classIri: "fin:Transaction",
      label: tid,
      props: { txnId: tid, amount: ri(50, 48000) + ri(0, 99) / 100, currency: "USD", date: iso(daysAgo(ri(0, 120))), vendorRef: vendor },
      createdAt: daysAgo(ri(0, 12)),
    });
    if (!NO_CC.has(i)) edge(`fin:Transaction/${tid}`, "fin:bookedTo", `fin:CostCenter/${pick(COST_CENTERS)[0]}`, "finance");
    if (vendor) edge(`fin:Transaction/${tid}`, "fin:paidTo", `fin:Vendor/${vendor}`, "finance");
    edge(`fin:Transaction/${tid}`, "fin:inPeriod", `fin:FiscalPeriod/${pick(PERIODS)}`, "finance");
  }
  // guarantee each planted bad vendor has payments (anomaly a): 3-5 payment txns each
  let extraTxn = NUM_TXNS + 100;
  for (const bv of BAD_VENDORS) {
    for (let k = 0; k < ri(3, 5); k++) {
      const tid = `TXN-${String(extraTxn++).padStart(6, "0")}`;
      node({
        iri: `fin:Transaction/${tid}`,
        moduleKey: "finance",
        classIri: "fin:Transaction",
        label: tid,
        props: { txnId: tid, amount: ri(1200, 22000), currency: "USD", date: iso(daysAgo(ri(3, 60))), vendorRef: bv },
        createdAt: daysAgo(5),
      });
      edge(`fin:Transaction/${tid}`, "fin:bookedTo", `fin:CostCenter/CC-500`, "finance");
      edge(`fin:Transaction/${tid}`, "fin:paidTo", `fin:Vendor/${bv}`, "finance");
      edge(`fin:Transaction/${tid}`, "fin:inPeriod", `fin:FiscalPeriod/2025-Q3`, "finance");
    }
  }
  // planted anomaly (g): MEGA_VENDOR gets a burst of large payments — spend concentration
  for (let k = 0; k < 50; k++) {
    const tid = `TXN-${String(extraTxn++).padStart(6, "0")}`;
    node({
      iri: `fin:Transaction/${tid}`,
      moduleKey: "finance",
      classIri: "fin:Transaction",
      label: tid,
      props: { txnId: tid, amount: ri(60000, 110000), currency: "USD", date: iso(daysAgo(ri(1, 90))), vendorRef: MEGA_VENDOR },
      createdAt: daysAgo(6),
    });
    edge(`fin:Transaction/${tid}`, "fin:bookedTo", `fin:CostCenter/${pick(COST_CENTERS)[0]}`, "finance");
    edge(`fin:Transaction/${tid}`, "fin:paidTo", `fin:Vendor/${MEGA_VENDOR}`, "finance");
    edge(`fin:Transaction/${tid}`, "fin:inPeriod", `fin:FiscalPeriod/2025-Q4`, "finance");
  }
  // invoices
  for (let i = 1; i <= 130; i++) {
    const inv = `fin:Invoice/INV-${String(i).padStart(4, "0")}`;
    const v = pick(goodVendors);
    node({ iri: inv, moduleKey: "finance", classIri: "fin:Invoice", label: `INV-${String(i).padStart(4, "0")}`, props: { amount: ri(500, 60000), issued: iso(daysAgo(ri(2, 90))), status: pick(["paid", "open", "overdue"]) }, createdAt: daysAgo(ri(1, 12)) });
    edge(inv, "fin:billedTo", `fin:Vendor/${v}`, "finance");
  }

  // safety net (anomaly j): the budget range above is calibrated so a
  // handful of cost centers naturally exceed their budget from the random
  // transaction distribution alone — but if RNG happens to leave none over,
  // guarantee the single top spender still is, so the rule never goes empty.
  {
    const bookedByCC = new Map<string, number>();
    const ccOfTxn = new Map<string, string>();
    for (const e of edgeSpecs) {
      if (e.predicate === "fin:bookedTo") ccOfTxn.set(e.from, e.to.replace("fin:CostCenter/", ""));
    }
    for (const n of nodeSpecs) {
      if (n.classIri !== "fin:Transaction") continue;
      const cc = ccOfTxn.get(n.iri);
      if (!cc) continue;
      bookedByCC.set(cc, (bookedByCC.get(cc) ?? 0) + (Number(n.props?.amount) || 0));
    }
    const [topCC, topSpent] = [...bookedByCC.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (topCC) {
      const budgetNode = nodeSpecs.find((n) => n.iri === `fin:Budget/BUD-2025-${topCC}`);
      if (budgetNode?.props && Number(budgetNode.props.amount) > topSpent) {
        budgetNode.props.amount = Math.round(topSpent * 0.92);
      }
    }
  }

  /* ── Logistics ─────────────────────────────────────────────── */
  const ROUTES = ["EU-Central", "EU-Nordic", "NA-East", "NA-West", "APAC-SG", "Transatlantic", "Iberia", "DACH-Feeder"];
  for (const r of ROUTES)
    node({ iri: `log:Route/${r}`, moduleKey: "logistics", classIri: "log:Route", label: r, props: { distanceKm: ri(300, 9000) }, createdAt: daysAgo(12) });
  const WAREHOUSES = ["WH-Rotterdam", "WH-Memphis", "WH-Singapore", "WH-Leipzig", "WH-Dublin"];
  for (const w of WAREHOUSES)
    node({ iri: `log:Warehouse/${w}`, moduleKey: "logistics", classIri: "log:Warehouse", label: w, props: { capacity: ri(5000, 40000) }, createdAt: daysAgo(12) });
  const CARRIERS = ["C-01", "C-02", "C-03", "C-04", "C-05", "C-06", "C-07", "C-08"];
  for (const c of CARRIERS)
    node({ iri: `log:Carrier/${c}`, moduleKey: "logistics", classIri: "log:Carrier", label: `${pick(["NordFreight", "BlueRoad", "TransGlobe", "SwiftHaul"])} (${c})`, createdAt: daysAgo(12) });
  const INCOTERMS = ["EXW", "FOB", "CIF", "DAP", "DDP", "FCA"];
  for (const t of INCOTERMS)
    node({ iri: `log:Incoterm/${t}`, moduleKey: "logistics", classIri: "log:Incoterm", label: t, createdAt: daysAgo(12) });
  for (let i = 1; i <= 10; i++)
    node({ iri: `log:DeliveryWindow/DW-${String(i).padStart(2, "0")}`, moduleKey: "logistics", classIri: "log:DeliveryWindow", label: `Window ${iso(daysAgo(-ri(1, 21)))} ${pick(["08-12", "12-16", "16-20"])}`, createdAt: daysAgo(11) });
  for (let i = 1; i <= 55; i++) {
    const it = `log:InventoryItem/SKU-${String(1000 + i)}`;
    node({ iri: it, moduleKey: "logistics", classIri: "log:InventoryItem", label: `SKU-${1000 + i} ${pick(["brackets", "sensors", "packaging", "cabling", "fasteners"])}`, props: { onHand: ri(0, 4000) }, createdAt: daysAgo(11) });
    edge(pick(WAREHOUSES.map((w) => `log:Warehouse/${w}`)), "log:stocks", it, "logistics");
  }
  const NUM_POS = 95;
  for (let i = 1; i <= NUM_POS; i++) {
    const po = `log:PurchaseOrder/PO-${String(i).padStart(4, "0")}`;
    node({ iri: po, moduleKey: "logistics", classIri: "log:PurchaseOrder", label: `PO-${String(i).padStart(4, "0")}`, props: { amount: ri(800, 90000), issued: iso(daysAgo(ri(2, 100))) }, createdAt: daysAgo(10) });
    edge(po, "log:poVendor", `fin:Vendor/${pick(goodVendors)}`, "logistics");
  }
  for (let i = 1; i <= 75; i++) {
    const sid = `SHP-${String(i).padStart(3, "0")}`;
    const status = i <= 10 ? "delayed" : pick(["delivered", "delivered", "in_transit"]);
    const s = `log:Shipment/${sid}`;
    node({
      iri: s,
      moduleKey: "logistics",
      classIri: "log:Shipment",
      label: sid,
      props: { shipmentId: sid, status, eta: iso(daysAgo(-ri(1, 14))), trackingId: `TRK${ri(10 ** 8, 10 ** 9 - 1)}`, origin: pick(WAREHOUSES), dest: pick(["Berlin", "Austin", "Singapore", "Rotterdam", "Dublin"]) },
      createdAt: daysAgo(ri(1, 9)),
    });
    edge(s, "log:onRoute", `log:Route/${pick(ROUTES)}`, "logistics");
    // carrier C-08 carries ~2/3 of shipments (centrality demo + planted anomaly (k): carrier concentration)
    edge(s, "log:shippedBy", `log:Carrier/${rng() < 0.66 ? "C-08" : pick(CARRIERS)}`, "logistics");
    edge(s, "log:fromWarehouse", `log:Warehouse/${pick(WAREHOUSES)}`, "logistics");
    edge(s, "log:underIncoterm", `log:Incoterm/${pick(INCOTERMS)}`, "logistics");
    if (rng() < 0.7) edge(s, "log:fulfills", `log:PurchaseOrder/PO-${String(ri(1, NUM_POS)).padStart(4, "0")}`, "logistics");
    if (rng() < 0.5) edge(s, "log:hasWindow", `log:DeliveryWindow/DW-${String(ri(1, 10)).padStart(2, "0")}`, "logistics");
  }
  // cross-module axiom: a handful of controls monitor transactions
  for (let i = 0; i < 20; i++)
    edge(`cmp:Control/CMP-${100 + ri(1, NUM_CONTROLS)}`, "cmp:monitors", `fin:Transaction/TXN-${String(ri(1, NUM_TXNS)).padStart(6, "0")}`, "compliance");

  console.log("all instances planned:", nodeSpecs.length, "nodes,", edgeSpecs.length, "edges");

  /* ── connectors & mappings ─────────────────────────────────── */
  const HRIS_CSV = [
    "emp_id,full_name,email,manager_id,dept_code,hire_date,band,status",
    ...people.slice(0, 12).map((p) =>
      [p.id, p.name, `${p.name.toLowerCase().replace(/[^a-z]+/g, ".")}@acme.com`, p.manager ?? "", p.unit, iso(daysAgo(ri(100, 900))), p.band, "active"].join(","),
    ),
  ].join("\n");

  const [{ id: hrisConnId }] = await db
    .insert(connectors)
    .values({
      workspaceId,
      name: "HRIS Export",
      type: "csv",
      configJson: { filename: "hris-export.csv", schedule: "hourly", rows: HEADCOUNT, csvText: HRIS_CSV },
      status: "connected",
      createdAt: daysAgo(21),
    })
    .$returningId();
  const [{ id: contractsConnId }] = await db
    .insert(connectors)
    .values({
      workspaceId,
      name: "Contracts DB",
      type: "sql",
      configJson: { driver: "postgresql", host: "contracts.acme.corp", database: "contracts", mode: "cdc" },
      status: "connected",
      createdAt: daysAgo(19),
    })
    .$returningId();
  const [{ id: erpConnId }] = await db
    .insert(connectors)
    .values({
      workspaceId,
      name: "ERP REST",
      type: "rest",
      configJson: { baseUrl: "https://erp.acme.corp/api/v2", auth: "oauth2-client-credentials" },
      status: "draft",
      createdAt: daysAgo(7),
    })
    .$returningId();

  const hrModuleId = moduleIdByKey.get("hr")!;
  const lglModuleId = moduleIdByKey.get("legal")!;
  const finModuleId = moduleIdByKey.get("finance")!;
  const [{ id: hrisMapId }] = await db
    .insert(mappings)
    .values({
      connectorId: hrisConnId,
      moduleId: hrModuleId,
      name: "hris-people → hr:Person",
      sourceTable: "hris-export.csv",
      classIri: "hr:Person",
      columnMapJson: {
        subject: "hr:Person/{emp_id}",
        label: "full_name",
        fields: { full_name: "hr:fullName", email: "hr:email", emp_id: "hr:empId", band: "hr:band", status: "hr:status", hire_date: "hr:hireDate" },
        links: [
          { column: "manager_id", predicate: "hr:reportsTo", target: "hr:Person/{value}" },
          { column: "dept_code", predicate: "hr:memberOf", target: "hr:OrgUnit/{value}" },
        ],
      },
      status: "active",
      createdAt: daysAgo(21),
    })
    .$returningId();
  const [{ id: contractsMapId }] = await db
    .insert(mappings)
    .values({
      connectorId: contractsConnId,
      moduleId: lglModuleId,
      name: "contracts-db → lgl:Contract",
      sourceTable: "contracts",
      classIri: "lgl:Contract",
      columnMapJson: {
        subject: "lgl:Contract/{contract_no}",
        label: "title",
        fields: { contract_no: "lgl:contractNumber", status: "lgl:status", value: "lgl:contractValue" },
        links: [{ column: "jurisdiction", predicate: "lgl:inJurisdiction", target: "lgl:Jurisdiction/{value}" }],
      },
      status: "active",
      createdAt: daysAgo(19),
    })
    .$returningId();
  await db.insert(mappings).values({
    connectorId: erpConnId,
    moduleId: finModuleId,
    name: "erp-invoices → fin:Invoice",
    sourceTable: "invoices",
    classIri: "fin:Invoice",
    columnMapJson: {
      subject: "fin:Invoice/{invoice_no}",
      label: "invoice_no",
      fields: { amount: "fin:amount" },
      links: [{ column: "vendor_id", predicate: "fin:billedTo", target: "fin:Vendor/{value}" }],
    },
    status: "draft",
    createdAt: daysAgo(7),
  });

  /* ── materialize KG ────────────────────────────────────────── */
  console.log("inserting", nodeSpecs.length, "nodes…");
  const CHUNK = 150;
  for (let i = 0; i < nodeSpecs.length; i += CHUNK) {
    await db.insert(kgNodes).values(
      nodeSpecs.slice(i, i + CHUNK).map((n) => ({
        workspaceId,
        moduleKey: n.moduleKey,
        classIri: n.classIri,
        iri: n.iri,
        label: n.label,
        propsJson: n.props ?? {},
        sourceMappingId:
          n.sourceMappingId ??
          (n.classIri === "hr:Person" ? hrisMapId : n.classIri === "lgl:Contract" ? contractsMapId : null),
        createdAt: n.createdAt ?? daysAgo(10),
      })),
    );
  }
  const idRows = await db.select({ id: kgNodes.id, iri: kgNodes.iri }).from(kgNodes).where(eq(kgNodes.workspaceId, workspaceId));
  const idByIri = new Map(idRows.map((r) => [r.iri, r.id]));
  console.log("inserting", edgeSpecs.length, "edges…");
  let skipped = 0;
  const edgeRows: (typeof kgEdges.$inferInsert)[] = [];
  for (const e of edgeSpecs) {
    const fromId = idByIri.get(e.from);
    const toId = idByIri.get(e.to);
    if (!fromId || !toId) {
      skipped++;
      continue;
    }
    edgeRows.push({
      workspaceId,
      fromNodeId: fromId,
      toNodeId: toId,
      predicateIri: e.predicate,
      moduleKey: e.moduleKey,
      sourceMappingId: e.predicate === "hr:reportsTo" || e.predicate === "hr:memberOf" ? hrisMapId : null,
      createdAt: daysAgo(ri(0, 10)),
    });
  }
  for (let i = 0; i < edgeRows.length; i += CHUNK) {
    await db.insert(kgEdges).values(edgeRows.slice(i, i + CHUNK));
  }
  if (skipped) console.warn("skipped edges with missing endpoints:", skipped);

  /* ── sync job history ──────────────────────────────────────── */
  const SYNC_HISTORY: [number, "succeeded" | "failed", number, string, number][] = [
    // [mappingId, status, rows, snapshotLabel, daysAgo]
    [hrisMapId, "succeeded", HEADCOUNT, "v44", 6],
    [contractsMapId, "succeeded", NUM_CONTRACTS - 5, "v45", 5],
    [hrisMapId, "succeeded", HEADCOUNT + 1, "v46", 3],
    [contractsMapId, "failed", 0, "", 2],
    [contractsMapId, "succeeded", NUM_CONTRACTS, "v47", 2],
    [hrisMapId, "succeeded", HEADCOUNT, "v48", 1],
  ];
  for (const [mid, status, rows, snap, ago] of SYNC_HISTORY) {
    await db.insert(syncJobs).values({
      mappingId: mid,
      status,
      rowsProcessed: rows,
      snapshotLabel: snap || null,
      startedAt: daysAgo(ago, 6),
      finishedAt: daysAgo(ago, 5),
    });
  }

  /* ── insight engine: run rules over the real KG (twin module included
     once db/seed-twins.ts has run — reconcileInsights is safe to re-run) ── */
  const allNodes = await db.select().from(kgNodes).where(eq(kgNodes.workspaceId, workspaceId));
  const allEdges = await db.select().from(kgEdges).where(eq(kgEdges.workspaceId, workspaceId));
  const { results: fired } = await reconcileInsights(workspaceId);
  console.log("rules fired:", fired.map((f) => f.ruleId).join(", "));
  const [topRisk] = await db
    .select()
    .from(insights)
    .where(and(eq(insights.workspaceId, workspaceId), eq(insights.type, "anomaly"), eq(insights.severity, "risk")))
    .orderBy(insights.id)
    .limit(1);
  const txCount = allNodes.filter((n) => n.classIri === "fin:Transaction").length;
  await db.insert(insights).values({
    workspaceId,
    type: "narrative",
    severity: "info",
    ruleId: "weekly-narrative",
    title: "What changed this week — Acme Corp",
    summary:
      `The living graph now holds ${allNodes.length.toLocaleString()} instances and ${allEdges.length.toLocaleString()} edges across 5 modules. ` +
      `Finance recorded ${txCount} transactions; the HRIS sync upserted ${HEADCOUNT} people records. ` +
      `The insight engine raised ${fired.length} findings, including ${topRisk?.title ?? "several risk-level anomalies"} — all traceable to evidence.`,
    evidenceJson: { nodeIds: [], edgeIds: [], missingEdges: [] },
    status: "open",
    createdAt: daysAgo(0, 6),
  });

  /* ── graph snapshots ───────────────────────────────────────── */
  const byModule: Record<string, number> = {};
  for (const n of allNodes) byModule[n.moduleKey] = (byModule[n.moduleKey] ?? 0) + 1;
  const OLD_SNAPS: [string, number, number, number][] = [
    ["v44", 6, allNodes.length - 260, allEdges.length - 480],
    ["v45", 5, allNodes.length - 190, allEdges.length - 350],
    ["v46", 3, allNodes.length - 120, allEdges.length - 210],
    ["v47", 2, allNodes.length - 40, allEdges.length - 80],
  ];
  for (const [label, ago, nn, ne] of OLD_SNAPS)
    await db.insert(graphSnapshots).values({
      workspaceId,
      label,
      statsJson: { nodes: Math.max(nn, 0), edges: Math.max(ne, 0), byModule },
      createdAt: daysAgo(ago),
    });
  await db.insert(graphSnapshots).values({
    workspaceId,
    label: "v48",
    statsJson: { nodes: allNodes.length, edges: allEdges.length, byModule },
  });

  /* ── hash-chained audit log (the UX-flow story) ────────────── */
  let prevHash: string | null = null;
  const audit = async (
    actor: string,
    action: string,
    entityType: string,
    entityId: string | number | null,
    payload: unknown,
    at: Date,
  ) => {
    const canonical = canonicalPayload(actor, action, entityType, entityId, payload);
    const hash = createHash("sha256").update((prevHash ?? "") + canonical).digest("hex");
    await db.insert(auditLog).values({
      workspaceId,
      actorLabel: actor,
      action,
      entityType,
      entityId: entityId != null ? String(entityId) : null,
      payloadJson: { actor, action, entityType, entityId: entityId ?? null, payload },
      hash,
      prevHash,
      createdAt: at,
    });
    prevHash = hash;
  };

  let t = 30; // days ago; each event moves a few hours forward
  const at = () => {
    t -= 0.32;
    return new Date(NOW - Math.max(t, 0) * DAY);
  };
  await audit("D. Chen", "Created workspace 'Acme Corp — Production'", "workspace", workspaceId, { plan: "enterprise" }, at());
  for (const m of MODULES)
    await audit("D. Chen", `Activated module ${m.name} v${m.version}`, "ontology_module", m.key, { version: m.version }, at());
  await audit("Amara Okafor", "Published hr v2.2 — CompensationBand + PerformanceReview", "ontology_version", "hr@2.2", { moduleKey: "hr", version: "2.2" }, at());
  await audit("R. Alvarez", "Reviewed module coverage report", "ontology_module", "hr", { note: "coverage 96%" }, at());
  await audit("Amara Okafor", "Opened draft: extend HR with Contractor", "ontology_module", "hr", { draft: true }, at());
  await audit("Amara Okafor", "Published hr v2.3 — added class hr:Contractor", "ontology_class", "hr:Contractor", { moduleKey: "hr", version: "2.3", parent: "hr:Person" }, at());
  await audit("system", "Reasoner inferred 34 subclass relations (consistent: true)", "reasoner_run", "hr", { inferences: 34 }, at());
  await audit("D. Chen", "Created connector 'HRIS Export' (csv)", "connector", hrisConnId, { type: "csv", filename: "hris-export.csv" }, at());
  await audit("D. Chen", "Created connector 'Contracts DB' (sql)", "connector", contractsConnId, { type: "sql", host: "contracts.acme.corp" }, at());
  await audit("R. Alvarez", "Created mapping 'hris-people → hr:Person'", "mapping", hrisMapId, { sourceTable: "hris-export.csv", classIri: "hr:Person" }, at());
  await audit("R. Alvarez", "Created mapping 'contracts-db → lgl:Contract'", "mapping", contractsMapId, { sourceTable: "contracts", classIri: "lgl:Contract" }, at());
  await audit("D. Chen", "Updated mapping 'contracts-db → legal'", "mapping", contractsMapId, { note: "added jurisdiction link" }, at());
  await audit("system", "Sync 'hris-people' upserted 212 instances (v44)", "sync_job", 1, { mappingId: hrisMapId, rows: 212, snapshot: "v44" }, at());
  await audit("system", "Sync 'contracts-db' upserted 58 instances (v45)", "sync_job", 2, { mappingId: contractsMapId, rows: 58, snapshot: "v45" }, at());
  await audit("insight-engine", "Insight scan — 4 rules fired", "insight_scan", null, { fired: ["vendor-payment-without-contract", "control-without-evidence-90d", "transaction-without-cost-center", "org-island"] }, at());
  await audit("insight-engine", "Raised risk finding: 3 vendors with payments but no active contract", "insight", "fin:Vendor/V-2291", { ruleId: "vendor-payment-without-contract" }, at());
  await audit("Amara Okafor", "Acknowledged org-island finding (Special Projects under review)", "insight", null, { ruleId: "org-island" }, at());
  await audit("system", "Sync 'hris-people' upserted 213 instances (v46)", "sync_job", 3, { mappingId: hrisMapId, rows: 213, snapshot: "v46" }, at());
  await audit("system", "Sync 'contracts-db' FAILED (connection timeout)", "sync_job", 4, { mappingId: contractsMapId, error: "ETIMEDOUT" }, at());
  await audit("D. Chen", "Created connector 'ERP REST' (draft)", "connector", erpConnId, { type: "rest" }, at());
  await audit("system", "Sync 'contracts-db' upserted 60 instances (v47)", "sync_job", 5, { mappingId: contractsMapId, rows: 60, snapshot: "v47" }, at());
  await audit("Amara Okafor", "Ran NL query: 'vendors with payments but no active contract'", "nlq", null, { intent: "vendors-with-payments-no-contract" }, at());
  await audit("insight-engine", "Raised warn finding: CMP-118 no evidence in 94 days", "insight", "cmp:Control/CMP-118", { ruleId: "control-without-evidence-90d" }, at());
  await audit("S. Park", "Exported module legal v1.8 as Turtle", "ontology_module", "legal", { format: "turtle" }, at());
  await audit("Amara Okafor", "Validated module hr v2.3 — 0 violations, 2 warnings", "ontology_module", "hr", { violations: 0, warnings: 2 }, at());
  await audit("system", "Sync 'hris-people' upserted 212 instances (v48)", "sync_job", 6, { mappingId: hrisMapId, rows: 212, snapshot: "v48" }, at());
  // pad the story to ~40 entries with routine activity
  const FILLER: [string, string, string, string | null][] = [
    ["S. Park", "Viewed insight evidence trace", "insight", "fin:Vendor/V-2410"],
    ["R. Alvarez", "Ran preview on mapping 'erp-invoices'", "mapping", "erp-invoices"],
    ["insight-engine", "Insight scan — no new findings", "insight_scan", null],
    ["Amara Okafor", "Ran reasoner on hr (consistent)", "reasoner_run", "hr"],
    ["D. Chen", "Updated member role viewer → editor (R. Alvarez)", "workspace_member", null],
    ["Amara Okafor", "Generated weekly narrative", "insight", "weekly-narrative"],
    ["system", "Graph snapshot v48 captured", "graph_snapshot", "v48"],
    ["S. Park", "Searched graph: 'log:Carrier/C-08'", "graph_search", null],
    ["insight-engine", "Raised info finding: 2 people have no manager", "insight", "hr:Person/E-0173"],
    ["Amara Okafor", "Compared versions hr v2.2 → v2.3", "ontology_version", "hr@2.3"],
    ["system", "Snapshot diff v47 → v48: +40 nodes, +80 edges", "graph_snapshot", "v48"],
    ["D. Chen", "Tested LLM provider ollama (ok 210ms)", "llm_provider", "ollama"],
  ];
  for (const [actor, action, et, eid] of FILLER) await audit(actor, action, et, eid, {}, at());

  console.log("audit entries chained");
  console.log("SEED COMPLETE", {
    nodes: allNodes.length,
    edges: allEdges.length,
    insights: fired.length + 1,
  });
  process.exit(0);
}

function canonicalPayload(actor: string, action: string, entityType: string, entityId: string | number | null, payload: unknown): string {
  const canon = (v: unknown): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  };
  return canon({ actor, action, entityType, entityId: entityId ?? null, payload: payload ?? null });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
