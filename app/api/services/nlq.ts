import { and, desc, eq, isNull } from "drizzle-orm";
import { auditLog, kgEdges, kgNodes } from "@db/schema";
import type { KgEdge, KgNode } from "@db/schema";
import { getDb } from "../queries/connection";

/* ──────────────────────────────────────────────────────────────
 * Deterministic, ontology-grounded NL→query simulator.
 * Pattern-matches normalized questions against ~12 intents that are
 * grounded in the Ontos module classes/predicates, generates SPARQL +
 * Cypher + explanation, and can execute ONLY its own generated shapes.
 * ────────────────────────────────────────────────────────────── */

export type NlqBindings = Record<string, string>;

export type NlqResult = {
  recognized: boolean;
  intent?: string;
  sparql?: string;
  cypher?: string;
  explanation?: string;
  bindings?: NlqBindings;
  grounding?: { classes: string[]; predicates: string[] };
  refusal?: string;
  suggestions?: string[];
};

type IntentDef = {
  id: string;
  sample: string;
  patterns: RegExp[];
  classes: string[];
  predicates: string[];
  sparqlBody: (b: NlqBindings) => string;
  cypher: (b: NlqBindings) => string;
  explain: (b: NlqBindings) => string;
};

const UNSAFE_RE =
  /\b(delete|drop|update|insert|truncate|alter|remove|purge|fire|terminate|salary of|salaries|password|ssn|social security|credit card|diagnos|medical record)\b/i;

