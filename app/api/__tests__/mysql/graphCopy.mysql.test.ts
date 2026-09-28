/**
 * A workspace's copy of its graph, in an engine of its own, kept up to date
 * from change capture (services/graphCopy.ts), on a real MySQL and a real
 * engine (privateEngine.ts; OPEN_ONTOLOGIES_BIN). The measure throughout: a
 * copy caught up to a version holds exactly the graph a copy rebuilt from
 * nothing at that version holds. And a writer that lost its turn changes
 * nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { graphVersions, kgEdges, kgNodes, ontologyClasses, ontologyModules, ontologyProperties, workspaces } from "@db/schema";
import { closeDb, getDb } from "../../queries/connection";
import { recordGraphChange, recordGraphReplaced, type GraphChange } from "../../services/graphChanges";
import { catchUp, copyMeta, CopyTakenOver } from "../../services/graphCopy";
import { inSnapshot, readGraphChanges } from "../../services/graphSnapshot";
import { planUpdates, renderChanges } from "../../services/graphProjection";
import { startPrivateEngine, type PrivateEngine } from "../privateEngine";
import { directCopyEngine } from "../directCopyEngine";
import { emptyDatabase } from "./database";

const W = 1;
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

let engines: PrivateEngine[] = [];
let copy: ReturnType<typeof directCopyEngine>;
let fresh: ReturnType<typeof directCopyEngine>;

beforeAll(async () => {
  engines = await Promise.all([startPrivateEngine(), startPrivateEngine()]);
  copy = directCopyEngine(engines[0].url);
  fresh = directCopyEngine(engines[1].url);
}, 60_000);

afterAll(async () => {
  await Promise.all(engines.map((e) => e.stop()));
  await closeDb();
});

/** Nodes of the fixture, by name. */
const person = (id: number, name: string, props: Record<string, unknown> = {}) => ({
  id, workspaceId: W, moduleKey: "hr", classIri: "hr:Person", iri: `hr:Person/${name}`, label: name, propsJson: { title: `The ${name}`, ...props },
});
const link = (fromNodeId: number, toNodeId: number, predicateIri = "hr:reportsTo") => ({ workspaceId: W, fromNodeId, toNodeId, predicateIri, moduleKey: "hr" });

beforeEach(async () => {
  await emptyDatabase();
  await copy.reset();
  const db = getDb();
  await db.insert(workspaces).values({ id: W, name: "Acme", slug: "acme" });
  await db.insert(ontologyModules).values([
    { id: 10, workspaceId: W, key: "hr", name: "HR", prefix: "hr", color: "#000000", version: "1.0" },
    { id: 11, workspaceId: W, key: "finance", name: "Finance", prefix: "fin", color: "#000000", version: "1.0" },
  ]);
  await db.insert(ontologyClasses).values([
    { id: 100, moduleId: 10, iri: "hr:Person", label: "Person" },
    { id: 101, moduleId: 10, iri: "hr:Manager", label: "Manager", parentId: 100 },
    { id: 110, moduleId: 11, iri: "fin:Invoice", label: "Invoice" },
  ]);
  await db.insert(ontologyProperties).values([
    { id: 200, moduleId: 10, iri: "hr:reportsTo", label: "reports to", kind: "object", domainClassId: 100, rangeClassId: 100 },
    { id: 201, moduleId: 10, iri: "hr:salary", label: "salary", kind: "datatype", domainClassId: 100, rangeDatatype: "xsd:decimal" },
    { id: 210, moduleId: 11, iri: "fin:amount", label: "amount", kind: "datatype", domainClassId: 110, rangeDatatype: "xsd:decimal" },
  ]);
  await db.insert(kgNodes).values([
    person(1, "Ada", { salary: "100.5" }),
    person(2, "Bob"),
    person(3, "Cy"),
    person(4, "Dee"),
    { id: 5, workspaceId: W, moduleKey: "finance", classIri: "fin:Invoice", iri: "fin:Invoice/INV-1", label: "INV-1", propsJson: { amount: "12.50" } },
  ]);
  await db.insert(kgEdges).values([link(2, 1), link(3, 1), link(4, 2), link(5, 1, "fin:approvedBy")]);
  await recordGraphReplaced(W);
});

