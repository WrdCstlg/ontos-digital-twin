import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { appRouter } from "../router";
import { createMockContext, mockViewerMembership, mockViewerUser, mockWorkspace } from "./testHarness";

// Every query the search makes is recorded: its WHERE condition and its joins.
// Each chain resolves to no rows, so the router runs its six searches and stops.
const recorded = vi.hoisted(() => ({ wheres: [] as unknown[], joins: [] as unknown[] }));

vi.mock("../queries/connection", () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    Object.assign(c, {
      from: self,
      orderBy: self,
      limit: self,
      leftJoin: self,
      innerJoin: (_table: unknown, on: unknown) => {
        recorded.joins.push(on);
        return c;
      },
      where: (condition: unknown) => {
        recorded.wheres.push(condition);
        return c;
      },
      then: (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve([]).then(resolve, reject),
    });
    return c;
  };
  return { getDb: vi.fn(() => ({ select: () => chain() })) };
});

const dialect = new MySqlDialect();
const render = (condition: unknown) => dialect.sqlToQuery(condition as SQL);

function viewer() {
  return appRouter.createCaller(createMockContext({ user: mockViewerUser, membership: mockViewerMembership, workspace: mockWorkspace }));
}

afterEach(() => {
  recorded.wheres.length = 0;
  recorded.joins.length = 0;
});

describe("search.global", () => {
  it("scopes every search to the caller's workspace, ontology classes and properties included", async () => {
    await viewer().search.global({ query: "contract" });
    // Instances, classes, properties, insights, action types, connectors.
    expect(recorded.wheres).toHaveLength(6);
    for (const where of recorded.wheres) {
      const { sql, params } = render(where);
      expect(sql).toMatch(/`workspaceId` = \?/);
      expect(params).toContain(mockWorkspace.id);
    }
    const [, classes, properties] = recorded.wheres.map(render);
    expect(classes.sql).toContain("`ontology_modules`.`workspaceId`");
    expect(properties.sql).toContain("`ontology_modules`.`workspaceId`");
  });

  it("matches the term literally: % and _ in it are not wildcards", async () => {
    await viewer().search.global({ query: "50%_off" });
    const { params } = render(recorded.wheres[0]);
    expect(params).toContain("%50\\%\\_off%");
  });

  it("refuses a caller who is not signed in", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: null, workspace: null, membership: null }));
    await expect(caller.search.global({ query: "x" })).rejects.toThrow();
    expect(recorded.wheres).toHaveLength(0);
  });
});
