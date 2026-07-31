"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin, createSession } from "@/lib/auth";
import { saveShippingPolicy, saveLogoUrl, getLogoUrl } from "@/lib/settings";
import { saveImageUpload, deleteImageUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";

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
  await audit({
    action: "SETTING_SHIPPING",
    target: "setting",
    targetId: "shipping",
    summary: `배송비 ${fee.toLocaleString("ko-KR")}원 / 무료 기준 ${freeThreshold.toLocaleString("ko-KR")}원`,
    meta: { fee, freeThreshold },
  });
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

  await audit({
    action: "ADMIN_PASSWORD",
    target: "admin",
    targetId: admin.id,
    summary: "관리자 비밀번호 변경 — 다른 기기 세션 전부 종료",
  });

  // 방금 바꾼 본인은 로그아웃되지 않도록 새 버전으로 세션을 재발급한다
  await createSession(admin.id);
  return { ok: true };
}

/**
 * 로고 교체. 업로드한 이미지는 헤더·로그인·푸터에 즉시 반영된다.
 * "기본 로고로 되돌리기" 는 파일을 비우고 저장하면 된다.
 */
export async function updateLogo(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireAdmin();

  const reset = formData.get("reset") === "1";
  const previous = await getLogoUrl();

  if (reset) {
    await saveLogoUrl("");
    if (previous) await deleteImageUpload(previous);
    await audit({ action: "BRANDING_UPDATE", target: "setting", targetId: "logo", summary: "기본 로고로 되돌림" });
    revalidatePath("/", "layout");
    return { ok: true };
  }

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "로고 이미지 파일을 선택해주세요." };
  }

  const saved = await saveImageUpload(file);
  if (!saved.ok) return { error: saved.error };

  await saveLogoUrl(saved.url);
  // 이전 로고 파일은 정리 (디스크에 고아 파일이 쌓이지 않게)
  if (previous) await deleteImageUpload(previous);

  await audit({ action: "BRANDING_UPDATE", target: "setting", targetId: "logo", summary: "로고 이미지 교체" });
  revalidatePath("/", "layout");
  return { ok: true };
}
