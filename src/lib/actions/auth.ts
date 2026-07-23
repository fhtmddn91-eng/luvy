"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { isValidBizNumber, isValidEmail, normalizeBizNumber, safeNextPath } from "@/lib/validation";

export type AuthState = { error?: string };

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");
  const companyName = String(formData.get("companyName") ?? "").trim();
  const businessNumber = String(formData.get("businessNumber") ?? "");
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!isValidEmail(email)) return { error: "올바른 이메일을 입력해주세요." };
  if (password.length < 8) return { error: "비밀번호는 8자 이상이어야 합니다." };
  if (password !== passwordConfirm) return { error: "비밀번호가 일치하지 않습니다." };
  if (!companyName) return { error: "상호명을 입력해주세요." };
  if (!isValidBizNumber(businessNumber)) return { error: "사업자등록번호 10자리를 확인해주세요." };
  if (!ownerName) return { error: "대표자명을 입력해주세요." };
  if (!phone) return { error: "연락처를 입력해주세요." };

  const exists = await db.user.findUnique({ where: { email } });
  if (exists) return { error: "이미 가입된 이메일입니다." };

  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      companyName,
      businessNumber: normalizeBizNumber(businessNumber),
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

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  await createSession(user.id);
  redirect(safeNextPath(next));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