const INTENTS: IntentDef[] = [
  {
    id: "employees-signing-contracts-with-open-findings",
    sample: "employees who signed contracts governed by policies with open audit findings",
    patterns: [
      /employees?.*(signed|signing).*contracts?.*(polic|finding)/,
      /contracts?.*governed.*polic.*open.*finding/,
      /open audit findings?/,
    ],
    classes: ["hr:Person", "lgl:Contract", "cmp:Policy", "cmp:AuditFinding"],
    predicates: ["hr:signs", "cmp:governs", "cmp:againstPolicy"],
    sparqlBody: () => `  ?person  a hr:Person ; hr:signs ?contract .
  ?policy  a cmp:Policy ; cmp:governs ?contract .
  ?finding a cmp:AuditFinding ; cmp:againstPolicy ?policy ;
           cmp:status "open" .`,
    cypher: () =>
      `MATCH (p:hr_Person)-[:SIGNS]->(c:lgl_Contract)<-[:GOVERNS]-(pol:cmp_Policy)<-[:AGAINST_POLICY]-(f:cmp_AuditFinding {status:"open"}) RETURN p, c, pol, f`,
    explain: () =>
      "People who signed a contract that is governed by a compliance policy against which an audit finding is still open.",
  },
  {
    id: "vendors-with-payments-no-contract",
    sample: "vendors with payments but no active contract",
    patterns: [
      /vendors?.*payments?.*(no|without).*contract/,
      /vendors?.*(no|without).*active contract/,
      /uncontracted (vendor|spend)/,
    ],
    classes: ["fin:Vendor", "fin:Transaction", "lgl:Contract"],
    predicates: ["fin:paidTo", "lgl:withParty"],
    sparqlBody: () => `  ?vendor a fin:Vendor .
  ?payment a fin:Transaction ; fin:paidTo ?vendor .
  FILTER NOT EXISTS { ?contract a lgl:Contract ; lgl:withParty ?vendor ;
                      lgl:status "active" . }`,
    cypher: () =>
      `MATCH (v:fin_Vendor)<-[:PAID_TO]-(t:fin_Transaction) WHERE NOT EXISTS { (v)<-[:WITH_PARTY]-(:lgl_Contract {status:"active"}) } RETURN v, count(t), sum(t.amount)`,
    explain: () =>
      "Vendors that received at least one payment transaction but have no active contract party link — a classic three-way-match break.",
  },
  {
    id: "spend-by-cost-center",
    sample: "spend by cost center",
    patterns: [/spend by cost ?center/, /(cost ?center).*(spend|total|breakdown)/, /spend.*per cost ?center/],
    classes: ["fin:Transaction", "fin:CostCenter"],
    predicates: ["fin:bookedTo"],
    sparqlBody: () => `  ?tx a fin:Transaction ; fin:bookedTo ?cc ; fin:amount ?amount .
  ?cc a fin:CostCenter .`,
    cypher: () =>
      `MATCH (t:fin_Transaction)-[:BOOKED_TO]->(c:fin_CostCenter) RETURN c.name, count(t), sum(t.amount) ORDER BY sum(t.amount) DESC`,
    explain: () => "Total transaction amount and count grouped by the cost center each transaction is booked to.",
  },
  {
    id: "shipments-delayed",
    sample: "shipments delayed this week",
    patterns: [/shipments?.*delay/, /delayed shipments?/, /late (shipments?|deliveries)/],
    classes: ["log:Shipment", "log:Route", "log:Carrier"],
    predicates: ["log:onRoute", "log:shippedBy"],
    sparqlBody: () => `  ?shipment a log:Shipment ; log:status "delayed" .
  OPTIONAL { ?shipment log:onRoute ?route . }
  OPTIONAL { ?shipment log:shippedBy ?carrier . }`,
    cypher: () =>
      `MATCH (s:log_Shipment {status:"delayed"}) OPTIONAL MATCH (s)-[:ON_ROUTE]->(r) OPTIONAL MATCH (s)-[:SHIPPED_BY]->(c) RETURN s, r, c`,
    explain: () => "Shipments whose current status is 'delayed', with their route and carrier when known.",
  },
  {
    id: "who-reports-to",
    sample: "who reports to {manager}",
    patterns: [/who (reports|report) to ([a-z' -]+)/, /direct reports of ([a-z' -]+)/, /reports? under ([a-z' -]+)/],
    classes: ["hr:Person"],
    predicates: ["hr:reportsTo"],
    sparqlBody: (b) => `  ?employee a hr:Person ; hr:reportsTo ?manager .
  ?manager rdfs:label "${b.manager ?? ""}" .`,
    cypher: (b) =>
      `MATCH (e:hr_Person)-[:REPORTS_TO]->(m:hr_Person {name:"${b.manager ?? ""}"}) RETURN e`,
    explain: (b) => `Direct reports (hr:reportsTo) of ${b.manager ?? "the named manager"}.`,
  },
  {
    id: "count-by-module",
    sample: "how many instances per module",
    patterns: [/(how many|count).*(per|by|each) module/, /instances? (per|by) module/, /module (counts|sizes)/, /graph (stats|size)/],
    classes: [],
    predicates: [],
    sparqlBody: () => `  ?node a ?class .  # grouped by module namespace`,
    cypher: () => `MATCH (n) RETURN n.module, count(n) ORDER BY count(n) DESC`,
    explain: () => "Instance counts grouped by ontology module.",
  },
  {
    id: "orphan-employees",
    sample: "employees with no manager",
    patterns: [/(employees?|people|persons?).*(no|without).*manager/, /org islands?/, /orphan(ed)? (employees?|people)/],
    classes: ["hr:Person"],
    predicates: ["hr:reportsTo"],
    sparqlBody: () => `  ?person a hr:Person .
  FILTER NOT EXISTS { ?person hr:reportsTo ?manager . }
  FILTER NOT EXISTS { ?person hr:isCeo true . }`,
    cypher: () =>
      `MATCH (p:hr_Person) WHERE NOT (p)-[:REPORTS_TO]->() AND NOT p.isCeo RETURN p`,
    explain: () => "People (excluding the CEO) with no outgoing hr:reportsTo edge — organizational islands.",
  },
  {
    id: "controls-without-evidence",
    sample: "controls lacking evidence for 90+ days",
    patterns: [/controls?.*(no|without|lacking|stale).*evidence/, /evidence.*(90|older|stale)/, /controls?.*expir/],
    classes: ["cmp:Control", "cmp:Evidence"],
    predicates: ["cmp:hasEvidence"],
    sparqlBody: () => `  ?control a cmp:Control .
  OPTIONAL { ?control cmp:hasEvidence ?evidence . ?evidence cmp:collectedAt ?date . }
  FILTER(!BOUND(?date) || ?date < NOW() - "P90D"^^xsd:duration)`,
    cypher: () =>
      `MATCH (c:cmp_Control) OPTIONAL MATCH (c)-[:HAS_EVIDENCE]->(e) WITH c, max(e.collectedAt) AS latest WHERE latest IS NULL OR latest < date() - duration("P90D") RETURN c`,
    explain: () => "Controls whose newest evidence is older than 90 days (or missing entirely) — breaches the evidence-freshness policy.",
  },
  {
    id: "spend-without-cost-center",
    sample: "show spend without a cost center",
    patterns: [/(spend|transactions?).*without.*cost ?center/, /transactions?.*(no|missing).*cost ?center/, /unbooked (spend|transactions?)/],
    classes: ["fin:Transaction", "fin:CostCenter"],
    predicates: ["fin:bookedTo"],
    sparqlBody: () => `  ?tx a fin:Transaction ; fin:amount ?amount .
  FILTER NOT EXISTS { ?tx fin:bookedTo ?cc . }`,
    cypher: () =>
      `MATCH (t:fin_Transaction) WHERE NOT (t)-[:BOOKED_TO]->(:fin_CostCenter) RETURN t ORDER BY t.amount DESC`,
    explain: () => "Transactions with no fin:bookedTo edge to any cost center — unallocated spend.",
  },
  {
    id: "contracts-by-jurisdiction",
    sample: "contracts in jurisdiction {jurisdiction}",
    patterns: [/contracts?.*jurisdiction/, /contracts? (in|under) ([a-z -]+) law/, /governing law/],
    classes: ["lgl:Contract", "lgl:Jurisdiction"],
    predicates: ["lgl:inJurisdiction"],
    sparqlBody: (b) => `  ?contract a lgl:Contract ; lgl:inJurisdiction ?jurisdiction .${b.jurisdiction ? `\n  ?jurisdiction rdfs:label "${b.jurisdiction}" .` : ""}`,
    cypher: (b) =>
      `MATCH (c:lgl_Contract)-[:IN_JURISDICTION]->(j:lgl_Jurisdiction)${b.jurisdiction ? ` WHERE j.name = "${b.jurisdiction}"` : ""} RETURN c, j`,
    explain: (b) => `Contracts and the jurisdictions governing them${b.jurisdiction ? ` (filtered to ${b.jurisdiction})` : ""}.`,
  },
  {
    id: "top-vendors-by-spend",
    sample: "top vendors by spend",
    patterns: [/top vendors?.*spend/, /vendor spend/, /spend.*(per|by) vendor/, /highest.*vendors?/],
    classes: ["fin:Vendor", "fin:Transaction"],
    predicates: ["fin:paidTo"],
    sparqlBody: () => `  ?tx a fin:Transaction ; fin:paidTo ?vendor ; fin:amount ?amount .
  ?vendor a fin:Vendor .  # grouped by vendor, summed, descending`,
    cypher: () =>
      `MATCH (t:fin_Transaction)-[:PAID_TO]->(v:fin_Vendor) RETURN v.name, sum(t.amount) ORDER BY sum(t.amount) DESC LIMIT 10`,
    explain: () => "Vendors ranked by total payment volume.",
  },
  {
    id: "what-changed",
    sample: "what changed this week",
    patterns: [/what changed/, /changes? (this|last) (week|month)/, /recent activity/, /what happened/],
    classes: [],
    predicates: [],
    sparqlBody: () => `  # audit-log projection (not a graph pattern)
  ?event a ontos:AuditEvent ; ontos:inPeriod "P7D" .`,
    cypher: () => `// served from the append-only audit log (last 7 days)`,
    explain: () => "Summarizes audited change events (ontology edits, mappings, syncs, insights) over the last 7 days.",
  },
  {
    id: "node-lookup",
    sample: "show me {entity}",
    patterns: [/(show|find|look ?up|get|tell me about) (?:me )?(?:the )?(?:node )?(.{2,60})/],
    classes: [],
    predicates: [],
    sparqlBody: (b) => `  ?node rdfs:label ?label .
  FILTER(CONTAINS(LCASE(?label), "${(b.term ?? "").toLowerCase()}"))`,
    cypher: (b) => `MATCH (n) WHERE toLower(n.name) CONTAINS "${(b.term ?? "").toLowerCase()}" RETURN n LIMIT 25`,
    explain: (b) => `Full-text lookup of instances matching “${b.term ?? ""}”.`,
  },
];

export const NLQ_SUGGESTIONS = INTENTS.slice(0, 8).map((i) => i.sample);

function normalize(q: string) {
  return q.toLowerCase().replace(/[?!.,;:"']/g, " ").replace(/\s+/g, " ").trim();
}

function titleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
}

function extractBindings(intentId: string, raw: string, norm: string): NlqBindings {
  if (intentId === "who-reports-to") {
    const m = norm.match(/(?:reports? to|direct reports of|reports? under) ([a-z -]+)/);
    if (m) return { manager: titleCase(m[1].trim().replace(/^the /, "")) };
  }
  if (intentId === "contracts-by-jurisdiction") {
    const m = norm.match(/jurisdiction ([a-z -]+)/) ?? norm.match(/(?:in|under) ([a-z -]+) law/);
    if (m) return { jurisdiction: titleCase(m[1].trim()) };
  }
  if (intentId === "node-lookup") {
    const m = norm.match(/(?:show|find|look up|get|tell me about)(?: me)?(?: the)?(?: node)? (.+)/);
    if (m) return { term: m[1].trim() };
    return { term: raw.slice(0, 60) };
  }
  return {};
}

export function translate(question: string): NlqResult {
  const norm = normalize(question);

  if (UNSAFE_RE.test(norm)) {
    return {
      recognized: false,
      refusal:
        "This request looks like a write or unsafe operation. The Ontos query layer is read-only by design: generated queries must be SELECT-only and are validated against the ontology and a read-only AST guard before execution.",
    };
  }

  for (const intent of INTENTS) {
    if (!intent.patterns.some((p) => p.test(norm))) continue;
    const bindings = extractBindings(intent.id, question, norm);
    const sparql =
      `# intent:${intent.id}\n` +
      `# bindings:${JSON.stringify(bindings)}\n` +
      `SELECT * WHERE {\n${intent.sparqlBody(bindings)}\n}`;
    return {
      recognized: true,
      intent: intent.id,
      sparql,
      cypher: intent.cypher(bindings),
      explanation: intent.explain(bindings),
      bindings,
      grounding: { classes: intent.classes, predicates: intent.predicates },
    };
  }

  return {
    recognized: false,
    suggestions: NLQ_SUGGESTIONS,
    explanation:
      "No intent matched. The simulator recognizes ~12 ontology-grounded question shapes — try one of the suggestions.",
  };
}

/* ── execution of simulator-generated queries ────────────────── */

export type NlqExecResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  subgraph: { nodes: KgNode[]; edges: KgEdge[] };
  intent: string;
};

async function loadWorkspaceGraph(workspaceId: number) {
  const db = getDb();
  const nodes = await db
    .select()
    .from(kgNodes)
    .where(and(eq(kgNodes.workspaceId, workspaceId), isNull(kgNodes.deletedAt)));
  const edges = await db
    .select()
    .from(kgEdges)
    .where(and(eq(kgEdges.workspaceId, workspaceId), isNull(kgEdges.deletedAt)));
  return { nodes, edges };
}

function p(n: KgNode): Record<string, unknown> {
  return (n.propsJson ?? {}) as Record<string, unknown>;
}

function subgraphFor(nodeIds: Set<number>, edges: KgEdge[], nodes: KgNode[]) {
  const es = edges.filter((e) => nodeIds.has(e.fromNodeId) && nodeIds.has(e.toNodeId));
  const all = new Set(nodeIds);
  for (const e of es) {
    all.add(e.fromNodeId);
    all.add(e.toNodeId);
  }
  return { nodes: nodes.filter((n) => all.has(n.id)), edges: es.slice(0, 300) };
}

export async function executeGenerated(
  sparql: string,
  workspaceId: number,
): Promise<NlqExecResult> {
  if (/\b(INSERT|DELETE|DROP|UPDATE|CREATE|CLEAR|LOAD|COPY|MOVE|ADD)\b/i.test(sparql.replace(/^#[^\n]*\n/gm, ""))) {
    throw new Error("Refused: only read-only SELECT queries generated by the simulator can be executed.");
  }
  const intentMatch = sparql.match(/^# intent:([a-z0-9-]+)\s*$/m);
  if (!intentMatch || !INTENTS.some((i) => i.id === intentMatch[1])) {
    throw new Error(
      "Refused: query does not match a known simulator-generated shape (missing/unknown intent marker).",
    );
  }
  if (!/^\s*(#[^\n]*\n)*\s*SELECT\b/i.test(sparql)) {
    throw new Error("Refused: only SELECT query shapes are executable.");
  }
  const bindingsMatch = sparql.match(/^# bindings:(\{.*\})\s*$/m);
  let bindings: NlqBindings = {};
  if (bindingsMatch) {
    try {
      bindings = JSON.parse(bindingsMatch[1]);
    } catch {
      bindings = {};
    }
  }
  const intent = intentMatch[1];
  const { nodes, edges } = await loadWorkspaceGraph(workspaceId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<number, KgEdge[]>();
  const inc = new Map<number, KgEdge[]>();
  for (const e of edges) {
    const a = out.get(e.fromNodeId) ?? [];
    a.push(e);
    out.set(e.fromNodeId, a);
    const b = inc.get(e.toNodeId) ?? [];
    b.push(e);
    inc.set(e.toNodeId, b);
  }

  switch (intent) {
    case "employees-signing-contracts-with-open-findings": {
      const rows: Record<string, unknown>[] = [];
      const ids = new Set<number>();
      for (const f of nodes.filter((n) => n.classIri === "cmp:AuditFinding" && p(n).status === "open")) {
        for (const fe of out.get(f.id) ?? []) {
          if (fe.predicateIri !== "cmp:againstPolicy") continue;
          const policy = byId.get(fe.toNodeId);
          if (!policy) continue;
          for (const ge of out.get(policy.id) ?? []) {
            if (ge.predicateIri !== "cmp:governs") continue;
            const contract = byId.get(ge.toNodeId);
            if (!contract) continue;
            for (const se of inc.get(contract.id) ?? []) {
              if (se.predicateIri !== "hr:signs") continue;
              const person = byId.get(se.fromNodeId);
              if (!person) continue;
              rows.push({ person: person.label, contract: contract.label, policy: policy.label, finding: f.label });
              [person, contract, policy, f].forEach((n) => ids.add(n.id));
            }
          }
        }
      }
      return { columns: ["person", "contract", "policy", "finding"], rows, subgraph: subgraphFor(ids, edges, nodes), intent };
    }
    case "vendors-with-payments-no-contract": {
      const rows: Record<string, unknown>[] = [];
      const ids = new Set<number>();
      for (const v of nodes.filter((n) => n.classIri === "fin:Vendor")) {
        const pays = (inc.get(v.id) ?? []).filter((e) => e.predicateIri === "fin:paidTo");
        if (!pays.length) continue;
        const hasActive = (inc.get(v.id) ?? []).some((e) => {
          if (e.predicateIri !== "lgl:withParty") return false;
          const c = byId.get(e.fromNodeId);
          return c && p(c).status === "active";
        });
        if (hasActive) continue;
        const total = pays.reduce((s, e) => s + (Number(p(byId.get(e.fromNodeId)!)?.amount) || 0), 0);
        rows.push({ vendor: v.label, vendorIri: v.iri, payments: pays.length, totalAmount: Math.round(total * 100) / 100 });
        ids.add(v.id);
        pays.forEach((e) => ids.add(e.fromNodeId));
      }
      return { columns: ["vendor", "vendorIri", "payments", "totalAmount"], rows, subgraph: subgraphFor(ids, edges, nodes), intent };
    }
    case "spend-by-cost-center": {
      const agg = new Map<number, { label: string; total: number; n: number }>();
      const ids = new Set<number>();
      for (const t of nodes.filter((n) => n.classIri === "fin:Transaction")) {
        for (const e of (out.get(t.id) ?? []).filter((e) => e.predicateIri === "fin:bookedTo")) {
          const cc = byId.get(e.toNodeId);
          if (!cc) continue;
          const a = agg.get(cc.id) ?? { label: cc.label, total: 0, n: 0 };
          a.total += Number(p(t).amount) || 0;
          a.n++;
          agg.set(cc.id, a);
          ids.add(cc.id);
        }
      }
      const rows = [...agg.values()]
        .map((a) => ({ costCenter: a.label, transactions: a.n, totalAmount: Math.round(a.total * 100) / 100 }))
        .sort((x, y) => (y.totalAmount as number) - (x.totalAmount as number));
      return { columns: ["costCenter", "transactions", "totalAmount"], rows, subgraph: subgraphFor(ids, edges, nodes), intent };
    }
    case "shipments-delayed": {
      const rows: Record<string, unknown>[] = [];
      const ids = new Set<number>();
      for (const s of nodes.filter((n) => n.classIri === "log:Shipment" && p(n).status === "delayed")) {
        const route = (out.get(s.id) ?? []).find((e) => e.predicateIri === "log:onRoute");
        const carrier = (out.get(s.id) ?? []).find((e) => e.predicateIri === "log:shippedBy");
        rows.push({
          shipment: s.label,
          shipmentIri: s.iri,
          eta: p(s).eta ?? null,
          route: route ? byId.get(route.toNodeId)?.label : null,
          carrier: carrier ? byId.get(carrier.toNodeId)?.label : null,
        });
        ids.add(s.id);
        if (route) ids.add(route.toNodeId);
        if (carrier) ids.add(carrier.toNodeId);
      }
      return { columns: ["shipment", "shipmentIri", "eta", "route", "carrier"], rows, subgraph: subgraphFor(ids, edges, nodes), intent };
    }
    case "who-reports-to": {
      const managerName = (bindings.manager ?? "").toLowerCase();
      const matches = (n: KgNode) =>
        n.label.toLowerCase() === managerName ||
        n.label.toLowerCase().includes(managerName) ||
        String(p(n).title ?? "").toLowerCase().includes(managerName);
      const manager = nodes.find((n) => n.moduleKey === "hr" && matches(n));
      const rows: Record<string, unknown>[] = [];
      const ids = new Set<number>();
      if (manager) {
        ids.add(manager.id);
        for (const e of (inc.get(manager.id) ?? []).filter((e) => e.predicateIri === "hr:reportsTo")) {
          const emp = byId.get(e.fromNodeId);
          if (!emp) continue;
          const unit = (out.get(emp.id) ?? []).find((x) => x.predicateIri === "hr:memberOf");
          rows.push({ employee: emp.label, employeeIri: emp.iri, title: p(emp).title ?? null, orgUnit: unit ? byId.get(unit.toNodeId)?.label : null });
          ids.add(emp.id);
        }
      }
      return { columns: ["employee", "employeeIri", "title", "orgUnit"], rows, subgraph: subgraphFor(ids, edges, nodes), intent };
    }
    case "count-by-module": {
      const agg = new Map<string, number>();
      for (const n of nodes) agg.set(n.moduleKey, (agg.get(n.moduleKey) ?? 0) + 1);
      const rows = [...agg.entries()].map(([moduleKey, instances]) => ({ module: moduleKey, instances })).sort((a, b) => b.instances - a.instances);
      return { columns: ["module", "instances"], rows, subgraph: { nodes: [], edges: [] }, intent };
    }
    case "orphan-employees": {
      const rows: Record<string, unknown>[] = [];
      const ids = new Set<number>();
      for (const person of nodes.filter((n) => n.moduleKey === "hr" && ["hr:Person", "hr:Employee", "hr:Contractor"].includes(n.classIri))) {
        if (p(person).isCeo === true) continue;
        if ((out.get(person.id) ?? []).some((e) => e.predicateIri === "hr:reportsTo")) continue;
        rows.push({ person: person.label, personIri: person.iri, class: person.classIri, title: p(person).title ?? null });
        ids.add(person.id);
      }
      return { columns: ["person", "personIri", "class", "title"], rows, subgraph: subgraphFor(ids, edges, nodes), intent };
    }
    case "controls-without-evidence": {
      const now = Date.now();
      const rows: Record<string, unknown>[] = [];
      const ids = new Set<number>();
      for (const c of nodes.filter((n) => n.classIri === "cmp:Control")) {
        const evE = (out.get(c.id) ?? []).filter((e) => e.predicateIri === "cmp:hasEvidence");
        const freshest = evE.length
          ? Math.max(...evE.map((e) => Date.parse(String(p(byId.get(e.toNodeId)!)?.collectedAt ?? "")) || 0))
          : 0;
        const days = Math.floor((now - freshest) / 86400000);
        if (evE.length === 0 || days > 90) {
          rows.push({ control: c.label, controlIri: c.iri, evidenceItems: evE.length, daysSinceEvidence: evE.length ? days : null });
          ids.add(c.id);
          evE.forEach((e) => ids.add(e.toNodeId));
        }
      }
      return { columns: ["control", "controlIri", "evidenceItems", "daysSinceEvidence"], rows, subgraph: subgraphFor(ids, edges, nodes), intent };
    }
    case "spend-without-cost-center": {
      const rows: Record<string, unknown>[] = [];
      const ids = new Set<number>();
      for (const t of nodes.filter((n) => n.classIri === "fin:Transaction")) {
        if ((out.get(t.id) ?? []).some((e) => e.predicateIri === "fin:bookedTo")) continue;
        rows.push({ transaction: t.iri, amount: Number(p(t).amount) || 0, date: p(t).date ?? null, vendor: p(t).vendorRef ?? null });
        ids.add(t.id);
      }
      rows.sort((a, b) => (b.amount as number) - (a.amount as number));
      return { columns: ["transaction", "amount", "date", "vendor"], rows: rows.slice(0, 50), subgraph: subgraphFor(ids, edges, nodes), intent };
    }
    case "contracts-by-jurisdiction": {
      const filter = (bindings.jurisdiction ?? "").toLowerCase();
      const rows: Record<string, unknown>[] = [];
      const ids = new Set<number>();
      for (const c of nodes.filter((n) => n.classIri === "lgl:Contract")) {
        for (const e of (out.get(c.id) ?? []).filter((e) => e.predicateIri === "lgl:inJurisdiction")) {
          const j = byId.get(e.toNodeId);
          if (!j) continue;
          if (filter && !j.label.toLowerCase().includes(filter)) continue;
          rows.push({ contract: c.label, status: p(c).status ?? null, jurisdiction: j.label });
          ids.add(c.id);
          ids.add(j.id);
        }
      }
      return { columns: ["contract", "status", "jurisdiction"], rows, subgraph: subgraphFor(ids, edges, nodes), intent };
    }
    case "top-vendors-by-spend": {
      const agg = new Map<number, { label: string; total: number; n: number }>();
      const ids = new Set<number>();
      for (const v of nodes.filter((n) => n.classIri === "fin:Vendor")) {
        const pays = (inc.get(v.id) ?? []).filter((e) => e.predicateIri === "fin:paidTo");
        if (!pays.length) continue;
        const total = pays.reduce((s, e) => s + (Number(p(byId.get(e.fromNodeId)!)?.amount) || 0), 0);
        agg.set(v.id, { label: v.label, total, n: pays.length });
        ids.add(v.id);
      }
      const rows = [...agg.values()]
        .map((a) => ({ vendor: a.label, payments: a.n, totalAmount: Math.round(a.total * 100) / 100 }))
        .sort((a, b) => b.totalAmount - a.totalAmount)
        .slice(0, 10);
      return { columns: ["vendor", "payments", "totalAmount"], rows, subgraph: subgraphFor(ids, edges, nodes), intent };
    }
    case "what-changed": {
      const db = getDb();
      const events = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.workspaceId, workspaceId))
        .orderBy(desc(auditLog.id))
        .limit(15);
      const rows = events.map((e) => ({
        at: e.createdAt.toISOString(),
        actor: e.actorLabel,
        action: e.action,
        entityType: e.entityType,
      }));
      return { columns: ["at", "actor", "action", "entityType"], rows, subgraph: { nodes: [], edges: [] }, intent };
    }
    case "node-lookup": {
      const term = (bindings.term ?? "").toLowerCase();
      const found = nodes.filter((n) => n.label.toLowerCase().includes(term) || n.iri.toLowerCase().includes(term)).slice(0, 25);
      const ids = new Set(found.map((n) => n.id));
      const rows = found.map((n) => ({ iri: n.iri, label: n.label, class: n.classIri, module: n.moduleKey }));
      return { columns: ["iri", "label", "class", "module"], rows, subgraph: subgraphFor(ids, edges, nodes), intent };
    }
    default:
      throw new Error(`Intent '${intent}' has no executor.`);
  }
}
