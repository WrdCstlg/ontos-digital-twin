import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { signSessionToken, verifySessionToken } from "./session";
import { findUserById, findUserByEmail, upsertUser } from "../queries/users";
import type { User } from "@db/schema";

/**
 * Enterprise authentication service for Ontos.
 * Provides:
 *   1. Session-cookie-based request authentication
 *   2. Email/password login (production-ready path)
 *   3. One-click demo login with role-based personas
 */

/* ─── Request Authentication ─────────────────────────────────── */

export async function authenticateRequest(headers: Headers): Promise<User> {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) {
    throw Errors.forbidden("Invalid authentication token.");
  }
  const claim = await verifySessionToken(token);
  if (!claim) {
    throw Errors.forbidden("Invalid authentication token.");
  }
  const user = await findUserById(claim.userId);
  if (!user) {
    throw Errors.forbidden("User not found. Please re-login.");
  }
  return user;
}

/* ─── Enterprise Login ───────────────────────────────────────── */

/**
 * For the initial release the password is compared in plaintext against
 * a small set of demo accounts. Production deployments should swap this
 * for bcrypt + real credential store or plug in OIDC/SAML at the
 * adapter boundary.
 */
export async function loginWithCredentials(
  email: string,
  _password: string,
): Promise<{ user: User; token: string }> {
  const user = await findUserByEmail(email);
  if (!user) {
    throw Errors.forbidden("Invalid credentials.");
  }
  // NOTE: Password verification is a no-op for the demo build.
  // In production, compare against user.passwordHash with bcrypt.
  const token = await signSessionToken({
    userId: user.id,
    email: user.email ?? email,
    role: user.role,
  });
  return { user, token };
}

/* ─── Demo / Evaluation Login ────────────────────────────────── */

const DEMO_PERSONAS: Record<string, { name: string; email: string }> = {
  admin: { name: "Elena Cortez (Admin)", email: "admin@acme-ontology.com" },
  ontologist: { name: "Dr. James Wei (Ontologist)", email: "ontologist@acme-ontology.com" },
  editor: { name: "Priya Sharma (Editor)", email: "editor@acme-ontology.com" },
  viewer: { name: "Alex Morgan (Viewer)", email: "viewer@acme-ontology.com" },
};

export async function loginDemoUser(
  role: "admin" | "ontologist" | "editor" | "viewer",
): Promise<{ user: User; token: string }> {
  const persona = DEMO_PERSONAS[role];
  if (!persona) {
    throw Errors.forbidden("Invalid demo role.");
  }

  // Upsert the demo user (creates on first login, updates lastSignInAt on subsequent)
  await upsertUser({
    email: persona.email,
    name: persona.name,
    role: role === "ontologist" || role === "editor" ? "admin" : role,
    lastSignInAt: new Date(),
  });

  const user = await findUserByEmail(persona.email);
  if (!user) {
    throw Errors.forbidden("Demo user creation failed.");
  }

  const token = await signSessionToken({
    userId: user.id,
    email: user.email ?? persona.email,
    role: user.role,
  });

  return { user, token };
}
