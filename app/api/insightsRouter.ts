import { z } from "zod";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  graphSnapshots,
  insights,
  kgEdges,
  kgNodes,
  syncJobs,
  mappings,
  auditLog,
} from "@db/schema";
import type { KgEdge, KgNode } from "@db/schema";
import { createRouter, workspaceQuery, workspaceMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { scanRateLimiter } from "./lib/rateLimit";
import { actorLabelFor, writeAudit } from "./services/audit";

type Evidence = {
  nodeIds: number[];
  edgeIds: number[];
  missingEdges: { fromIri: string; toIri: string; predicate: string }[];
};

type RuleFinding = {
  ruleId: string;
  severity: "info" | "warn" | "risk";
  title: string;
  summary: string;
  evidence: Evidence;
};

async function loadGraph(workspaceId: number) {
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

function props(n: KgNode): Record<string, unknown> {
  return (n.propsJson ?? {}) as Record<string, unknown>;
}

/**
 * Deterministic anomaly rules over the KG. Returns fresh findings.
 * Rules mirror the planted seed anomalies + generic hygiene checks.
 */
export function runRules(nodes: KgNode[], edges: KgEdge[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const out = new Map<number, KgEdge[]>();
  const inc = new Map<number, KgEdge[]>();
  for (const e of edges) {
    (out.get(e.fromNodeId) ?? out.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e);
    (inc.get(e.toNodeId) ?? inc.set(e.toNodeId, []).get(e.toNodeId)!).push(e);
  }
  const byIri = new Map(nodes.map((n) => [n.iri, n]));

  // R1: vendors with payment transactions but no active contract
  {
    const vendors = nodes.filter((n) => n.classIri === "fin:Vendor");
    const bad: { v: KgNode; payEdges: KgEdge[] }[] = [];
    for (const v of vendors) {
      const payEdges = (inc.get(v.id) ?? []).filter((e) => e.predicateIri === "fin:paidTo");
      if (payEdges.length === 0) continue;
      const contractEdges = (inc.get(v.id) ?? []).filter((e) => e.predicateIri === "lgl:withParty");
      const hasActive = contractEdges.some((e) => {
        const c = byIri.get(nodes.find((n) => n.id === e.fromNodeId)?.iri ?? "");
        return c && props(c).status === "active";
      });
      if (!hasActive) bad.push({ v, payEdges });
    }
    if (bad.length) {
      findings.push({
        ruleId: "vendor-payment-without-contract",
        severity: "risk",
        title: `${bad.length} vendors received payments but have no active contract`,
        summary: `Payment transactions settle to vendors with no active lgl:Contract party link: ${bad
          .map((b) => b.v.label)
          .join(", ")}. Expected by axiom: fin:payment —settles→ lgl:Contract.`,
        evidence: {
          nodeIds: bad.flatMap((b) => [b.v.id, ...b.payEdges.map((e) => e.fromNodeId)]),
          edgeIds: bad.flatMap((b) => b.payEdges.map((e) => e.id)),
          missingEdges: bad.map((b) => ({
            fromIri: b.v.iri,
            toIri: "lgl:Contract",
            predicate: "lgl:partyTo",
          })),
        },
      });
    }
  }

  // R2: non-CEO persons with no manager reporting line
  {
    const persons = nodes.filter(
      (n) => n.moduleKey === "hr" && (n.classIri === "hr:Person" || n.classIri === "hr:Employee" || n.classIri === "hr:Contractor"),
    );
    const orphans = persons.filter((p) => {
      if (props(p).isCeo === true) return false;
      return !(out.get(p.id) ?? []).some((e) => e.predicateIri === "hr:reportsTo");
    });
    if (orphans.length) {
      findings.push({
        ruleId: "person-without-manager",
        severity: "info",
        title: `${orphans.length} people have no manager (org islands)`,
        summary: `No hr:reportsTo edge: ${orphans
          .map((p) => `${p.label} (${p.iri})`)
          .join(", ")}.`,
        evidence: {
          nodeIds: orphans.map((p) => p.id),
          edgeIds: [],
          missingEdges: orphans.map((p) => ({
            fromIri: p.iri,
            toIri: "hr:Person",
            predicate: "hr:reportsTo",
          })),
        },
      });
    }
  }

  // R3: controls with no fresh evidence (>90 days) or none at all
  {
    const now = Date.now();
    const stale = nodes.filter((n) => n.classIri === "cmp:Control").filter((c) => {
      const evEdges = (out.get(c.id) ?? []).filter((e) => e.predicateIri === "cmp:hasEvidence");
      if (evEdges.length === 0) return true;
      const freshest = Math.max(
        ...evEdges.map((e) => {
          const ev = nodes.find((n) => n.id === e.toNodeId);
          const d = ev ? Date.parse(String(props(ev).collectedAt ?? "")) : NaN;
          return Number.isFinite(d) ? d : 0;
        }),
      );
      return now - freshest > 90 * 24 * 3600 * 1000;
    });
    if (stale.length) {
      findings.push({
        ruleId: "control-without-evidence-90d",
        severity: "warn",
        title: `${stale.length} controls have no evidence in 90+ days`,
        summary: `Controls breaching the 90-day evidence freshness policy: ${stale
          .map((c) => c.label)
          .join("; ")}.`,
        evidence: {
          nodeIds: stale.map((c) => c.id),
          edgeIds: stale.flatMap((c) =>
            (out.get(c.id) ?? []).filter((e) => e.predicateIri === "cmp:hasEvidence").map((e) => e.id),
          ),
          missingEdges: stale.map((c) => ({
            fromIri: c.iri,
            toIri: "cmp:Evidence",
            predicate: "cmp:hasEvidence",
          })),
        },
      });
    }
  }

  // R4: transactions with no cost center
  {
    const txs = nodes.filter((n) => n.classIri === "fin:Transaction");
    const unbooked = txs.filter(
      (t) => !(out.get(t.id) ?? []).some((e) => e.predicateIri === "fin:bookedTo"),
    );
    if (unbooked.length) {
      findings.push({
        ruleId: "transaction-without-cost-center",
        severity: "risk",
        title: `${unbooked.length} transactions have no cost center`,
        summary: `Transactions missing fin:bookedTo: ${unbooked
          .map((t) => t.iri)
          .join(", ")} — total ${unbooked
          .reduce((s, t) => s + (Number(props(t).amount) || 0), 0)
          .toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}.`,
        evidence: {
          nodeIds: unbooked.map((t) => t.id),
          edgeIds: [],
          missingEdges: unbooked.map((t) => ({
            fromIri: t.iri,
            toIri: "fin:CostCenter",
            predicate: "fin:bookedTo",
          })),
        },
      });
    }
  }

  // R5: contracts governed by policies with open audit findings
  {
    const openFindings = nodes.filter(
      (n) => n.classIri === "cmp:AuditFinding" && props(n).status === "open",
    );
    const hits: { contract: KgNode; policy: KgNode; finding: KgNode; pathEdgeIds: number[] }[] = [];
    for (const f of openFindings) {
      for (const fe of out.get(f.id) ?? []) {
        if (fe.predicateIri !== "cmp:againstPolicy") continue;
        const policy = nodes.find((n) => n.id === fe.toNodeId);
        if (!policy) continue;
        for (const ge of out.get(policy.id) ?? []) {
          if (ge.predicateIri !== "cmp:governs") continue;
          const contract = nodes.find((n) => n.id === ge.toNodeId);
          if (contract) hits.push({ contract, policy, finding: f, pathEdgeIds: [fe.id, ge.id] });
        }
      }
    }
    if (hits.length) {
      findings.push({
        ruleId: "contract-governed-by-policy-with-open-finding",
        severity: "risk",
        title: `${hits.length} contract${hits.length === 1 ? "" : "s"} governed by ${hits.length === 1 ? "a policy" : "policies"} with open audit findings`,
        summary: hits
          .map((h) => `${h.contract.label} ← ${h.policy.label} ← open finding ${h.finding.label}`)
          .join("; "),
        evidence: {
          nodeIds: hits.flatMap((h) => [h.contract.id, h.policy.id, h.finding.id]),
          edgeIds: hits.flatMap((h) => h.pathEdgeIds),
          missingEdges: [],
        },
      });
    }
  }

  // R6: org islands — OrgUnits with no parent unit
  {
    const units = nodes.filter((n) => n.classIri === "hr:OrgUnit");
    const islands = units.filter(
      (u) =>
        props(u).isRoot !== true &&
        !(out.get(u.id) ?? []).some((e) => e.predicateIri === "hr:parentUnit"),
    );
    if (islands.length) {
      findings.push({
        ruleId: "org-island",
        severity: "warn",
        title: `${islands.length} org unit${islands.length === 1 ? "" : "s"} detached from the org tree`,
        summary: `OrgUnits with no hr:parentUnit: ${islands.map((u) => u.label).join(", ")}.`,
        evidence: {
          nodeIds: islands.map((u) => u.id),
          edgeIds: [],
          missingEdges: islands.map((u) => ({
            fromIri: u.iri,
            toIri: "hr:OrgUnit",
            predicate: "hr:parentUnit",
          })),
        },
      });
    }
  }

  // R7: digital twin cold-chain excursion — temperature outside 2°C–6°C
  {
    const COLD_MIN = 2;
    const COLD_MAX = 6;
    const twinNodes = nodes.filter(
      (n) =>
        (n.classIri === "dtwin:ZoneTwin" && props(n).zoneType === "cold-chain") ||
        n.classIri === "dtwin:ShipmentTwin",
    );
    const excursions = twinNodes.filter((n) => {
      const temp = Number(props(n).temperature);
      return Number.isFinite(temp) && (temp < COLD_MIN || temp > COLD_MAX);
    });
    if (excursions.length) {
      findings.push({
        ruleId: "twin-cold-chain-excursion",
        severity: "risk",
        title: `${excursions.length} digital twin${excursions.length === 1 ? "" : "s"} report temperature excursion`,
        summary: `Cold-chain breach (outside ${COLD_MIN}–${COLD_MAX}°C): ${excursions
          .map((n) => `${n.label} (${props(n).temperature}°C)`)
          .join("; ")}.`,
        evidence: {
          nodeIds: excursions.map((n) => n.id),
          edgeIds: [],
          missingEdges: [],
        },
      });
    }
  }

  // R8: cost centers whose booked transactions exceed their FY2025 budget
  {
    const budgets = nodes.filter((n) => n.classIri === "fin:Budget");
    const ccTotals = new Map<number, number>();
    for (const t of nodes.filter((n) => n.classIri === "fin:Transaction")) {
      const ccEdge = (out.get(t.id) ?? []).find((e) => e.predicateIri === "fin:bookedTo");
      if (!ccEdge) continue;
      ccTotals.set(ccEdge.toNodeId, (ccTotals.get(ccEdge.toNodeId) ?? 0) + (Number(props(t).amount) || 0));
    }
    const over: { budget: KgNode; cc: KgNode; spent: number; budgeted: number }[] = [];
    for (const b of budgets) {
      const ccEdge = (out.get(b.id) ?? []).find((e) => e.predicateIri === "fin:budgetFor");
      const cc = ccEdge && nodes.find((n) => n.id === ccEdge.toNodeId);
      if (!cc) continue;
      const spent = ccTotals.get(cc.id) ?? 0;
      const budgeted = Number(props(b).amount) || 0;
      if (budgeted > 0 && spent > budgeted) over.push({ budget: b, cc, spent, budgeted });
    }
    if (over.length) {
      const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
      findings.push({
        ruleId: "budget-overrun",
        severity: "risk",
        title: `${over.length} cost center${over.length === 1 ? "" : "s"} exceeded their FY2025 budget`,
        summary: over
          .map((o) => `${o.cc.label}: booked ${money(o.spent)} against a ${money(o.budgeted)} budget (+${money(o.spent - o.budgeted)})`)
          .join("; "),
        evidence: {
          nodeIds: over.flatMap((o) => [o.budget.id, o.cc.id]),
          edgeIds: [],
          missingEdges: [],
        },
      });
    }
  }

  // R9: high-severity risks (likelihood × impact ≥ 16) with no mitigating control
  {
    const highRisks = nodes.filter((n) => {
      if (n.classIri !== "cmp:Risk") return false;
      const p = props(n);
      return (Number(p.likelihood) || 0) * (Number(p.impact) || 0) >= 16;
    });
    const unmitigated = highRisks.filter(
      (r) => !(inc.get(r.id) ?? []).some((e) => e.predicateIri === "cmp:mitigates"),
    );
    if (unmitigated.length) {
      findings.push({
        ruleId: "unmitigated-high-risk",
        severity: "risk",
        title: `${unmitigated.length} high-severity risk${unmitigated.length === 1 ? "" : "s"} have no mitigating control`,
        summary: `No cmp:Control —mitigates→ edge: ${unmitigated.map((r) => r.label).join(", ")}.`,
        evidence: {
          nodeIds: unmitigated.map((r) => r.id),
          edgeIds: [],
          missingEdges: unmitigated.map((r) => ({
            fromIri: "cmp:Control",
            toIri: r.iri,
            predicate: "cmp:mitigates",
          })),
        },
      });
    }
  }

  // R10: active contracts expiring within 30 days with no renewal matter tracked
  {
    const now = Date.now();
    const soon = now + 30 * 24 * 3600 * 1000;
    const expiring = nodes.filter((n) => {
      if (n.classIri !== "lgl:Contract" || props(n).status !== "active") return false;
      const end = Date.parse(String(props(n).endDate ?? ""));
      if (!Number.isFinite(end) || end > soon || end < now) return false;
      return !(out.get(n.id) ?? []).some((e) => e.predicateIri === "lgl:relatesToMatter");
    });
    if (expiring.length) {
      findings.push({
        ruleId: "contract-expiring-without-renewal",
        severity: "warn",
        title: `${expiring.length} contract${expiring.length === 1 ? "" : "s"} expire within 30 days with no renewal in progress`,
        summary: `Active, no lgl:relatesToMatter link: ${expiring
          .map((c) => `${c.label} (expires ${props(c).endDate})`)
          .join("; ")}.`,
        evidence: {
          nodeIds: expiring.map((c) => c.id),
          edgeIds: [],
          missingEdges: expiring.map((c) => ({
            fromIri: c.iri,
            toIri: "lgl:Matter",
            predicate: "lgl:relatesToMatter",
          })),
        },
      });
    }
  }

  // R11: vendor spend concentration — one vendor over 20% of total vendor spend
  {
    const spendByVendor = new Map<number, number>();
    let total = 0;
    for (const t of nodes.filter((n) => n.classIri === "fin:Transaction")) {
      const vEdge = (out.get(t.id) ?? []).find((e) => e.predicateIri === "fin:paidTo");
      if (!vEdge) continue;
      const amt = Number(props(t).amount) || 0;
      spendByVendor.set(vEdge.toNodeId, (spendByVendor.get(vEdge.toNodeId) ?? 0) + amt);
      total += amt;
    }
    const concentrated: { v: KgNode; amount: number; share: number }[] = [];
    if (total > 0) {
      for (const [vId, amount] of spendByVendor) {
        const share = amount / total;
        if (share > 0.2) {
          const v = nodes.find((n) => n.id === vId);
          if (v) concentrated.push({ v, amount, share });
        }
      }
    }
    if (concentrated.length) {
      const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
      findings.push({
        ruleId: "vendor-spend-concentration",
        severity: "warn",
        title: `${concentrated.length} vendor${concentrated.length === 1 ? "" : "s"} account${concentrated.length === 1 ? "s" : ""} for over 20% of total vendor spend`,
        summary: concentrated
          .map((c) => `${c.v.label}: ${money(c.amount)} (${Math.round(c.share * 100)}% of total vendor spend)`)
          .join("; "),
        evidence: {
          nodeIds: concentrated.map((c) => c.v.id),
          edgeIds: [],
          missingEdges: [],
        },
      });
    }
  }

  // R12: carrier shipment concentration — one carrier over half of all shipments
  {
    const shipments = nodes.filter((n) => n.classIri === "log:Shipment");
    const byCarrier = new Map<number, number>();
    for (const s of shipments) {
      const cEdge = (out.get(s.id) ?? []).find((e) => e.predicateIri === "log:shippedBy");
      if (!cEdge) continue;
      byCarrier.set(cEdge.toNodeId, (byCarrier.get(cEdge.toNodeId) ?? 0) + 1);
    }
    const concentrated: { c: KgNode; count: number; share: number }[] = [];
    if (shipments.length > 0) {
      for (const [cId, cnt] of byCarrier) {
        const share = cnt / shipments.length;
        if (share > 0.5) {
          const c = nodes.find((n) => n.id === cId);
          if (c) concentrated.push({ c, count: cnt, share });
        }
      }
    }
    if (concentrated.length) {
      findings.push({
        ruleId: "carrier-shipment-concentration",
        severity: "warn",
        title: `${concentrated.length} carrier${concentrated.length === 1 ? "" : "s"} handle${concentrated.length === 1 ? "s" : ""} over half of all shipments`,
        summary: concentrated
          .map((c) => `${c.c.label}: ${c.count} of ${shipments.length} shipments (${Math.round(c.share * 100)}%) — single point of failure`)
          .join("; "),
        evidence: {
          nodeIds: concentrated.map((c) => c.c.id),
          edgeIds: [],
          missingEdges: [],
        },
      });
    }
  }

  return findings;
}

/**
 * Recompute all rule findings and upsert them into `insights` by ruleId.
 * Shared by the runScan mutation and the seed scripts, so the persisted
 * insight set always matches whatever's actually in the graph.
 */
export type ReconcileResult = { ruleId: string; status: "created" | "updated"; insightId: number };

export async function reconcileInsights(
  workspaceId: number,
): Promise<{ scanned: { nodes: number; edges: number }; results: ReconcileResult[] }> {
  const db = getDb();
  const { nodes, edges } = await loadGraph(workspaceId);
  const findings = runRules(nodes, edges);
  const existing = await db.select().from(insights).where(eq(insights.workspaceId, workspaceId));
  const byRule = new Map(existing.map((i) => [i.ruleId, i]));
  const results: ReconcileResult[] = [];
  for (const f of findings) {
    const ex = f.ruleId ? byRule.get(f.ruleId) : undefined;
    if (ex) {
      await db
        .update(insights)
        .set({ title: f.title, summary: f.summary, severity: f.severity, evidenceJson: f.evidence })
        .where(eq(insights.id, ex.id));
      results.push({ ruleId: f.ruleId, status: "updated", insightId: ex.id });
    } else {
      const [{ id }] = await db
        .insert(insights)
        .values({
          workspaceId,
          type: "anomaly",
          severity: f.severity,
          ruleId: f.ruleId,
          title: f.title,
          summary: f.summary,
          evidenceJson: f.evidence,
          status: "open",
        })
        .$returningId();
      results.push({ ruleId: f.ruleId, status: "created", insightId: id });
    }
  }
  return { scanned: { nodes: nodes.length, edges: edges.length }, results };
}

export const insightsRouter = createRouter({
  list: workspaceQuery
    .input(
      z
        .object({
          severity: z.enum(["info", "warn", "risk"]).optional(),
          type: z.enum(["anomaly", "analytics", "narrative"]).optional(),
          status: z.enum(["open", "acknowledged"]).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const conds = [eq(insights.workspaceId, ws.id)];
      if (input?.severity) conds.push(eq(insights.severity, input.severity));
      if (input?.type) conds.push(eq(insights.type, input.type));
      if (input?.status) conds.push(eq(insights.status, input.status));
      return db
        .select()
        .from(insights)
        .where(and(...conds))
        .orderBy(desc(insights.id))
        .limit(input?.limit ?? 50);
    }),

  acknowledge: workspaceMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const [row] = await db
        .select()
        .from(insights)
        .where(and(eq(insights.id, input.id), eq(insights.workspaceId, ws.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Insight ${input.id} not found` });
      await db.update(insights).set({ status: "acknowledged" }).where(eq(insights.id, input.id));
      await writeAudit({
        workspaceId: ws.id,
        actor: actorLabelFor(ctx.user),
        action: `Acknowledged insight '${row.title}'`,
        entityType: "insight",
        entityId: input.id,
        payload: { ruleId: row.ruleId, severity: row.severity },
      });
      return { ok: true };
    }),

  runScan: workspaceMutation.mutation(async ({ ctx }) => {
    const rateCheck = scanRateLimiter.check(String(ctx.user?.id ?? "anon"));
    if (!rateCheck.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Insight scan rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetMs / 1000)} seconds.`,
      });
    }
    const ws = ctx.workspace;
    const { scanned, results } = await reconcileInsights(ws.id);
    await writeAudit({
      workspaceId: ws.id,
      actor: actorLabelFor(ctx.user),
      action: `Insight engine scan — ${results.length} rules fired`,
      entityType: "insight_scan",
      entityId: null,
      payload: { fired: results.map((f) => f.ruleId) },
    });
    return { scanned, findings: results };
  }),

  narrative: workspaceQuery
    .input(z.object({ period: z.enum(["week", "month"]).default("week") }))
    .query(async ({ ctx, input }) => {
      // Deterministic, template-based narrative grounded in live DB numbers.
      const ws = ctx.workspace;
      const db = getDb();
      const { nodes, edges } = await loadGraph(ws.id);
      const byModule = new Map<string, number>();
      for (const n of nodes) byModule.set(n.moduleKey, (byModule.get(n.moduleKey) ?? 0) + 1);
      const openInsights = await db
        .select()
        .from(insights)
        .where(and(eq(insights.workspaceId, ws.id), eq(insights.status, "open")));
      const riskCount = openInsights.filter((i) => i.severity === "risk").length;
      const warnCount = openInsights.filter((i) => i.severity === "warn").length;
      const infoCount = openInsights.filter((i) => i.severity === "info").length;
      const [snap] = await db
        .select()
        .from(graphSnapshots)
        .where(eq(graphSnapshots.workspaceId, ws.id))
        .orderBy(desc(graphSnapshots.id))
        .limit(1);
      const since = new Date(Date.now() - (input.period === "week" ? 7 : 30) * 24 * 3600 * 1000);
      const recentAudit = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.workspaceId, ws.id))
        .orderBy(desc(auditLog.id))
        .limit(200);
      const recent = recentAudit.filter((a) => a.createdAt >= since);
      const syncs = recent.filter((a) => a.entityType === "sync_job").length;
      const ontologyChanges = recent.filter((a) => a.entityType === "ontology_class").length;
      const [jobCount] = await db
        .select({ n: count() })
        .from(syncJobs)
        .innerJoin(mappings, eq(syncJobs.mappingId, mappings.id));
      const people = byModule.get("hr") ?? 0;
      const contracts = nodes.filter((n) => n.classIri === "lgl:Contract").length;
      const controls = nodes.filter((n) => n.classIri === "cmp:Control").length;
      const transactions = nodes.filter((n) => n.classIri === "fin:Transaction").length;
      const shipments = nodes.filter((n) => n.classIri === "log:Shipment").length;

      const title = `What changed this ${input.period} — ${ws.name.replace(/ —.*/, "")}`;
      const body =
        `The knowledge graph now holds ${nodes.length.toLocaleString()} instances and ${edges.length.toLocaleString()} edges across ${byModule.size} modules` +
        `${snap ? ` (snapshot ${snap.label})` : ""}. ` +
        `HR tracks ${people} people nodes; Legal holds ${contracts} contracts; Compliance monitors ${controls} controls; ` +
        `Finance recorded ${transactions} transactions; Logistics moved ${shipments} shipments. ` +
        `Over the last ${input.period}, the platform logged ${recent.length} audited events (${syncs} sync runs, ${ontologyChanges} ontology changes). ` +
        `The insight engine currently reports ${openInsights.length} open findings — ${riskCount} risk, ${warnCount} warnings, ${infoCount} informational. ` +
        (riskCount > 0
          ? `Most urgent: “${openInsights.find((i) => i.severity === "risk")?.title}”. Every finding is traceable to its evidence subgraph.`
          : `No risk-level findings are open.`);

      return {
        period: input.period,
        title,
        body,
        grounding: {
          snapshot: snap?.label ?? null,
          nodes: nodes.length,
          edges: edges.length,
          openInsights: openInsights.length,
          syncJobsTotal: Number(jobCount?.n ?? 0),
          auditEventsInPeriod: recent.length,
        },
        generatedAt: new Date(),
      };
    }),
});
