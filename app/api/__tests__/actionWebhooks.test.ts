/**
 * An action's webhook address is often its credential (a Slack incoming
 * webhook lets anyone who has it post). Members who author actions see it in
 * full; every other member sees only where it goes, wherever the address
 * travels: the definitions (current and every version), and the results and
 * errors of the jobs that deliver to it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import type { User } from "@db/schema";
import { actionSubmissions, actionTypeVersions, jobs } from "@db/schema";
import { actionDefinitionSchema } from "@contracts/actions";
import { appRouter } from "../router";
import { redactDefinition, redactDeliveryResult, redactUrl, redactUrlsIn, webhookAddressProblem } from "../services/actions/webhookView";
import { createMockContext, mockAdminUser, mockOntologistUser, mockViewerUser, mockWorkspace } from "./testHarness";

const store = vi.hoisted(() => ({ tables: new Map<string, Record<string, unknown>[]>() }));
vi.mock("../queries/connection", async () => ({ getDb: (await import("./memoryDb")).memoryDbFor(store.tables) }));

const HOOK = "https://hooks.slack.com/services/T000/B000/SENTINEL-HOOK";
const at = new Date("2026-01-01T00:00:00Z");
// A definition the schema accepts, so every route that parses one redacts it.
const definition = {
  parameters: [{ name: "person", label: "Person", type: "object", classIri: "hr:Person", required: true }],
  criteria: [],
  rules: [{ kind: "modify_object", object: "person", properties: { status: "notified" } }],
  validation: { shacl: false },
  sideEffects: [{ kind: "webhook", url: HOOK }],
};
const actionType = {
  id: 7, workspaceId: mockWorkspace.id, key: "notify", displayName: "Notify", description: null, moduleId: 1, minRole: "viewer", status: "active",
  version: 2, definitionJson: definition, createdBy: "a", updatedBy: "a", createdAt: at, updatedAt: at,
};
const module = { key: "hr", name: "HR", color: "#fff" };

vi.mock("../services/actions/definitions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/actions/definitions")>()),
  listActionTypes: vi.fn(async () => [{ ...actionType, module, definition, submissions: { applied: 0, rejected: 0, lastAt: null } }]),
  listVersions: vi.fn(async () => [
    { id: 71, actionTypeId: 7, version: 2, definitionJson: definition, changedBy: "a", createdAt: at },
    { id: 70, actionTypeId: 7, version: 1, definitionJson: { ...definition, sideEffects: [{ kind: "webhook", url: `${HOOK}-OLD` }] }, changedBy: "a", createdAt: at },
  ]),
}));
vi.mock("../services/actions/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/actions/service")>()),
  loadActionType: vi.fn(async () => ({ actionType, module, definition })),
}));

const caller = (user: User, role: "viewer" | "editor" | "ontologist" | "admin") =>
  appRouter.createCaller(
    createMockContext({ user, workspace: mockWorkspace, membership: { id: 900, workspaceId: mockWorkspace.id, userId: user.id, role, moduleScope: null, createdAt: at } }),
  );

afterEach(() => store.tables.clear());

describe("action webhook addresses", () => {
  it("show only where they go in the definitions a member who does not author actions reads", async () => {
    for (const role of ["viewer", "editor"] as const) {
      const c = caller(mockViewerUser, role);
      const seen = JSON.stringify([await c.actions.listTypes(), await c.actions.getType({ key: "notify" })]);
      expect(seen, role).not.toContain("SENTINEL-HOOK");
      expect(seen, role).toContain("https://*.slack.com/…");
    }
  });

  it("are shown in full to those who author actions", async () => {
    for (const [user, role] of [[mockOntologistUser, "ontologist"], [mockAdminUser, "admin"]] as const) {
      const type = await caller(user, role).actions.getType({ key: "notify" });
      expect(JSON.stringify(type), role).toContain("SENTINEL-HOOK-OLD");
      expect(type.definition.sideEffects[0].url).toBe(HOOK);
    }
  });

  it("show only where they go in a submission's deliveries: their results and errors", async () => {
    const put = (t: Table, r: Record<string, unknown>[]) => store.tables.set(getTableName(t), r);
    put(actionSubmissions, [{ id: 1, workspaceId: mockWorkspace.id, actionTypeId: 7, actionKey: "notify", actionVersion: 2, sideEffectJobIds: [31, 32], status: "applied", createdAt: at }]);
    put(jobs, [
      { id: 31, workspaceId: mockWorkspace.id, kind: "action.webhook", status: "succeeded", attempts: 1, maxAttempts: 3, lastError: null, resultJson: { url: HOOK, status: 200 }, finishedAt: at },
      { id: 32, workspaceId: mockWorkspace.id, kind: "action.webhook", status: "failed", attempts: 3, maxAttempts: 3, lastError: `webhook ${HOOK} answered HTTP 500`, resultJson: null, finishedAt: at },
    ]);
    put(actionTypeVersions, [{ id: 71, actionTypeId: 7, version: 2, definitionJson: definition, changedBy: "a", createdAt: at }]);
    expect(actionDefinitionSchema.safeParse(definition).success).toBe(true);
    const asViewer = await caller(mockViewerUser, "viewer").actions.getSubmission({ id: 1 });
    const viewer = JSON.stringify(asViewer);
    expect(viewer).not.toContain("SENTINEL-HOOK");
    expect(viewer).toContain("webhook https://*.slack.com/… answered HTTP 500");
    expect(asViewer.definition?.sideEffects[0].url).toBe("https://*.slack.com/…");
    const asAdmin = await caller(mockAdminUser, "admin").actions.getSubmission({ id: 1 });
    expect(JSON.stringify(asAdmin)).toContain("SENTINEL-HOOK");
    expect(asAdmin.definition?.sideEffects[0].url).toBe(HOOK);
  });
});

describe("webhookView", () => {
  it("keeps where an address goes, and never its path, query, fragment or user name", () => {
    expect(redactUrl("https://hooks.slack.com/services/T/B/X")).toBe("https://*.slack.com/…");
    expect(redactUrl("https://user:pw@hooks.example.com/")).toBe("https://*.example.com");
    expect(redactUrl("https://hooks.example.com/?token=X")).toBe("https://*.example.com/…");
    expect(redactUrl("https://hooks.example.com")).toBe("https://*.example.com");
    expect(redactUrl("ftp://files.example.com/x")).toBe("(hidden)");
    expect(redactUrl("not a url")).toBe("(hidden)");
  });

  it("masks a host down to its registrable domain, since some services keep the credential in the host", () => {
    expect(redactUrl("https://eo1a2b3c4d5e6f7.m.pipedream.net")).toBe("https://*.pipedream.net");
    expect(redactUrl("https://abcdefgh1234.lambda-url.us-east-1.on.aws/")).toBe("https://*.on.aws");
    expect(redactUrl("https://7f3c-81-2-69-160.ngrok-free.app/hook")).toBe("https://*.ngrok-free.app/…");
    expect(redactUrl("https://hooks.example.co.uk/x")).toBe("https://*.example.co.uk/…");
    // Nothing before the domain to mask; a port is kept; an IP or single-label host is shown as it is.
    expect(redactUrl("https://example.com:8443/x")).toBe("https://example.com:8443/…");
    expect(redactUrl("http://93.184.216.34/hook")).toBe("http://93.184.216.34/…");
    expect(redactUrl("https://[2606:4700::1111]/hook")).toBe("https://[2606:4700::1111]/…");
    expect(redactUrl("http://localhost:3000/x")).toBe("http://localhost:3000/…");
  });

  it("redacts every address in a message, and leaves other words alone", () => {
    expect(redactUrlsIn("webhook https://a.example/x/SECRET answered HTTP 500; retry https://b.example/y?k=SECRET")).toBe(
      "webhook https://a.example/… answered HTTP 500; retry https://b.example/…",
    );
    expect(redactUrlsIn(null)).toBeNull();
    expect(redactUrlsIn("no address here")).toBe("no address here");
  });

  it("redacts the whole address an older delivery error quoted, spaces and quotes included", () => {
    for (const url of [
      "https://hooks.example.com/hook?token=abc SECRETTAIL",
      "https://hooks.example.com/hook/ab'SECRETTAIL",
      'https://hooks.example.com/a"b SECRETTAIL',
    ]) {
      expect(redactUrlsIn(`webhook ${url} answered HTTP 302 (redirects are not followed)`), url).toBe(
        "webhook https://*.example.com/… answered HTTP 302 (redirects are not followed)",
      );
    }
    expect(redactUrlsIn("not a URL: https://exa mple.com/SECRETTAIL")).toBe("not a URL: (hidden)");
  });

  it("reads the same when redacted twice", () => {
    for (const text of [`webhook ${HOOK} answered HTTP 500`, "webhook https://hooks.example.com answered HTTP 500", "webhook not-a-url answered HTTP 500"]) {
      const once = redactUrlsIn(text);
      expect(redactUrlsIn(once), text).toBe(once);
    }
  });

  it("names what an address may not hold raw, and lets anything else through", () => {
    for (const bad of ["https://h.example/a b", "https://h.example/a'b", 'https://h.example/a"b', "https://h.example/a<b>", "https://h.example/a`b", "https://h.example/a\tb", "https://h.example/a b", "https://h.example/a\u0000b"]) {
      expect(webhookAddressProblem(bad), JSON.stringify(bad)).toMatch(/percent-encoded/);
    }
    for (const good of ["https://hooks.slack.com/services/T000/B000/XXXX", "https://h.example/a%20b?x=1&y=%27", "https://bücher.example/hook"]) {
      expect(webhookAddressProblem(good), good).toBeNull();
    }
  });

  it("redacts a definition's side effects and a delivery result, leaving anything else as it is", () => {
    expect(redactDefinition({ parameters: [], sideEffects: [{ type: "webhook", url: HOOK }, { type: "other" }] })).toEqual({
      parameters: [],
      sideEffects: [{ type: "webhook", url: "https://*.slack.com/…" }, { type: "other" }],
    });
    expect(redactDefinition(null)).toBeNull();
    expect(redactDefinition({ parameters: [] })).toEqual({ parameters: [] });
    expect(redactDeliveryResult({ url: HOOK, status: 200 })).toEqual({ url: "https://*.slack.com/…", status: 200 });
    expect(redactDeliveryResult({ rows: 3 })).toEqual({ rows: 3 });
  });
});
