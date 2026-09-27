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

  it("shows where a base URL points, never the user name, password, query or fragment written into it", () => {
    const shown = (baseUrl: string) => publicConnector(connector("rest", { baseUrl })).configJson.baseUrl;
    expect(shown("https://svc:pa55@erp.acme.corp/api/v2?x=1")).toBe("https://erp.acme.corp/api/v2");
    expect(shown("https://erp.acme.corp/api/v2?api_key=K-1#access_token=T-1")).toBe("https://erp.acme.corp/api/v2");
    expect(shown("https://acct.blob.core.windows.net/exports?sv=2024-01-01&sig=SIG%3D")).toBe("https://acct.blob.core.windows.net/exports");
    expect(shown("https:svc:pa55@erp.acme.corp/api")).toBe("https://erp.acme.corp/api");
    expect(shown(" https://svc:pa55@erp.acme.corp/api")).toBe("https://erp.acme.corp/api");
    expect(shown("https://erp.acme.corp/api/v2")).toBe("https://erp.acme.corp/api/v2");
    // Not an http(s) URL: cut at the query or fragment, and hidden if it could hold userinfo.
    expect(shown("erp.acme.corp/api?token=T-1")).toBe("erp.acme.corp/api");
    expect(shown("erp.acme.corp/api#access_token=T-1")).toBe("erp.acme.corp/api");
    expect(shown("svc:pa55@erp")).toBe("(hidden)");
    expect(shown("ftp://svc:pa55@files.acme.corp/x")).toBe("(hidden)");
    expect(shown("erp.acme.corp/api")).toBe("erp.acme.corp/api");
  });

  it("carries the connector's known columns only, so a column added later does not reach clients unseen", () => {
    const row = { ...connector("csv", { filename: "hris.csv" }), sealedCredentials: "SENTINEL" } as Connector;
    expect(Object.keys(publicConnector(row)).sort()).toEqual(["configJson", "createdAt", "id", "name", "status", "type", "workspaceId"]);
  });

  it("copes with a connector that has no settings", () => {
    expect(publicConnector(connector("csv", null)).configJson).toEqual({ hasInlineData: false, hasPassword: false });
  });
});
