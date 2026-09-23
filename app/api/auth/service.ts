import * as cookie from "cookie";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { Session } from "@contracts/constants";
import { users, workspaceMembers } from "@db/schema";
import type { User } from "@db/schema";
import { signSessionToken, verifySessionToken } from "./session";
import { findUserById, findUserByEmail, upsertUser } from "../queries/users";
import { getDb } from "../queries/connection";
import { getSessionCookieName } from "../lib/cookies";
import { env } from "../lib/env";
import { hashPassword, verifyPassword } from "../lib/password";
import { authRateLimiter } from "../lib/rateLimit";
import { getDemoWorkspace } from "../services/audit";

/**
 * Enterprise authentication service for Ontos.
 * Provides:
 *   1. Hardened session-cookie request authentication
 *   2. Constant-time scrypt password verification with rate-limiting
 *   3. Role-accurate persona logins with security event logging
 */

/* ─── Client-Safe User Projection ────────────────────────────── */

/** A user record with every server-only field removed. */
export type PublicUser = Omit<User, "passwordHash">;

/**
 * Projects a user row down to the fields that may cross the wire.
 * `ctx.user` carries the full record for server-side role checks, so any
 * procedure that *returns* a user must pass it through here first.
 *
 * This is an allowlist rather than a `delete`: if a sensitive column is added
 * to the schema later, `PublicUser` gains it and this literal fails to compile
 * rather than silently leaking the new field.
 */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastSignInAt: user.lastSignInAt,
  };
}

/* ─── Request Authentication ─────────────────────────────────── */

export async function authenticateRequest(headers: Headers): Promise<User> {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const preferredName = getSessionCookieName(headers);
  const token =
    cookies[preferredName] ||
    cookies[Session.prodCookieName] ||
    cookies[Session.cookieName];

  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid or missing authentication token.",
    });
  }

  const claim = await verifySessionToken(token);
  if (!claim) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Session expired or invalid. Please re-authenticate.",
    });
  }

  const user = await findUserById(claim.userId);
  if (!user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "User not found. Please re-login.",
    });
  }

  // A persona session lives only while persona login is allowed. Once it is
  // switched off in production, a still-unexpired persona token stops working.
  if (env.isProduction && !env.allowDemoLogin && isDemoPersona(user.email)) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Session expired or invalid. Please re-authenticate.",
    });
  }

  return user;
}

/* ─── Enterprise Login ───────────────────────────────────────── */

export async function loginWithCredentials(
  email: string,
  password: string,
): Promise<{ user: User; token: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  // Sliding-window rate limit check per email / client
  const rl = authRateLimiter.check(normalizedEmail);
  if (!rl.allowed) {
    console.warn(`[security] Rate limit exceeded for login attempt: ${normalizedEmail}`);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many login attempts. Please wait ${Math.ceil(rl.resetMs / 1000)} seconds before trying again.`,
    });
  }

  // Personas sign in through the persona button only; they never hold a password.
  if (isDemoPersona(normalizedEmail)) {
    console.warn(`[security] Login refused - demo persona on the credential form: ${normalizedEmail}`);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid email or password.",
    });
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user) {
    console.warn(`[security] Login failed - unrecognized identifier: ${normalizedEmail}`);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid email or password.",
    });
  }

  let isValid = false;
  if (user.passwordHash) {
    isValid = await verifyPassword(password, user.passwordHash);
  } else {
    // In production, uninitialized accounts without password hash must be rejected
    // In development/test environments only, allow known fixed bootstrap passwords
    if (process.env.NODE_ENV !== "production") {
      const isDemoPassword = password === "ontos2026!" || password === "password123";
      if (isDemoPassword) {
        isValid = true;
        const newHash = await hashPassword(password);
        await getDb()
          .update(users)
          .set({ passwordHash: newHash })
          .where(eq(users.id, user.id));
      }
    }
  }

  if (!isValid) {
    console.warn(`[security] Login failed - password mismatch for: ${normalizedEmail}`);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid email or password.",
    });
  }

  // Clear rate-limit hits upon successful credentials
  authRateLimiter.reset(normalizedEmail);

  // Update lastSignIn timestamp
  await getDb()
    .update(users)
    .set({ lastSignInAt: new Date() })
    .where(eq(users.id, user.id));

  const token = await signSessionToken({
    userId: user.id,
    email: user.email ?? normalizedEmail,
    role: user.role,
  });

  return { user, token };
}

/* ─── Demo / Evaluation Login ────────────────────────────────── */

type DemoRole = "admin" | "ontologist" | "editor" | "viewer";

/**
 * One-click personas for demos. They exist only for the persona button: they
 * never hold a password, the credential form refuses them, and in production
 * their sessions stop working as soon as ALLOW_DEMO_LOGIN is off. Switching
 * demo mode off therefore closes every door it opened, rather than leaving
 * accounts behind with a password anyone can read in this source.
 *
 * The `demo-` prefix keeps them apart from the real admin account that
 * db/bootstrap.ts provisions at ADMIN_EMAIL.
 */
const DEMO_PERSONAS: Record<DemoRole, { name: string; email: string }> = {
  admin: { name: "Elena Cortez (Demo Admin)", email: "demo-admin@acme-ontology.com" },
  ontologist: { name: "Dr. James Wei (Ontologist)", email: "demo-ontologist@acme-ontology.com" },
  editor: { name: "Priya Sharma (Editor)", email: "demo-editor@acme-ontology.com" },
  viewer: { name: "Alex Morgan (Viewer)", email: "demo-viewer@acme-ontology.com" },
};

/**
 * Persona addresses from earlier builds, before the `demo-` prefix. Databases
 * created then may still hold these rows with a hash of the public demo
 * password, so they are treated as personas too.
 */
const LEGACY_PERSONA_EMAILS = [
  "admin@acme-ontology.com",
  "ontologist@acme-ontology.com",
  "editor@acme-ontology.com",
  "viewer@acme-ontology.com",
];

/** Every persona address, current and legacy, except the configured real admin. */
export function demoPersonaEmails(): string[] {
  const admin = env.adminEmail.trim().toLowerCase();
  return [...Object.values(DEMO_PERSONAS).map((p) => p.email), ...LEGACY_PERSONA_EMAILS].filter(
    (email) => email !== admin,
  );
}

export function isDemoPersona(email: string | null | undefined): boolean {
  return !!email && demoPersonaEmails().includes(email.trim().toLowerCase());
}

export async function loginDemoUser(role: DemoRole): Promise<{ user: User; token: string }> {
  const persona = DEMO_PERSONAS[role];
  if (!persona) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid demo role specified.",
    });
  }

  // Re-asserting the role and a null hash on every login also repairs persona
  // rows that earlier builds created with a password.
  await upsertUser({
    email: persona.email,
    name: persona.name,
    role,
    passwordHash: null,
    lastSignInAt: new Date(),
  });

  const user = await findUserByEmail(persona.email);
  if (!user) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Demo user creation failed.",
    });
  }

  // Workspace-scoped queries refuse non-admins who are not members, so the
  // persona joins the demo workspace in its own role.
  const workspace = await getDemoWorkspace();
  await getDb()
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role })
    .onDuplicateKeyUpdate({ set: { role } });

  const token = await signSessionToken({
    userId: user.id,
    email: user.email ?? persona.email,
    role: user.role,
  });

  return { user, token };
}

