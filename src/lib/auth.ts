import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import {
  SESSION_COOKIE,
  signSession,
  verifySession,
} from "./session";

export { SESSION_COOKIE } from "./session";
export {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
} from "./session";

export type SessionUser = { id: string; email: string; companyName: string; role: string; status: string };

export async function createSession(userId: string): Promise<void> {
  const token = await signSession({ userId });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, companyName: true, role: true, status: true },
  });
  return user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

/** 로그인 + 가입 승인(APPROVED) 완료 회원만 통과. 미승인은 안내 페이지로. */
export async function requireApprovedUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.status !== "APPROVED") redirect("/account/pending");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "ADMIN") redirect("/");
  return user;
}
