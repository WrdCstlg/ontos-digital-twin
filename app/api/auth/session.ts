import * as jose from "jose";
import { env } from "../lib/env";

/**
 * Self-contained JWT session management for Ontos.
 * Signs and verifies HS256 tokens using the application secret.
 * No external dependencies — fully decoupled from any third-party auth provider.
 */

const JWT_ALG = "HS256";

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
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) {
    console.warn("[session] No token provided for verification.");
    return null;
  }
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    const { userId, email, role } = payload as unknown as SessionPayload;
    if (!userId || !email || !role) {
      console.warn("[session] JWT payload missing required fields.");
      return null;
    }
    return { userId, email, role };
  } catch (error) {
    console.warn("[session] JWT verification failed:", error);
    return null;
  }
}
