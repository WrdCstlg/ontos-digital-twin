import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { mockWorkspace } from "./testHarness";

const db = vi.hoisted(() => ({ rows: [] as unknown[], selectFails: false, updateFails: false, updates: 0, wheres: [] as unknown[] }));
vi.mock("../queries/connection", () => {
  const select = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    Object.assign(c, {
      from: self,
      innerJoin: self,
      limit: self,
      where: (w: unknown) => {
        db.wheres.push(w);
        return c;
      },
      then: (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
        (db.selectFails ? Promise.reject(Object.assign(new Error("connect"), { code: "ECONNREFUSED" })) : Promise.resolve(db.rows)).then(resolve, reject),
    });
    return c;
  };
  const update = () => ({
    set: () => ({
      where: async () => {
        db.updates++;
        if (db.updateFails) throw new Error("read-only replica");
      },
    }),
  });
  return { getDb: vi.fn(() => ({ select, update })) };
});

import { authenticateToken, hashToken, newToken } from "../services/publicApi/tokens";

const live = newToken();
const row = (over: Record<string, unknown> = {}) => ({
  token: { id: 5, workspaceId: 1, tokenHash: live.hash, revokedAt: null, expiresAt: null, lastUsedAt: null, ...over },
  workspace: mockWorkspace,
});

afterEach(() => {
  Object.assign(db, { rows: [], selectFails: false, updateFails: false, updates: 0, wheres: [] });
});

describe("authenticateToken", () => {
  it("finds a live token by the hash of what was sent, never by the token itself", async () => {
    db.rows = [row()];
    await expect(authenticateToken(`Bearer ${live.token}`)).resolves.toMatchObject({ token: { id: 5 } });
    const { params } = new MySqlDialect().sqlToQuery(db.wheres[0] as SQL);
    expect(params).toEqual([hashToken(live.token)]);
    expect(JSON.stringify(params)).not.toContain(live.token);
  });

  it("refuses a revoked token, an expired one, and one it does not know", async () => {
    db.rows = [row({ revokedAt: new Date() })];
    await expect(authenticateToken(`Bearer ${live.token}`)).resolves.toBeNull();
    db.rows = [row({ expiresAt: new Date(Date.now() - 1_000) })];
    await expect(authenticateToken(`Bearer ${live.token}`)).resolves.toBeNull();
    db.rows = [];
    await expect(authenticateToken(`Bearer ${live.token}`)).resolves.toBeNull();
  });

  it("records use at most once a minute, and a failed record never refuses the token", async () => {
    db.rows = [row({ lastUsedAt: new Date() })];
    await authenticateToken(`Bearer ${live.token}`);
    expect(db.updates).toBe(0);
    db.rows = [row({ lastUsedAt: new Date(Date.now() - 120_000) })];
    db.updateFails = true;
    await expect(authenticateToken(`Bearer ${live.token}`)).resolves.toMatchObject({ token: { id: 5 } });
    expect(db.updates).toBe(1);
  });

  it("lets a database that cannot be reached fail loudly, so the caller answers 503, not 401", async () => {
    db.selectFails = true;
    await expect(authenticateToken(`Bearer ${live.token}`)).rejects.toThrow("connect");
  });
});
