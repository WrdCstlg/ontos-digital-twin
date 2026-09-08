import * as jose from "jose";
import { randomUUID } from "node:crypto";
import { env } from "../lib/env";

/**
 * Self-contained JWT session management for Ontos.
 * Signs and verifies HS256 tokens using the application secret.
 * Hardened with domain-bound issuer, unique JTI, and 7-day lifetime.
 */

const JWT_ALG = "HS256";
const JWT_ISSUER = "ontos-platform";

export type SessionPayload = {
  userId: number;
  email: string;
  role: string;
};

export async function signSessionToken(
  payload: SessionPayload,
): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("7d")
    .setIssuer(JWT_ISSUER)
    .setJti(randomUUID())
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) {
    return null;
  }
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
      issuer: JWT_ISSUER,
    });
    const { userId, email, role } = payload as unknown as SessionPayload;
    if (!userId || !email || !role) {
      console.warn("[session] JWT payload missing required claims.");
      return null;
    }
    return { userId, email, role };
  } catch (error) {
    console.warn("[session] JWT verification failed:", error);
    return null;
  }
}

