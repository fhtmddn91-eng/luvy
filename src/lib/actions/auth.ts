"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { isValidBizNumber, isValidEmail, normalizeBizNumber, safeNextPath } from "@/lib/validation";
import { saveBizCertUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";
import {
  hit,
  reset,
  retryMessage,
  LOGIN_PER_ACCOUNT,
  LOGIN_PER_IP,
  SIGNUP_PER_IP,
} from "@/lib/rateLimit";

export type AuthState = { error?: string };

/**
 * 요청 IP. 프록시(Railway/Cloudflare) 뒤에 있으므로 x-forwarded-for 를 본다.
 * 헤더는 위조 가능하지만, 위조하면 자기 카운터만 흩뜨리므로 계정 단위 제한과
 * 함께 쓰면 실효가 있다.
 */
async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");
  const companyName = String(formData.get("companyName") ?? "").trim();
  const businessNumber = String(formData.get("businessNumber") ?? "");
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  const ip = await clientIp();
  const gate = hit(`signup:${ip}`, SIGNUP_PER_IP);
  if (!gate.ok) {
    return { error: `가입 시도가 너무 많습니다. ${retryMessage(gate.retryAfterSec)}` };
  }

  if (!isValidEmail(email)) return { error: "올바른 이메일을 입력해주세요." };
  if (password.length < 8) return { error: "비밀번호는 8자 이상이어야 합니다." };
  if (password !== passwordConfirm) return { error: "비밀번호가 일치하지 않습니다." };
  if (!companyName) return { error: "상호명을 입력해주세요." };
  if (!isValidBizNumber(businessNumber)) return { error: "사업자등록번호 10자리를 확인해주세요." };
  if (!ownerName) return { error: "대표자명을 입력해주세요." };
  if (!phone) return { error: "연락처를 입력해주세요." };

  // 폐쇄몰 심사용 사업자등록증 첨부 (필수)
  const bizCert = formData.get("bizCert");
  if (!(bizCert instanceof File) || bizCert.size === 0) {
    return { error: "사업자등록증 파일을 첨부해주세요." };
  }

  const exists = await db.user.findUnique({ where: { email } });
  if (exists) return { error: "이미 가입된 이메일입니다." };

  const saved = await saveBizCertUpload(bizCert);
  if (!saved.ok) return { error: saved.error };

  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      companyName,
      businessNumber: normalizeBizNumber(businessNumber),
      bizCertFile: saved.name,
      ownerName,
      phone,
      status: "PENDING",
    },
  });

  await createSession(user.id);
  redirect("/account/pending");
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  const ip = await clientIp();

  // 계정 단위 + IP 단위 두 겹으로 막는다.
  // 계정만 막으면 여러 계정을 훑는 공격이 통하고, IP만 막으면 분산 공격에
  // 특정 계정이 계속 노려진다.
  const accountKey = `login:acct:${email.toLowerCase()}`;
  const ipKey = `login:ip:${ip}`;

  const byAccount = hit(accountKey, LOGIN_PER_ACCOUNT);
  const byIp = hit(ipKey, LOGIN_PER_IP);
  if (!byAccount.ok || !byIp.ok) {
    const sec = Math.max(byAccount.retryAfterSec, byIp.retryAfterSec);
    // 공격 징후는 남긴다. 세션이 없으므로 행위자를 직접 지정한다.
    await audit({
      action: "LOGIN_BLOCKED",
      target: "auth",
      targetId: email.toLowerCase().slice(0, 120),
      summary: `로그인 시도 초과로 차단 (${!byAccount.ok ? "계정" : "IP"} 한도)`,
      actor: { id: null, name: email.slice(0, 120) || "(빈 아이디)", role: "ANON" },
    });
    return {
      error: `로그인 시도가 너무 많습니다. ${retryMessage(sec)} 비밀번호를 잊으셨다면 고객센터로 문의해주세요.`,
    };
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    // 계정 존재 여부를 노출하지 않도록 메시지는 하나로 유지
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  // 정상 로그인했으면 실패 카운터를 비워 다음 로그인에 불이익이 없게 한다
  reset(accountKey);
  reset(ipKey);

  await createSession(user.id);

  // 메인에서 환영 팝업을 한 번 띄우기 위한 1회용 표식.
  // httpOnly가 아니어야 팝업을 띄운 뒤 클라이언트가 즉시 지울 수 있다.
  // (민감 정보가 아니며, 없어도 로그인 자체에는 영향이 없다)
  const store = await cookies();
  store.set("luvy_welcome", "1", {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  redirect(safeNextPath(next));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
