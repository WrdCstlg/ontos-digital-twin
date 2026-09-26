import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { fixtureModel } from "./publicApiFixtures";

// Every query is recorded (its WHERE) and answered with the next queued rows.
const db = vi.hoisted(() => ({ wheres: [] as unknown[], results: [] as unknown[][] }));
vi.mock("../queries/connection", () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    Object.assign(c, {
      from: self,
      innerJoin: self,
      orderBy: self,
      limit: self,
      where: (w: unknown) => {
        db.wheres.push(w);
        return c;
      },
      then: (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(db.results.shift() ?? []).then(resolve, reject),
    });
    return c;
  };
  return { getDb: vi.fn(() => ({ select: () => chain() })) };
});

import { BadQuery, getObject, listObjects } from "../services/publicApi/objects";

const render = (w: unknown) => new MySqlDialect().sqlToQuery(w as SQL);
const person = fixtureModel.objectTypes[0];
const node = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  workspaceId: 1,
  iri: `hr:Person/E-${id}`,
  classIri: "hr:Person",
  label: `Person ${id}`,
  moduleKey: "hr",
  propsJson: { "hr:fullName": `Person ${id}`, salary: "100" },
  sourceMappingId: 3,
  sourceSubmissionId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  deletedAt: null,
  ...over,
});
const classes = [
  { id: 1, iri: "hr:Person", parentId: null },
  { id: 2, iri: "hr:Employee", parentId: 1 },
  { id: 3, iri: "lgl:Contract", parentId: null },
];

afterEach(() => {
  db.wheres.length = 0;
  db.results.length = 0;
});

describe("listObjects", () => {
  it("asks only for live objects of the type and its subclasses, in the model's workspace", async () => {
    db.results.push(classes, [node(1)], [], []);
    await listObjects(fixtureModel, person, { limit: 50, cursor: null, q: null, filters: {} });
    const { sql, params } = render(db.wheres[1]);
    expect(sql).toContain("`kg_nodes`.`workspaceId` = ?");
    expect(sql).toContain("`kg_nodes`.`deletedAt` is null");
    expect(sql).toMatch(/`kg_nodes`\.`classIri` in \(\?, \?\)/);
    expect(params).toEqual([fixtureModel.workspace.id, "hr:Person", "hr:Employee"]);
    // The subclass lookup is scoped to the workspace too.
    expect(render(db.wheres[0]).params).toEqual([fixtureModel.workspace.id]);
  });

  it("continues after the cursor, matches text literally, and filters on a property under any of its names", async () => {
    db.results.push(classes, [], [], []);
    await listObjects(fixtureModel, person, { limit: 10, cursor: 40, q: "50%_off", filters: { fullName: "Ada" } });
    const { sql, params } = render(db.wheres[1]);
    expect(sql).toContain("`kg_nodes`.`id` > ?");
    expect(params).toContain(40);
    expect(params).toContain("%50\\%\\_off%");
    for (const key of ['$."fullName"', '$."hr:fullName"']) expect(params).toContain(key);
    expect(params).toContain("Ada");
  });

  it("refuses a filter key that is not a property name, before asking the database for objects", async () => {
    db.results.push(classes);
    for (const bad of ["a b", "x')--", 'k"]', "1abc", ""]) {
      await expect(listObjects(fixtureModel, person, { limit: 10, cursor: null, q: null, filters: { [bad]: "1" } })).rejects.toBeInstanceOf(BadQuery);
      db.results.push(classes);
    }
    expect(db.wheres.map((w) => render(w).sql).some((s) => s.includes("`kg_nodes`"))).toBe(false);
  });

  it("gives a next cursor only when there is another page, and types declared properties", async () => {
    // No links, so the link-target query does not run: three answers.
    db.results.push(classes, [node(1), node(2), node(3)], []);
    const page = await listObjects(fixtureModel, person, { limit: 2, cursor: null, q: null, filters: {} });
    expect(page.data.map((o) => o.iri)).toEqual(["hr:Person/E-1", "hr:Person/E-2"]);
    expect(page.nextCursor).toBe("2");
    expect(page.data[0].properties).toMatchObject({ fullName: "Person 1", salary: 100 });
    db.results.push(classes, [node(1)], []);
    expect((await listObjects(fixtureModel, person, { limit: 2, cursor: null, q: null, filters: {} })).nextCursor).toBeNull();
  });

  it("returns links by predicate, only to live objects, from the model's workspace", async () => {
    db.results.push(classes, [node(1)], [{ from: 1, to: 9, predicate: "hr:reportsTo" }, { from: 1, to: 8, predicate: "hr:reportsTo" }], [{ id: 9, iri: "hr:Person/E-9" }]);
    const page = await listObjects(fixtureModel, person, { limit: 10, cursor: null, q: null, filters: {} });
    expect(page.data[0].links).toEqual({ reportsTo: ["hr:Person/E-9"] });
    const edges = render(db.wheres[2]);
    expect(edges.sql).toContain("`kg_edges`.`workspaceId` = ?");
    expect(edges.sql).toContain("`kg_edges`.`deletedAt` is null");
    expect(render(db.wheres[3]).sql).toContain("`kg_nodes`.`deletedAt` is null");
  });
});

describe("getObject", () => {
  it("finds a live object by IRI in the model's workspace, or nothing", async () => {
    db.results.push([node(1)], []);
    expect((await getObject(fixtureModel, "hr:Person/E-1"))?.iri).toBe("hr:Person/E-1");
    const { sql, params } = render(db.wheres[0]);
    expect(sql).toContain("`kg_nodes`.`workspaceId` = ?");
    expect(sql).toContain("`kg_nodes`.`deletedAt` is null");
    expect(params).toEqual([fixtureModel.workspace.id, "hr:Person/E-1"]);
    db.results.push([]);
    expect(await getObject(fixtureModel, "hr:Person/E-404")).toBeNull();
  });
});
