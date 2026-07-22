import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

/**
 * Pure session/crypto helpers — no next/headers, no db, no "server-only".
 * Safe to import from server components, server actions, and unit tests.
 */

export const SESSION_COOKIE = "luvy_session";

const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-only-luvy-secret-change-in-prod-0123456789abcdef",
);

export type SessionPayload = { userId: string };

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
