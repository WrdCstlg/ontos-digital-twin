import { moduleForPrefix, type ModuleKey } from '@/lib/modules';
import type { InsightRow } from './types';

/**
 * Insight engine rule metadata — presentation layer for the deterministic
 * rules implemented in api/insightsRouter.ts (ruleId keyed).
 */

export type Severity = 'risk' | 'warn' | 'info';

export const SEVERITY_ORDER: Severity[] = ['risk', 'warn', 'info'];

export const SEVERITY_COLOR: Record<Severity, string> = {
  risk: '#F87171',
  warn: '#FBBF24',
  info: '#38BDF8',
};

export interface RuleMeta {
  /** Mono insight-type chip, e.g. ORPHAN-DETECTION */
  typeChip: string;
  /** Modules involved (drives ModuleBadges + module filter) */
  modules: ModuleKey[];
  /** Mono rule definition shown in the trace drawer provenance block */
  ruleText: string;
}

export const RULE_META: Record<string, RuleMeta> = {
  'vendor-payment-without-contract': {
    typeChip: 'ORPHAN-DETECTION',
    modules: ['finance', 'legal'],
    ruleText:
      '?tx a fin:Transaction ; fin:paidTo ?v .\nFILTER NOT EXISTS {\n  ?c a lgl:Contract ; lgl:withParty ?v ; lgl:status "active" .\n}',
  },
  'person-without-manager': {
    typeChip: 'ORPHAN-DETECTION',
    modules: ['hr'],
    ruleText: '?p a hr:Person .\nFILTER NOT EXISTS { ?p hr:reportsTo ?m . }\nFILTER(?p.isCeo != true)',
  },
  'control-without-evidence-90d': {
    typeChip: 'RULE-ALERT',
    modules: ['compliance'],
    ruleText: '?control a cmp:Control ; cmp:hasEvidence ?e .\nFILTER(?e.collectedAt < NOW() - "P90D"^^xsd:duration)',
  },
  'transaction-without-cost-center': {
    typeChip: 'CDC-DELTA',
    modules: ['finance'],
    ruleText: '?tx a fin:Transaction .\nFILTER NOT EXISTS { ?tx fin:bookedTo ?cc . ?cc a fin:CostCenter . }',
  },
  'contract-governed-by-policy-with-open-finding': {
    typeChip: 'RULE-ALERT',
    modules: ['legal', 'compliance'],
    ruleText:
      '?f a cmp:AuditFinding ; cmp:status "open" ; cmp:againstPolicy ?pol .\n?pol cmp:governs ?contract . ?contract a lgl:Contract .',
  },
  'org-island': {
    typeChip: 'ORPHAN-DETECTION',
    modules: ['hr'],
    ruleText: '?u a hr:OrgUnit .\nFILTER NOT EXISTS { ?u hr:parentUnit ?p . }\nFILTER(?u.isRoot != true)',
  },
  'twin-cold-chain-excursion': {
    typeChip: 'RULE-ALERT',
    modules: ['twin', 'logistics'],
    ruleText:
      '?z a dtwin:ZoneTwin ; dtwin:temperature ?t .\nFILTER(?t < 2 || ?t > 6)\n# also checked on dtwin:ShipmentTwin',
  },
  'budget-overrun': {
    typeChip: 'RULE-ALERT',
    modules: ['finance'],
    ruleText:
      '?b a fin:Budget ; fin:budgetFor ?cc ; fin:amount ?budgeted .\n?tx a fin:Transaction ; fin:bookedTo ?cc .\nFILTER(SUM(?tx.amount) > ?budgeted)',
  },
  'unmitigated-high-risk': {
    typeChip: 'ORPHAN-DETECTION',
    modules: ['compliance'],
    ruleText:
      '?r a cmp:Risk .\nFILTER(?r.likelihood * ?r.impact >= 16)\nFILTER NOT EXISTS { ?control cmp:mitigates ?r . }',
  },
  'contract-expiring-without-renewal': {
    typeChip: 'RULE-ALERT',
    modules: ['legal'],
    ruleText:
      '?c a lgl:Contract ; lgl:status "active" .\nFILTER(?c.endDate <= NOW() + "P30D"^^xsd:duration)\nFILTER NOT EXISTS { ?c lgl:relatesToMatter ?m . }',
  },
  'vendor-spend-concentration': {
    typeChip: 'RULE-ALERT',
    modules: ['finance'],
    ruleText:
      '?tx a fin:Transaction ; fin:paidTo ?v .\n# GROUP BY ?v; FILTER(SUM(?tx.amount) / total >= 0.20)',
  },
  'carrier-shipment-concentration': {
    typeChip: 'RULE-ALERT',
    modules: ['logistics'],
    ruleText:
      '?s a log:Shipment ; log:shippedBy ?c .\n# GROUP BY ?c; FILTER(COUNT(?s) / total >= 0.50)',
  },
};

export const DEFAULT_RULE_META: RuleMeta = {
  typeChip: 'RULE-ALERT',
  modules: [],
  ruleText: '-- deterministic rule · definition registered in the insight engine',
};

export function ruleMetaFor(ruleId: string | null | undefined): RuleMeta {
  return (ruleId && RULE_META[ruleId]) || DEFAULT_RULE_META;
}

/* ── Evidence ─────────────────────────────────────────────────── */

export interface MissingEdge {
  fromIri: string;
  toIri: string;
  predicate: string;
}

export interface InsightEvidence {
  nodeIds: number[];
  edgeIds: number[];
  missingEdges: MissingEdge[];
}

