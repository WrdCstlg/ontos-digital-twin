import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";
import {
  createMockContext,
  mockAdminMembership,
  mockAdminUser,
  mockViewerMembership,
  mockViewerUser,
  mockWorkspace,
} from "./testHarness";

// Each database query resolves to the next queued result.
const db = vi.hoisted(() => ({ results: [] as unknown[][] }));

vi.mock("../queries/connection", () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    Object.assign(c, {
      from: self,
      where: self,
      orderBy: self,
      limit: self,
      innerJoin: self,
      values: self,
      $returningId: () => Promise.resolve([{ id: 7 }]),
      then: (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(db.results.shift() ?? []).then(resolve, reject),
    });
    return c;
  };
  return { getDb: vi.fn(() => ({ select: () => chain(), insert: () => chain() })) };
});
vi.mock("../services/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/audit")>()),
  writeAudit: vi.fn(async () => undefined),
}));

const sqlConnector = {
  id: 7,
  workspaceId: mockWorkspace.id,
  name: "Contracts DB",
  type: "sql",
  status: "connected",
  configJson: { driver: "postgresql", host: "db.acme.corp", database: "contracts", user: "reader", password: "s3cret-pw", mode: "poll" },
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const as = (who: "viewer" | "admin") =>
  appRouter.createCaller(
    createMockContext(
      who === "viewer"
        ? { user: mockViewerUser, membership: mockViewerMembership, workspace: mockWorkspace }
        : { user: mockAdminUser, membership: mockAdminMembership, workspace: mockWorkspace },
    ),
  );

afterEach(() => {
  db.results.length = 0;
});

describe("SQL connectors: credentials never leave the server", () => {
  it("lists connectors without the stored password, saying only that there is one", async () => {
    db.results.push([sqlConnector]);
    const [listed] = await as("viewer").mapping.listConnectors();
    expect(JSON.stringify(listed)).not.toContain("s3cret-pw");
    expect(listed.configJson).toMatchObject({ host: "db.acme.corp", user: "reader", hasPassword: true });
    expect(listed.configJson).not.toHaveProperty("password");
  });

  it("does not echo the password back to the admin who created the connector", async () => {
    db.results.push([sqlConnector]);
    const created = await as("admin").mapping.createConnector({ name: "Contracts DB", type: "sql", config: sqlConnector.configJson });
    expect(JSON.stringify(created)).not.toContain("s3cret-pw");
    expect(created.configJson).toMatchObject({ hasPassword: true });
  });
});

describe("SQL connectors: only people who build mappings can browse the source", () => {
  it("refuses a viewer the table list, the columns and the row preview", async () => {
    const viewer = as("viewer");
    await expect(viewer.mapping.listSqlTables({ connectorId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.mapping.listSqlColumns({ connectorId: 7, table: "contracts" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.mapping.previewSqlRows({ connectorId: 7, table: "salaries" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a viewer the connection test", async () => {
    await expect(
      as("viewer").mapping.testSqlConnection({ driver: "mysql", host: "10.0.0.5", database: "hr" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
