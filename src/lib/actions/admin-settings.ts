"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin, createSession } from "@/lib/auth";
import { saveShippingPolicy } from "@/lib/settings";

export type SettingsFormState = { error?: string; ok?: boolean };

export async function updateShippingSettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireAdmin();

  const fee = Number(formData.get("fee"));
  const freeThreshold = Number(formData.get("freeThreshold"));

  if (!Number.isInteger(fee) || fee < 0 || fee > 100_000) {
    return { error: "배송비는 0 ~ 100,000원 사이 정수여야 합니다." };
  }
  if (!Number.isInteger(freeThreshold) || freeThreshold < 0 || freeThreshold > 100_000_000) {
    return { error: "무료배송 기준 금액이 올바르지 않습니다." };
  }

  await saveShippingPolicy({ fee, freeThreshold });
  // 장바구니·결제 화면이 정책을 쓰므로 전체 갱신
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changeAdminPassword(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const admin = await requireAdmin();

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 8) return { error: "새 비밀번호는 8자 이상이어야 합니다." };
  if (next !== confirm) return { error: "새 비밀번호가 서로 다릅니다." };

  const me = await db.user.findUniqueOrThrow({
    where: { id: admin.id },
    select: { passwordHash: true },
  });
  if (!(await bcrypt.compare(current, me.passwordHash))) {
    return { error: "현재 비밀번호가 올바르지 않습니다." };
  }

  await db.user.update({
    where: { id: admin.id },
    // sessionVersion 을 올려 다른 기기에 남아 있는 세션을 모두 끊는다
    data: { passwordHash: await bcrypt.hash(next, 10), sessionVersion: { increment: 1 } },
  });

  // 방금 바꾼 본인은 로그아웃되지 않도록 새 버전으로 세션을 재발급한다
  await createSession(admin.id);
  return { ok: true };
}
