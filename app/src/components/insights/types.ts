/** Row shapes mirrored from the tRPC routers (api/ is server-only). */

export interface InsightRow {
  id: number;
  workspaceId: number;
  type: 'anomaly' | 'analytics' | 'narrative';
  severity: 'info' | 'warn' | 'risk';
  ruleId: string | null;
  title: string;
  summary: string | null;
  evidenceJson: unknown;
  status: 'open' | 'acknowledged';
  createdAt: Date | string;
}

export interface KgNodeRow {
  id: number;
  workspaceId: number;
  moduleKey: string;
  classIri: string;
  iri: string;
  label: string;
  propsJson: unknown;
  sourceMappingId: number | null;
  createdAt: Date | string;
}

export interface KgEdgeRow {
  id: number;
  workspaceId: number;
  fromNodeId: number;
  toNodeId: number;
  predicateIri: string;
  moduleKey: string | null;
  sourceMappingId: number | null;
  createdAt: Date | string;
}

export interface SubgraphResult {
  center: string;
  depth: number;
  nodes: KgNodeRow[];
  edges: KgEdgeRow[];
}

export interface AuditEntryRow {
  id: number;
  workspaceId: number;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  payloadJson: unknown;
  hash: string;
  prevHash: string | null;
  createdAt: Date | string;
}

export interface MemberRow {
  id: number;
  workspaceId: number;
  userId: number;
  role: 'viewer' | 'editor' | 'ontologist' | 'admin';
  moduleScope: unknown;
  createdAt: Date | string;
  user: {
    id: number;
    name: string | null;
    email: string | null;
    avatar: string | null;
    lastSignInAt: Date | string;
  } | null;
}

export interface ProviderRow {
  id: string;
  label: string;
  status: 'active' | 'configured' | 'unconfigured';
  model?: string;
  endpoint?: string;
  maskedKey?: string;
  latencyP50Ms?: number;
  note?: string;
}
