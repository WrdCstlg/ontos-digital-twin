/**
 * Structural types for the Explorer page — mirror the tRPC payload shapes
 * (graph.searchNodes / getSubgraph / getNode, nlq.execute) without importing
 * from api/ (forbidden in frontend code).
 */

export interface ExplorerNode {
  id: number;
  moduleKey: string;
  classIri: string;
  iri: string;
  label: string;
  propsJson?: unknown;
}

export interface ExplorerEdge {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  predicateIri: string;
  moduleKey?: string | null;
}

export interface ExecSubgraph {
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
}

export interface ExecResult {
  columns: string[];
  rows: Record<string, unknown>[];
  subgraph: ExecSubgraph;
  intent: string;
}

export interface TranslateOk {
  recognized: true;
  intent?: string;
  sparql?: string;
  cypher?: string;
  explanation?: string;
  bindings?: Record<string, string>;
  grounding?: { classes: string[]; predicates: string[] };
}

export interface TranslateRefusal {
  recognized: false;
  refusal: string;
}

export interface TranslateSuggestions {
  recognized: false;
  suggestions: string[];
  explanation?: string;
}

export type TranslateResult = TranslateOk | TranslateRefusal | TranslateSuggestions;

export interface HistoryEntry {
  id: string;
  question: string;
  intent?: string;
  sparql?: string;
  ts: number;
  saved: boolean;
}
