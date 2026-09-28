import type { KgEdge, KgNode, OntologyModule } from "@db/schema";

const at = new Date("2026-01-01T00:00:00Z");

export const rdfModule = (id: number, key: string, prefix: string): OntologyModule => ({
  id, workspaceId: 1, key, prefix, name: key, color: "#000000", version: "1.0", status: "active", description: null, documentation: null, createdAt: at, updatedAt: at,
});
const node = (id: number, moduleKey: string, classIri: string, iri: string, propsJson: Record<string, unknown>): KgNode => ({
  id, workspaceId: 1, moduleKey, classIri, iri, label: iri, propsJson, sourceMappingId: null, sourceSubmissionId: null, createdAt: at, updatedAt: at, deletedAt: null,
});
const link = (id: number, fromNodeId: number, toNodeId: number, predicateIri: string): KgEdge => ({
  id, workspaceId: 1, moduleKey: null, fromNodeId, toNodeId, predicateIri, sourceMappingId: null, sourceSubmissionId: null, createdAt: at, deletedAt: null,
});

/**
 * A workspace shaped as the seeded one is: module keys that are not their
 * prefixes (finance and fin, twin and dtwin), and properties stored without a
 * prefix. Rendered, it makes 14 triples: each node's type and label, 6
 * properties in all, and 2 links.
 */
export const seedShaped = {
  modules: [rdfModule(1, "hr", "hr"), rdfModule(2, "finance", "fin"), rdfModule(3, "twin", "dtwin")],
  nodes: [
    node(1, "hr", "hr:Person", "hr:Person/E-0001", { title: "Engineer", "hr:salary": 90000 }),
    node(2, "finance", "fin:Invoice", "fin:Invoice/INV-1", { amount: "12.50", paid: false }),
    node(3, "twin", "dtwin:EquipmentTwin", "dtwin:eq/7", { batteryLevel: 50, status: "ok" }),
  ],
  edges: [link(1, 1, 2, "fin:approves"), link(2, 3, 1, "dtwin:maintainedBy")],
  triples: 3 * 2 + 6 + 2,
};
