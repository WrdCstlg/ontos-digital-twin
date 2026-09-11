import type { KgEdgeRow, KgNodeRow } from './types';

/** Pure client-side graph analytics over a fetched subgraph window. */

export interface Adjacency {
  neighbors: Map<number, { id: number; edge: KgEdgeRow }[]>;
  degree: Map<number, number>;
}

export function buildAdjacency(nodes: KgNodeRow[], edges: KgEdgeRow[]): Adjacency {
  const ids = new Set(nodes.map((n) => n.id));
  const neighbors = new Map<number, { id: number; edge: KgEdgeRow }[]>();
  for (const n of nodes) neighbors.set(n.id, []);
  for (const e of edges) {
    if (!ids.has(e.fromNodeId) || !ids.has(e.toNodeId)) continue;
    neighbors.get(e.fromNodeId)!.push({ id: e.toNodeId, edge: e });
    neighbors.get(e.toNodeId)!.push({ id: e.fromNodeId, edge: e });
  }
  const degree = new Map<number, number>();
  for (const [id, list] of neighbors) degree.set(id, list.length);
  return { neighbors, degree };
}

/** Brandes' algorithm — unweighted betweenness centrality, normalized. */
export function betweenness(nodes: KgNodeRow[], adj: Adjacency): Map<number, number> {
  const cb = new Map<number, number>();
  for (const n of nodes) cb.set(n.id, 0);
  const ids = nodes.map((n) => n.id);

  for (const s of ids) {
    const stack: number[] = [];
    const pred = new Map<number, number[]>(ids.map((id) => [id, []]));
    const sigma = new Map<number, number>(ids.map((id) => [id, 0]));
    const dist = new Map<number, number>(ids.map((id) => [id, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const queue: number[] = [s];
    while (queue.length) {
      const v = queue.shift()!;
      stack.push(v);
      for (const { id: w } of adj.neighbors.get(v) ?? []) {
        if (dist.get(w)! < 0) {
          queue.push(w);
          dist.set(w, dist.get(v)! + 1);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }
    const delta = new Map<number, number>(ids.map((id) => [id, 0]));
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred.get(w)!) {
        delta.set(v, delta.get(v)! + (sigma.get(v)! / (sigma.get(w) || 1)) * (1 + delta.get(w)!));
      }
      if (w !== s) cb.set(w, cb.get(w)! + delta.get(w)!);
    }
  }
  // normalize for undirected graph
  const n = ids.length;
  const scale = n > 2 ? 1 / ((n - 1) * (n - 2)) : 1;
  for (const [id, v] of cb) cb.set(id, (v / 2) * scale);
  return cb;
}

/**
 * PageRank over the undirected window. Where betweenness rewards nodes that sit
 * on many shortest paths, PageRank rewards nodes attached to other well-connected
 * nodes — so the two rank the same graph differently and are worth comparing.
 *
 * Multi-edges are intentionally left in the adjacency: two instances joined by
 * several predicates genuinely are more strongly related than two joined by one.
 */
export function pagerank(
  nodes: KgNodeRow[],
  adj: Adjacency,
  damping = 0.85,
  maxIterations = 40,
): Map<number, number> {
  const ids = nodes.map((n) => n.id);
  const n = ids.length;
  const rank = new Map<number, number>(ids.map((id) => [id, n > 0 ? 1 / n : 0]));
  if (n === 0) return rank;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const next = new Map<number, number>(ids.map((id) => [id, (1 - damping) / n]));

    // Isolated nodes have nowhere to send their mass; spread it over the whole
    // window rather than letting it leak out of the system.
    let danglingMass = 0;
    for (const id of ids) {
      const neighbors = adj.neighbors.get(id) ?? [];
      if (neighbors.length === 0) {
        danglingMass += rank.get(id)!;
        continue;
      }
      const share = (damping * rank.get(id)!) / neighbors.length;
      for (const { id: w } of neighbors) next.set(w, (next.get(w) ?? 0) + share);
    }
    if (danglingMass > 0) {
      const spread = (damping * danglingMass) / n;
      for (const id of ids) next.set(id, next.get(id)! + spread);
    }

    let delta = 0;
    for (const id of ids) delta += Math.abs(next.get(id)! - rank.get(id)!);
    for (const id of ids) rank.set(id, next.get(id)!);
    if (delta < 1e-6) break;
  }

  return rank;
}

export interface Community {
  id: number;
  memberIds: number[];
  /** internal edges / possible edges */
  cohesion: number;
  dominantModule: string;
}

/** Connected components over the undirected window. */
export function communities(nodes: KgNodeRow[], adj: Adjacency): Community[] {
  const seen = new Set<number>();
  const result: Community[] = [];
  let cid = 0;
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const members: number[] = [];
    const queue = [n.id];
    seen.add(n.id);
    while (queue.length) {
      const v = queue.pop()!;
      members.push(v);
      for (const { id: w } of adj.neighbors.get(v) ?? []) {
        if (!seen.has(w)) {
          seen.add(w);
          queue.push(w);
        }
      }
    }
    let internal = 0;
    const memberSet = new Set(members);
    for (const m of members) {
      for (const { id: w } of adj.neighbors.get(m) ?? []) if (memberSet.has(w)) internal++;
    }
    internal /= 2;
    const possible = (members.length * (members.length - 1)) / 2;
    const moduleCount = new Map<string, number>();
    const byId = new Map(nodes.map((x) => [x.id, x]));
    for (const m of members) {
      const mk = byId.get(m)?.moduleKey ?? 'custom';
      moduleCount.set(mk, (moduleCount.get(mk) ?? 0) + 1);
    }
    const dominantModule = [...moduleCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'custom';
    result.push({
      id: cid++,
      memberIds: members,
      cohesion: possible > 0 ? internal / possible : 0,
      dominantModule,
    });
  }
  return result.sort((a, b) => b.memberIds.length - a.memberIds.length);
}

/** BFS shortest path between two node ids (undirected). Null if unreachable. */
export function shortestPath(adj: Adjacency, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const prev = new Map<number, number>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const v = queue.shift()!;
    for (const { id: w } of adj.neighbors.get(v) ?? []) {
      if (seen.has(w)) continue;
      seen.add(w);
      prev.set(w, v);
      if (w === to) {
        const path = [w];
        let cur = w;
        while (prev.has(cur)) {
          cur = prev.get(cur)!;
          path.unshift(cur);
        }
        return path;
      }
      queue.push(w);
    }
  }
  return null;
}
