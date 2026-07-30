import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

/**
 * Pure session/crypto helpers — no next/headers, no db, no "server-only".
 * Safe to import from server components, server actions, and unit tests.
 */

export const SESSION_COOKIE = "luvy_session";

const rawSecret = process.env.AUTH_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_SECRET environment variable is required in production");
}
const secret = new TextEncoder().encode(
  rawSecret ?? "dev-only-luvy-secret-change-in-prod-0123456789abcdef",
);

/**
 * sv = sessionVersion. 비밀번호가 바뀌면 DB 값이 올라가고, 이 값이 다른 토큰은
 * 검증 단계에서 버려진다 → 옛 비밀번호로 로그인해 둔 기기가 즉시 로그아웃된다.
 */
export type SessionPayload = { userId: string; sv: number };

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.userId !== "string") return null;
    // sv 가 없는 토큰은 이 기능 도입 전에 발급된 것 → 0 으로 취급
    const sv = typeof payload.sv === "number" ? payload.sv : 0;
    return { userId: payload.userId, sv };
  } catch {
    return null;
  }
}
