/**
 * The switch-over itself, end to end: queryWorkspaceGraph and scratchShacl
 * (services/workspaceGraph.ts) against a real engine host (engineHostLiveSupport.ts,
 * the real open-ontologies binary) and a real MySQL, through ENGINE_HOST_URL,
 * exactly as the app is configured to reach the host. graphCopy.mysql.test.ts
 * already proves the catch-up itself is correct against a rebuild; this proves
 * the pieces around it — the env-configured client, the per-workspace lock,
 * read-your-writes through a fresh query, and the scratch pool — are wired
 * together correctly.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { kgNodes, ontologyClasses, ontologyModules, ontologyProperties, workspaces } from "@db/schema";
import { closeDb, getDb } from "../../queries/connection";
import { recordGraphChange, recordGraphReplaced } from "../../services/graphChanges";
import { buildPrefixMap, formatIri } from "../../services/rdfBridge";
import { emptyDatabase } from "./database";
import { removeDir, tempDir } from "../engineHostFakes";
import { LIVE_TOKEN, skipLive, startLiveHost, type LiveHost } from "../engineHostLiveSupport";

const W = 1;
const person = (id: number, name: string, props: Record<string, unknown> = {}) =>
  ({ id, workspaceId: W, moduleKey: "hr", classIri: "hr:Person", iri: `hr:Person/${name}`, label: name, propsJson: props });

describe.skipIf(skipLive())("workspaceGraph against a real engine host", () => {
  let dir: string;
  let host: LiveHost;
  let workspaceGraph: typeof import("../../services/workspaceGraph");
  let savedHostUrl: string | undefined;
  let savedHostToken: string | undefined;

  beforeAll(async () => {
    dir = tempDir("ontos-workspace-graph-hosted-");
    host = await startLiveHost(dir);
    // workspaceGraph.ts reads ENGINE_HOST_URL/ENGINE_HOST_TOKEN once, lazily,
    // on its first call, and caches the client forever: set them, then import
    // fresh, so this test's host is the one it binds to.
    savedHostUrl = process.env.ENGINE_HOST_URL;
    savedHostToken = process.env.ENGINE_HOST_TOKEN;
    process.env.ENGINE_HOST_URL = host.url;
    process.env.ENGINE_HOST_TOKEN = LIVE_TOKEN;
    workspaceGraph = await import("../../services/workspaceGraph");
  }, 60_000);

  afterAll(async () => {
    await host.close();
    await removeDir(dir);
    await closeDb();
    if (savedHostUrl === undefined) delete process.env.ENGINE_HOST_URL;
    else process.env.ENGINE_HOST_URL = savedHostUrl;
    if (savedHostToken === undefined) delete process.env.ENGINE_HOST_TOKEN;
    else process.env.ENGINE_HOST_TOKEN = savedHostToken;
  });

  beforeEach(async () => {
    await emptyDatabase();
    await host.host.remove(W).catch(() => undefined);
    const db = getDb();
    await db.insert(workspaces).values({ id: W, name: "Acme", slug: "acme" });
    await db.insert(ontologyModules).values({ id: 10, workspaceId: W, key: "hr", name: "HR", prefix: "hr", color: "#000000", version: "1.0" });
    await db.insert(ontologyClasses).values({ id: 100, moduleId: 10, iri: "hr:Person", label: "Person" });
    await db.insert(ontologyProperties).values([
      { id: 200, moduleId: 10, iri: "hr:salary", label: "salary", kind: "datatype", domainClassId: 100, rangeDatatype: "xsd:decimal" },
      { id: 201, moduleId: 10, iri: "hr:email", label: "email", kind: "datatype", domainClassId: 100, rangeDatatype: "xsd:string" },
    ]);
    await db.insert(kgNodes).values([person(1, "Ada", { salary: "100.5" }), person(2, "Bob")]);
    await recordGraphReplaced(W);
  });

  it("builds the workspace's copy on its first fresh read, and answers from it", async () => {
    const answer = await workspaceGraph.queryWorkspaceGraph(W, "SELECT ?s WHERE { ?s a <https://ontos.dev/ontology/hr/Person> }");
    expect(answer.results).toHaveLength(2);
    expect(answer.version).toBeGreaterThan(0);
    const status = await host.host.status(W);
    expect(status.state).not.toBe("cold");
  }, 30_000);

  it("read-your-writes: a change recorded in MySQL shows in the very next fresh read", async () => {
    await workspaceGraph.queryWorkspaceGraph(W, "SELECT ?s WHERE { ?s ?p ?o }");

    await getDb().transaction(async (tx) => {
      await tx.insert(kgNodes).values(person(3, "Cy", { salary: "90" }));
      await recordGraphChange(tx, W, { appearedOrGone: [3] });
    });

    const after = await workspaceGraph.queryWorkspaceGraph(W, "SELECT ?s WHERE { ?s a <https://ontos.dev/ontology/hr/Person> }");
    expect(after.results.map((r) => r.s)).toContain("<https://ontos.dev/ontology/hr/Person/Cy>");
    expect(after.results).toHaveLength(3);
  }, 30_000);

  it("with fresh: false, answers at whatever version the copy already holds, without catching up", async () => {
    const first = await workspaceGraph.queryWorkspaceGraph(W, "SELECT ?s WHERE { ?s a <https://ontos.dev/ontology/hr/Person> }");

    await getDb().transaction(async (tx) => {
      await tx.insert(kgNodes).values(person(3, "Cy", { salary: "90" }));
      await recordGraphChange(tx, W, { appearedOrGone: [3] });
    });

    const stale = await workspaceGraph.queryWorkspaceGraph(W, "SELECT ?s WHERE { ?s a <https://ontos.dev/ontology/hr/Person> }", { fresh: false });
    expect(stale.version).toBe(first.version);
    expect(stale.results).toHaveLength(2);

    const caught = await workspaceGraph.queryWorkspaceGraph(W, "SELECT ?s WHERE { ?s a <https://ontos.dev/ontology/hr/Person> }");
    expect(caught.results).toHaveLength(3);
    expect(caught.version).toBeGreaterThan(first.version!);
  }, 30_000);

  it("catchUpBehind brings a changed workspace's copy up to date in the background", async () => {
    await workspaceGraph.queryWorkspaceGraph(W, "SELECT ?s WHERE { ?s ?p ?o }");
    await getDb().transaction(async (tx) => {
      await tx.insert(kgNodes).values(person(3, "Cy", { salary: "90" }));
      await recordGraphChange(tx, W, { appearedOrGone: [3] });
    });

    const graphs = workspaceGraph.workspaceGraphs()!;
    expect(await graphs.catchUpBehind()).toBe(1);

    const stale = await workspaceGraph.queryWorkspaceGraph(W, "SELECT ?s WHERE { ?s a <https://ontos.dev/ontology/hr/Person> }", { fresh: false });
    expect(stale.results).toHaveLength(3);
  }, 30_000);

  it("scratchShacl validates data not yet in the graph, on a scratch engine, and leaves the workspace's own copy untouched", async () => {
    await workspaceGraph.queryWorkspaceGraph(W, "SELECT ?s WHERE { ?s ?p ?o }");

    const [module] = await getDb().select().from(ontologyModules).where(eq(ontologyModules.id, 10));
    const prefixMap = buildPrefixMap([module]);
    const shapes = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix hr: <https://ontos.dev/ontology/hr/> .
hr:PersonShape a sh:NodeShape ; sh:targetClass hr:Person ; sh:property [ sh:path hr:email ; sh:minCount 1 ] .`;

    // A node subject's local name (.../Eve) is not valid Turtle after a bare
    // prefix, so it renders the way the graph's own writer does: expanded.
    const eve = formatIri("hr:Person/Eve", prefixMap);

    const noEmail = await workspaceGraph.scratchShacl(prefixMap, [{ subject: eve, statements: ["a hr:Person", 'hr:salary "70"^^xsd:decimal'] }], shapes);
    expect(noEmail.conforms).toBe(false);
    expect(noEmail.violationCount).toBeGreaterThan(0);

    const withEmail = await workspaceGraph.scratchShacl(
      prefixMap,
      [{ subject: eve, statements: ["a hr:Person", 'hr:email "eve@acme.com"'] }],
      shapes,
    );
    expect(withEmail.conforms).toBe(true);

    // Eve was checked on a scratch engine, never written to this workspace's own copy.
    const check = await workspaceGraph.queryWorkspaceGraph(W, "SELECT ?s WHERE { ?s a <https://ontos.dev/ontology/hr/Person> }", { fresh: false });
    expect(check.results.map((r) => r.s)).not.toContain(eve);
  }, 30_000);
});
