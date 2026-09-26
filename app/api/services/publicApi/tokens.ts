import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { apiTokens, workspaces, type ApiToken, type Workspace } from "@db/schema";
import { ACTION_ROLES, type ActionRole } from "@contracts/actions";
import { getDb } from "../../queries/connection";
import { writeAudit } from "../audit";

/**
 * API tokens for the public Ontology API. A token looks like
 * `ontos_<8 chars>_<32 chars>`; only its SHA-256 is stored, with the first
 * part as a prefix people can recognise. A token acts in one workspace with a
 * role no higher than its creator's.
 */

export const TOKEN_SCOPES = ["read", "actions"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomString(n: number): string {
  const bytes = randomBytes(n * 2);
  let out = "";
  for (let i = 0; out.length < n && i < bytes.length; i++) {
    // Reject the top of the byte range so every character is equally likely.
    if (bytes[i] < 248) out += ALPHABET[bytes[i] % 62];
  }
  return out.length === n ? out : out + randomString(n - out.length);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): { token: string; prefix: string; hash: string } {
  const prefix = `ontos_${randomString(8)}`;
  const token = `${prefix}_${randomString(32)}`;
  return { token, prefix, hash: hashToken(token) };
}

const TOKEN_SHAPE = /^ontos_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/;

const RANK: Record<ActionRole, number> = { viewer: 0, editor: 1, ontologist: 2, admin: 3 };

export class TokenRefused extends Error {}

export type TokenCreator = { name: string; userId: number | null; userRole: string; memberRole: string };

export type NewTokenInput = {
  name: string;
  role: ActionRole;
  scopes: TokenScope[];
  moduleScope?: string[] | null;
  expiresInDays?: number | null;
};

/** Creates a token and returns it in full, the only time it is shown. */
export async function createToken(
  workspaceId: number,
  creator: TokenCreator,
  input: NewTokenInput,
): Promise<{ token: string; row: Omit<ApiToken, "tokenHash"> }> {
  const creatorRank =
    creator.userRole === "admin"
      ? RANK.admin
      : Math.max(
          (ACTION_ROLES as readonly string[]).includes(creator.memberRole) ? RANK[creator.memberRole as ActionRole] : -1,
          (ACTION_ROLES as readonly string[]).includes(creator.userRole) ? RANK[creator.userRole as ActionRole] : -1,
        );
  if (RANK[input.role] > creatorRank) throw new TokenRefused(`A token cannot have a higher role (${input.role}) than its creator`);
  if (input.scopes.length === 0) throw new TokenRefused("A token needs at least one scope");
  const { token, prefix, hash } = newToken();
  const scopes = [...new Set(input.scopes)].sort();
  const moduleScope = input.moduleScope?.length ? [...new Set(input.moduleScope)].sort() : null;
  return getDb().transaction(async (tx) => {
    const [{ id }] = await tx
      .insert(apiTokens)
      .values({
        workspaceId,
        name: input.name,
        prefix,
        tokenHash: hash,
        role: input.role,
        scopes,
        moduleScope,
        createdBy: creator.name,
        createdByUserId: creator.userId,
        expiresAt: input.expiresInDays ? sql`now() + interval ${input.expiresInDays} day` : null,
      })
      .$returningId();
    await writeAudit(
      {
        workspaceId,
        actor: creator.name,
        action: `Created API token '${input.name}' (${prefix}…, ${input.role}, ${scopes.join("+")})`,
        entityType: "api_token",
        entityId: id,
        payload: { name: input.name, prefix, role: input.role, scopes, moduleScope, expiresInDays: input.expiresInDays ?? null },
      },
      tx,
    );
    const [row] = await tx.select().from(apiTokens).where(eq(apiTokens.id, id));
    const { tokenHash: _hash, ...visible } = row;
    void _hash;
    return { token, row: visible };
  });
}

export async function listTokens(workspaceId: number): Promise<Omit<ApiToken, "tokenHash">[]> {
  const rows = await getDb().select().from(apiTokens).where(eq(apiTokens.workspaceId, workspaceId)).orderBy(desc(apiTokens.id));
  return rows.map(({ tokenHash: _hash, ...visible }) => {
    void _hash;
    return visible;
  });
}

export async function revokeToken(workspaceId: number, id: number, actor: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.workspaceId, workspaceId)))
      .for("update");
    if (!row) return false;
    if (row.revokedAt) return true;
    await tx.update(apiTokens).set({ revokedAt: sql`now()` }).where(eq(apiTokens.id, id));
    await writeAudit(
      { workspaceId, actor, action: `Revoked API token '${row.name}' (${row.prefix}…)`, entityType: "api_token", entityId: id, payload: { prefix: row.prefix } },
      tx,
    );
    return true;
  });
}

export type TokenPrincipal = { token: ApiToken; workspace: Workspace };

/**
 * The token a bearer header names, if it is live: not revoked, not expired.
 * Null means no valid token. A database error is thrown: the token could not
 * be checked, which is not the same as a bad one.
 */
export async function authenticateToken(authorization: string | undefined): Promise<TokenPrincipal | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!m || !TOKEN_SHAPE.test(m[1])) return null;
  const db = getDb();
  const [row] = await db
    .select({ token: apiTokens, workspace: workspaces })
    .from(apiTokens)
    .innerJoin(workspaces, eq(apiTokens.workspaceId, workspaces.id))
    .where(eq(apiTokens.tokenHash, hashToken(m[1])))
    .limit(1);
  if (!row || row.token.revokedAt) return null;
  if (row.token.expiresAt && row.token.expiresAt.getTime() <= Date.now()) return null;
  // Record use at most once a minute per token. Best effort: bookkeeping that
  // fails must not refuse a token that was checked.
  if (!row.token.lastUsedAt || Date.now() - row.token.lastUsedAt.getTime() > 60_000) {
    try {
      await db.update(apiTokens).set({ lastUsedAt: sql`now()` }).where(eq(apiTokens.id, row.token.id));
    } catch {
      // the next use tries again
    }
  }
  return row;
}

export function hasScope(token: ApiToken, scope: TokenScope): boolean {
  return Array.isArray(token.scopes) && (token.scopes as unknown[]).includes(scope);
}
