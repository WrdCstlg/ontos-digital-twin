import { describe, it, expect } from "vitest";
import { betweenness, buildAdjacency, communities, pagerank, shortestPath } from "./graphAnalytics";
import type { KgEdgeRow, KgNodeRow } from "./types";

/** Minimal row builders — only the fields the analytics actually read. */
const node = (id: number, moduleKey = "hr"): KgNodeRow => ({
  id,
  workspaceId: 1,
  moduleKey,
  classIri: "hr:Person",
  iri: `hr:Person/E-${id}`,
  label: `Person ${id}`,
  propsJson: null,
  sourceMappingId: null,
  createdAt: new Date(0),
});

const edge = (id: number, from: number, to: number): KgEdgeRow => ({
  id,
  workspaceId: 1,
  fromNodeId: from,
  toNodeId: to,
  predicateIri: "hr:reportsTo",
  moduleKey: "hr",
  sourceMappingId: null,
  createdAt: new Date(0),
});

/** Star: node 1 at the centre, nodes 2-5 on the spokes. */
const starNodes = [node(1), node(2), node(3), node(4), node(5)];
const starEdges = [edge(1, 1, 2), edge(2, 1, 3), edge(3, 1, 4), edge(4, 1, 5)];

describe("graphAnalytics", () => {
  describe("pagerank", () => {
    it("ranks the hub of a star above every spoke", () => {
      const adj = buildAdjacency(starNodes, starEdges);
      const ranks = pagerank(starNodes, adj);
      const hub = ranks.get(1)!;
      for (const spoke of [2, 3, 4, 5]) {
        expect(hub).toBeGreaterThan(ranks.get(spoke)!);
      }
    });

    it("distributes a total mass of 1 across the window", () => {
      const adj = buildAdjacency(starNodes, starEdges);
      const total = [...pagerank(starNodes, adj).values()].reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 6);
    });

    it("does not leak mass when the window contains isolated nodes", () => {
      // Node 6 has no edges at all — its rank must be redistributed, not dropped.
      const nodes = [...starNodes, node(6)];
      const adj = buildAdjacency(nodes, starEdges);
      const ranks = pagerank(nodes, adj);
      const total = [...ranks.values()].reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 6);
      expect(ranks.get(6)!).toBeGreaterThan(0);
    });

    it("gives every node an equal share when the graph has no edges", () => {
      const adj = buildAdjacency(starNodes, []);
      const ranks = pagerank(starNodes, adj);
      for (const n of starNodes) expect(ranks.get(n.id)!).toBeCloseTo(1 / starNodes.length, 6);
    });

    it("returns an empty map for an empty window", () => {
      expect(pagerank([], buildAdjacency([], [])).size).toBe(0);
    });

    it("ranks differently from betweenness on the same graph", () => {
      // Path 1-2-3-4: node 2 and 3 carry all shortest paths, so betweenness
      // separates them sharply from the endpoints, while PageRank stays flatter.
      const nodes = [node(1), node(2), node(3), node(4)];
      const edges = [edge(1, 1, 2), edge(2, 2, 3), edge(3, 3, 4)];
      const adj = buildAdjacency(nodes, edges);

      const cb = betweenness(nodes, adj);
      const pr = pagerank(nodes, adj);

      expect(cb.get(1)).toBe(0); // an endpoint lies on no shortest path
      expect(pr.get(1)!).toBeGreaterThan(0); // but still holds PageRank mass
      expect(cb.get(2)!).toBeGreaterThan(cb.get(1)!);
      expect(pr.get(2)!).toBeGreaterThan(pr.get(1)!);
    });
  });

  describe("communities", () => {
    it("separates disconnected clusters", () => {
      const nodes = [node(1), node(2), node(3), node(4)];
      const edges = [edge(1, 1, 2), edge(2, 3, 4)];
      const found = communities(nodes, buildAdjacency(nodes, edges));
      expect(found).toHaveLength(2);
      expect(found.every((c) => c.memberIds.length === 2)).toBe(true);
    });
  });

  describe("shortestPath", () => {
    it("walks the shortest hop sequence between two nodes", () => {
      const nodes = [node(1), node(2), node(3), node(4)];
      const edges = [edge(1, 1, 2), edge(2, 2, 3), edge(3, 3, 4)];
      const adj = buildAdjacency(nodes, edges);
      expect(shortestPath(adj, 1, 4)).toEqual([1, 2, 3, 4]);
    });

    it("returns null when the target is unreachable", () => {
      const nodes = [node(1), node(2)];
      expect(shortestPath(buildAdjacency(nodes, []), 1, 2)).toBeNull();
    });
  });
});