/** Records a change the way the graph's writers do: the write and its record in one transaction. */
async function change(write: (tx: Tx) => Promise<GraphChange>): Promise<void> {
  await getDb().transaction(async (tx) => {
    await recordGraphChange(tx, W, await write(tx));
  });
}

/** The graph a copy rebuilt from nothing holds now. */
async function rebuiltGraph(): Promise<string[]> {
  await fresh.reset();
  expect((await catchUp(W, fresh)).kind).toBe("rebuilt");
  return fresh.triples();
}

async function head() {
  const [row] = await getDb().select().from(graphVersions).where(eq(graphVersions.workspaceId, W));
  return row;
}

describe("a copy of a workspace's graph", () => {
  it("is built from nothing, at MySQL's version and epoch, with the graph and its schema", async () => {
    const built = await catchUp(W, copy);
    const { version, epoch } = await head();
    expect(built).toMatchObject({ kind: "rebuilt", version, reason: "it holds no version" });
    expect(await copyMeta(copy)).toEqual({ version, epoch, writer: null });
    // 3 classes (2 + 3 + 2 triples) and 3 properties (4 each); 5 nodes, each
    // with its type, label and title, Ada's salary, the invoice's amount, and 4 links.
    expect(built).toMatchObject({ triples: 7 + 12 + 5 * 3 + 1 + 4 });
    expect(await copy.triples()).toContain('<https://ontos.dev/ontology/hr/Person/Ada> <https://ontos.dev/ontology/hr/salary> "100.5"^^<http://www.w3.org/2001/XMLSchema#decimal>');
    // And again: nothing to do.
    expect(await catchUp(W, copy)).toEqual({ kind: "current", version });
    expect((await head()).projectedVersion).toBe(version);
  });

  it("catches up with changes in one request, and holds what a rebuild holds", async () => {
    await catchUp(W, copy);
    const before = (await head()).version;
    await change(async (tx) => {
      await tx.update(kgNodes).set({ propsJson: { title: "Chief" }, label: "Ada L." }).where(eq(kgNodes.id, 1));
      await tx.insert(kgNodes).values(person(6, "Eve"));
      await tx.insert(kgEdges).values(link(6, 4));
      return { nodes: [1], appearedOrGone: [6] };
    });
    const caught = await catchUp(W, copy);
    expect(caught).toMatchObject({ kind: "caught-up", from: before, version: before + 1, requests: 1 });
    expect(await copy.triples()).toEqual(await rebuiltGraph());
    expect(await copyMeta(copy)).toMatchObject({ version: before + 1 });
  });

  it("drops a node that left the graph, and the links to it from the nodes that link to it", async () => {
    await catchUp(W, copy);
    // Ada leaves: Bob, Cy and the invoice link to her.
    await change(async (tx) => {
      await tx.update(kgNodes).set({ deletedAt: new Date() }).where(eq(kgNodes.id, 1));
      await tx.update(kgEdges).set({ deletedAt: new Date() }).where(and(eq(kgEdges.toNodeId, 1), isNull(kgEdges.deletedAt)));
      return { appearedOrGone: [1] };
    });
    await catchUp(W, copy);
    const triples = await copy.triples();
    expect(triples.filter((t) => t.includes("Person/Ada"))).toEqual([]);
    expect(triples).toEqual(await rebuiltGraph());
  });

  it("brings back the links to a node that came back", async () => {
    await change(async (tx) => {
      await tx.update(kgNodes).set({ deletedAt: new Date() }).where(eq(kgNodes.id, 1));
      return { appearedOrGone: [1] };
    });
    await catchUp(W, copy);
    expect((await copy.triples()).filter((t) => t.includes("Person/Ada"))).toEqual([]);
    await change(async (tx) => {
      await tx.update(kgNodes).set({ deletedAt: null }).where(eq(kgNodes.id, 1));
      return { appearedOrGone: [1] };
    });
    await catchUp(W, copy);
    const triples = await copy.triples();
    expect(triples).toContain("<https://ontos.dev/ontology/hr/Person/Bob> <https://ontos.dev/ontology/hr/reportsTo> <https://ontos.dev/ontology/hr/Person/Ada>");
    expect(triples).toEqual(await rebuiltGraph());
  });

  it("replaces a class and a property that changed", async () => {
    await catchUp(W, copy);
    await change(async (tx) => {
      await tx.update(ontologyClasses).set({ label: "Staff member", definition: "Anyone on the payroll." }).where(eq(ontologyClasses.id, 100));
      await tx.update(ontologyProperties).set({ label: "line manager" }).where(eq(ontologyProperties.id, 200));
      return { classes: [100], properties: [200] };
    });
    expect(await catchUp(W, copy)).toMatchObject({ kind: "caught-up", subjects: 2 });
    expect(await copy.triples()).toEqual(await rebuiltGraph());
  });

  it("refuses a writer that lost its turn: none of its requests changes anything", async () => {
    await catchUp(W, copy);
    const from = (await head()).version;
    await change(async (tx) => {
      await tx.update(kgNodes).set({ label: "Bob v2" }).where(eq(kgNodes.id, 2));
      return { nodes: [2] };
    });
    // A writer plans its catch-up, then stalls.
    const stale = await inSnapshot(async (tx) => {
      const { prefixMap, subjects } = renderChanges((await readGraphChanges(tx, W, from))!);
      return planUpdates({ prefixMap, subjects, from, to: from + 1, writer: "stale-writer", maxBytes: 1_500_000 });
    });
    // Another catches the copy up past it, then the graph moves on.
    await catchUp(W, copy);
    await change(async (tx) => {
      await tx.update(kgNodes).set({ label: "Bob v3" }).where(eq(kgNodes.id, 2));
      return { nodes: [2] };
    });
    await catchUp(W, copy);
    const now = await copy.triples();
    // The stale writer's request, arriving late, and replayed.
    for (const request of [...stale, ...stale]) await expect(copy.update(request)).rejects.toThrow();
    expect(await copy.triples()).toEqual(now);
    expect(now.some((t) => t.includes('"Bob v3"'))).toBe(true);
  });

  it("stops, and says so, when another writer takes the copy over half way", async () => {
    await catchUp(W, copy);
    await change(async (tx) => {
      for (let id = 1; id <= 4; id++) await tx.update(kgNodes).set({ propsJson: { title: "x".repeat(3_000) } }).where(eq(kgNodes.id, id));
      return { nodes: [1, 2, 3, 4] };
    });
    // Another writer takes the copy over after this one's first request.
    let requests = 0;
    const hijacked = {
      ...copy,
      update: async (sparql: string) => {
        await copy.update(sparql);
        if (++requests === 1) {
          await copy.update('DELETE WHERE { GRAPH <urn:ontos:meta> { <urn:ontos:graph> <urn:ontos:writer> ?w } } ; INSERT DATA { GRAPH <urn:ontos:meta> { <urn:ontos:graph> <urn:ontos:writer> "another" } }');
        }
      },
    };
    await expect(catchUp(W, hijacked, { maxBytes: 5_000 })).rejects.toBeInstanceOf(CopyTakenOver);
    // The copy stays at the old version, every subject at least as new: the next catch-up finishes it.
    await expect(catchUp(W, copy)).resolves.toMatchObject({ kind: "caught-up" });
    expect(await copy.triples()).toEqual(await rebuiltGraph());
  });

  it("splits a subject too large for one request, and still holds what a rebuild holds", async () => {
    await catchUp(W, copy);
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`note${i}`, `a note of some length, number ${i}`]));
    await change(async (tx) => {
      await tx.update(kgNodes).set({ propsJson: many }).where(eq(kgNodes.id, 3));
      return { nodes: [3] };
    });
    const caught = await catchUp(W, copy, { maxBytes: 4_000 });
    expect(caught).toMatchObject({ kind: "caught-up" });
    expect((caught as { requests: number }).requests).toBeGreaterThan(2);
    expect(await copy.triples()).toEqual(await rebuiltGraph());
  });

  it("rebuilds when the graph was replaced, when a change reaches every subject, and when the copy is ahead of MySQL", async () => {
    await catchUp(W, copy);
    await recordGraphReplaced(W);
    expect(await catchUp(W, copy)).toMatchObject({ kind: "rebuilt", reason: "it was built from another epoch" });

    await change(async () => ({ everything: true }));
    expect(await catchUp(W, copy)).toMatchObject({ kind: "rebuilt", reason: "a change since reaches every subject" });

    const { version } = await head();
    await copy.update(`DELETE WHERE { GRAPH <urn:ontos:meta> { <urn:ontos:graph> <urn:ontos:version> ?v } } ; INSERT DATA { GRAPH <urn:ontos:meta> { <urn:ontos:graph> <urn:ontos:version> ${version + 5} } }`);
    expect(await catchUp(W, copy)).toMatchObject({ kind: "rebuilt", reason: `it holds version ${version + 5}, ahead of MySQL's ${version}` });
    expect(await copy.triples()).toEqual(await rebuiltGraph());
  });

  it("holds what a rebuild holds through a long run of random changes, caught up at random moments", async () => {
    let seed = 20260928;
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
    const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)];
    let nextId = 100;
    await catchUp(W, copy);
    for (let step = 0; step < 60; step++) {
      const liveNodes = (await getDb().select().from(kgNodes).where(and(eq(kgNodes.workspaceId, W), isNull(kgNodes.deletedAt)))).map((n) => n.id);
      const liveEdges = await getDb().select().from(kgEdges).where(and(eq(kgEdges.workspaceId, W), isNull(kgEdges.deletedAt)));
      const op = pick(["create", "edit", "edit", "delete", "link", "link", "unlink", "revive"]);
      await change(async (tx) => {
        switch (op) {
          case "create": {
            const id = nextId++;
            await tx.insert(kgNodes).values(person(id, `P${id}`, { salary: String(Math.floor(random() * 1000)) }));
            if (liveNodes.length) await tx.insert(kgEdges).values(link(id, pick(liveNodes)));
            return { appearedOrGone: [id] };
          }
          case "edit": {
            if (!liveNodes.length) return {};
            const id = pick(liveNodes);
            await tx.update(kgNodes).set({ label: `L${step}`, propsJson: { title: `T${step}`, salary: `${step}.5` } }).where(eq(kgNodes.id, id));
            return { nodes: [id] };
          }
          case "delete": {
            if (liveNodes.length < 3) return {};
            const id = pick(liveNodes);
            await tx.update(kgNodes).set({ deletedAt: new Date() }).where(eq(kgNodes.id, id));
            return { appearedOrGone: [id] };
          }
          case "revive": {
            const gone = (await tx.select().from(kgNodes).where(eq(kgNodes.workspaceId, W))).filter((n) => n.deletedAt !== null).map((n) => n.id);
            if (!gone.length) return {};
            const id = pick(gone);
            await tx.update(kgNodes).set({ deletedAt: null }).where(eq(kgNodes.id, id));
            return { appearedOrGone: [id] };
          }
          case "link": {
            if (liveNodes.length < 2) return {};
            const from = pick(liveNodes);
            await tx.insert(kgEdges).values(link(from, pick(liveNodes.filter((id) => id !== from)), pick(["hr:reportsTo", "hr:mentors"])));
            return { nodes: [from] };
          }
          default: {
            if (!liveEdges.length) return {};
            const e = pick(liveEdges);
            await tx.update(kgEdges).set({ deletedAt: new Date() }).where(inArray(kgEdges.id, [e.id]));
            return { nodes: [e.fromNodeId] };
          }
        }
      });
      if (random() < 0.3) {
        await catchUp(W, copy, { maxBytes: pick([3_000, 20_000, 1_500_000]) });
        expect(await copy.triples(), `after step ${step} (${op})`).toEqual(await rebuiltGraph());
      }
    }
    await catchUp(W, copy);
    expect(await copy.triples()).toEqual(await rebuiltGraph());
  }, 120_000);
});
