import { describe, expect, it } from "vitest";
import type { Connector } from "@db/schema";
import { publicConnector } from "../services/connectorView";

const connector = (type: Connector["type"], configJson: Record<string, unknown> | null): Connector => ({
  id: 3,
  workspaceId: 1,
  name: "Source",
  type,
  configJson,
  status: "connected",
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

describe("publicConnector shows a connector's settings by name, and nothing else", () => {
  it("keeps what the app shows: file, rows, schedule, mode, and where a database is", () => {
    const shown = publicConnector(
      connector("sql", { driver: "mysql", host: "db.acme.corp", port: 3306, database: "hr", user: "reader", ssl: true, schema: "public", mode: "cdc", schedule: "hourly" }),
    );
    expect(shown.configJson).toEqual({
      driver: "mysql", host: "db.acme.corp", port: 3306, database: "hr", user: "reader", ssl: true, schema: "public", mode: "cdc", schedule: "hourly",
      hasInlineData: false, hasPassword: false,
    });
    expect(publicConnector(connector("csv", { filename: "hris.csv", rows: 12 })).configJson).toMatchObject({ filename: "hris.csv", rows: 12 });
  });

  it("drops a password and inline data, saying only that they exist", () => {
    const shown = publicConnector(connector("csv", { filename: "hris.csv", csvText: "name,salary\nAda,1", password: "s3cret" }));
    expect(shown.configJson).toEqual({ filename: "hris.csv", hasInlineData: true, hasPassword: true });
    expect(publicConnector(connector("sql", { password: "" })).configJson.hasPassword).toBe(false);
  });

  it("drops any setting it does not know, so a secret a later connector type adds stays hidden", () => {
    const shown = publicConnector(
      connector("rest", { baseUrl: "https://erp.acme.corp/api", apiKey: "k-123", token: "t-456", clientSecret: "c-789", headers: { authorization: "Bearer x" } }),
    );
    expect(Object.keys(shown.configJson).sort()).toEqual(["baseUrl", "hasInlineData", "hasPassword"]);
  });

  it("keeps a shown setting only as a plain value, never an object that could carry a secret", () => {
    const shown = publicConnector(connector("sql", { host: { name: "db", password: "p" }, user: ["reader", "s3cret"], port: 5432 }));
    expect(shown.configJson).toEqual({ port: 5432, hasInlineData: false, hasPassword: false });
  });

  it("shows a REST connector's kind of auth, never a credential in its place", () => {
    for (const kind of ["oauth2-client-credentials", "bearer", "api-key", "none"]) {
      expect(publicConnector(connector("rest", { auth: kind })).configJson).toHaveProperty("auth", kind);
    }
    expect(publicConnector(connector("rest", { auth: "Bearer eyJhbGciOi" })).configJson).not.toHaveProperty("auth");
  });

  it("removes a user name and password written into the base URL", () => {
    expect(publicConnector(connector("rest", { baseUrl: "https://svc:pa55@erp.acme.corp/api/v2?x=1" })).configJson.baseUrl).toBe(
      "https://erp.acme.corp/api/v2?x=1",
    );
    expect(publicConnector(connector("rest", { baseUrl: "https://erp.acme.corp/api/v2" })).configJson.baseUrl).toBe("https://erp.acme.corp/api/v2");
    expect(publicConnector(connector("rest", { baseUrl: "svc:pa55@erp" })).configJson.baseUrl).toBe("(hidden)");
    expect(publicConnector(connector("rest", { baseUrl: "erp.acme.corp/api" })).configJson.baseUrl).toBe("erp.acme.corp/api");
  });

  it("copes with a connector that has no settings", () => {
    expect(publicConnector(connector("csv", null)).configJson).toEqual({ hasInlineData: false, hasPassword: false });
  });
});