export function parseEvidence(json: unknown): InsightEvidence {
  const empty: InsightEvidence = { nodeIds: [], edgeIds: [], missingEdges: [] };
  if (!json || typeof json !== 'object') return empty;
  const j = json as Record<string, unknown>;
  return {
    nodeIds: Array.isArray(j.nodeIds) ? (j.nodeIds as number[]).filter((n) => typeof n === 'number') : [],
    edgeIds: Array.isArray(j.edgeIds) ? (j.edgeIds as number[]).filter((n) => typeof n === 'number') : [],
    missingEdges: Array.isArray(j.missingEdges)
      ? (j.missingEdges as MissingEdge[]).filter(
          (m) => m && typeof m.fromIri === 'string' && typeof m.toIri === 'string',
        )
      : [],
  };
}

/* ── IRI helpers ──────────────────────────────────────────────── */

const IRI_RE = /\b(?:hr|lgl|legal|cmp|fin|log|lgx|dtwin|ext):[A-Za-z][\w./-]*/;

/** First compact IRI found in a free-text string (summaries carry them). */
export function extractFirstIri(text?: string | null): string | null {
  if (!text) return null;
  const m = text.match(IRI_RE);
  return m ? m[0] : null;
}

/** All compact IRIs found in a string. */
export function extractIris(text?: string | null): string[] {
  if (!text) return [];
  return text.match(new RegExp(IRI_RE, 'g')) ?? [];
}

/**
 * Instance IRIs carry a local id after the class segment (`hr:Person/E-0173`).
 * A bare `cmp:Control` is a *class* IRI — it appears in rule prose but has no
 * corresponding kgNode, so graph.getSubgraph answers NOT_FOUND for it.
 */
export function isInstanceIri(iri?: string | null): boolean {
  return !!iri && /^[A-Za-z][\w-]*:[A-Za-z][\w.-]*\/[\w.:/-]+$/.test(iri);
}

/**
 * The first IRI on an insight that actually resolves to a graph node. Evidence
 * is preferred, then the summary, then the title — skipping class IRIs, which
 * would otherwise be handed to the graph and 404.
 */
export function resolveInstanceIri(
  evidenceJson: unknown,
  summary?: string | null,
  title?: string | null,
): string | null {
  const ev = parseEvidence(evidenceJson);
  const candidates = [
    ev.missingEdges[0]?.fromIri,
    ...extractIris(summary),
    ...extractIris(title),
  ];
  return candidates.find(isInstanceIri) ?? null;
}

/**
 * The objects an insight's evidence names, for acting on them: instance IRIs
 * at either end of a missing edge (class IRIs such as `hr:Person` are left
 * out), then evidence nodes the caller resolved from their ids. Evidence
 * that carries only text names nothing here. At most `limit`, first seen first.
 */
export function evidenceObjectIris(evidenceJson: unknown, resolvedNodeIris: string[] = [], limit = 6): string[] {
  const ev = parseEvidence(evidenceJson);
  const out: string[] = [];
  const add = (iri: string | undefined) => {
    if (iri && isInstanceIri(iri) && !out.includes(iri)) out.push(iri);
  };
  for (const m of ev.missingEdges) {
    add(m.fromIri);
    add(m.toIri);
  }
  resolvedNodeIris.forEach(add);
  return out.slice(0, limit);
}

/** Map an IRI prefix to a module key — seed data uses `lgl:` for Legal. */
export function moduleKeyForIri(iri: string): ModuleKey {
  const prefix = iri.split(':')[0] ?? '';
  if (prefix === 'lgl') return 'legal';
  return moduleForPrefix(prefix).key;
}

/** Local name of a compact IRI: `fin:Vendor/V-2291` → `V-2291`. */
export function iriLocalName(iri: string): string {
  const afterColon = iri.split(':').slice(1).join(':');
  const parts = afterColon.split('/');
  return parts[parts.length - 1] || afterColon;
}

/** Class part of an instance IRI: `fin:Vendor/V-2291` → `fin:Vendor`. */
export function iriClass(iri: string): string {
  const afterColon = iri.split(':').slice(1).join(':');
  const parts = afterColon.split('/');
  const prefix = iri.split(':')[0];
  return parts.length > 1 ? `${prefix}:${parts[0]}` : iri;
}

/* ── Insight → module mapping ─────────────────────────────────── */

/** Modules an insight touches — rule metadata + any IRIs in the summary/evidence. */
export function insightModules(insight: Pick<InsightRow, 'ruleId' | 'title' | 'summary' | 'evidenceJson'>): ModuleKey[] {
  const meta = ruleMetaFor(insight.ruleId);
  const set = new Set<ModuleKey>(meta.modules);
  for (const iri of extractIris(`${insight.title} ${insight.summary ?? ''}`)) {
    set.add(moduleKeyForIri(iri));
  }
  for (const m of parseEvidence(insight.evidenceJson).missingEdges) {
    set.add(moduleKeyForIri(m.fromIri));
    set.add(moduleKeyForIri(m.toIri));
  }
  return [...set];
}

/* ── Misc ─────────────────────────────────────────────────────── */

export function formatTimestamp(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(',', '');
}

export function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Relationship an instance of this class is expected to have (axiom map). */
export const EXPECTED_RELATION: Record<string, string> = {
  'hr:Person': 'hr:reportsTo',
  'hr:Employee': 'hr:reportsTo',
  'hr:Contractor': 'hr:reportsTo',
  'hr:OrgUnit': 'hr:parentUnit',
  'fin:Transaction': 'fin:bookedTo',
  'fin:Vendor': 'lgl:withParty',
  'cmp:Control': 'cmp:hasEvidence',
  'lgl:Contract': 'lgl:withParty',
  'log:Shipment': 'log:shippedBy',
};
