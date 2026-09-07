"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin, createSession } from "@/lib/auth";
import { saveShippingPolicy, saveLogoUrl, getLogoUrl } from "@/lib/settings";
import { saveImageUpload, deleteImageUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { COMPANY_FIELDS } from "@/lib/company";
import { saveCompany, resetCompany } from "@/lib/companyInfo";
import { BANK_FIELDS } from "@/lib/bankAccount";
import { saveBankAccount } from "@/lib/bankAccountInfo";
import { GRADE_CODES, evaluateGradeFor, getGrades, gradeName } from "@/lib/memberPoints";
import { parseRatePercent, formatRatePercent } from "@/lib/points";
import { parseDiscountPercent, formatDiscountPercent, MAX_DISCOUNT_BP } from "@/lib/discount";
import { savePointPolicy } from "@/lib/settings";

export type SettingsFormState = { error?: string; ok?: boolean };
/** 전체 재평가 결과 — 몇 명이 올라갔는지 */
export type ReevaluateState = SettingsFormState & { changed?: number };

/**
 * 회원 등급 이름·적립률 (운영자 요청서 2·3번). 코드 3개는 고정이고 이름과 적립률만 바꾼다.
 * 적립률은 % 로 받아 만분율로 저장 — 소수 둘째 자리까지. 이미 쌓인 포인트는 건드리지 않는다.
 */
export async function updateMemberGrades(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireAdmin();
  const rows: { code: string; name: string; pointRateBp: number; threshold: number; discountBp: number }[] = [];
  for (const code of GRADE_CODES) {
    const name = String(formData.get(`name-${code}`) ?? "").trim();
    const rateBp = parseRatePercent(String(formData.get(`rate-${code}`) ?? ""));
    const discountBp = parseDiscountPercent(String(formData.get(`discount-${code}`) ?? "0"));
    const threshold = Number(String(formData.get(`threshold-${code}`) ?? "0").replace(/,/g, "").trim() || "0");
    if (!name || name.length > 20) return { error: `${code} 등급 이름은 1~20자로 입력해주세요.` };
    if (rateBp === null) return { error: `${name} 등급의 적립률은 0 ~ 100 사이, 소수 둘째 자리까지만 가능합니다.` };
    if (discountBp === null) {
      return {
        error: `${name} 등급의 할인율은 0 ~ ${formatDiscountPercent(MAX_DISCOUNT_BP)}% 사이, 소수 둘째 자리까지만 가능합니다.`,
      };
    }
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 10_000_000_000) {
      return { error: `${name} 등급의 승급 기준 금액이 올바르지 않습니다. (0 이면 자동 승급 없음)` };
    }
    // 가장 낮은 등급(BASIC)은 기준이 없다 — 누구나 시작하는 자리
    rows.push({ code, name, pointRateBp: rateBp, threshold: code === GRADE_CODES[0] ? 0 : threshold, discountBp });
  }
  await db.$transaction(
    rows.map((r) =>
      db.memberGrade.update({
        where: { code: r.code },
        data: { name: r.name, pointRateBp: r.pointRateBp, threshold: r.threshold, discountBp: r.discountBp },
      }),
    ),
  );
  await audit({
    action: "SETTING_GRADES",
    target: "setting",
    targetId: "grades",
    summary: rows
      .map(
        (r) =>
          `${r.name} 적립 ${formatRatePercent(r.pointRateBp)}%` +
          `${r.discountBp > 0 ? ` / 할인 ${formatDiscountPercent(r.discountBp)}%` : ""}` +
          `${r.threshold > 0 ? ` / ${r.threshold.toLocaleString("ko-KR")}원↑` : ""}`,
      )
      .join(" · "),
    meta: { grades: rows },
  });
  revalidatePath("/admin/settings");
  revalidatePath("/admin/members");
  revalidatePath("/account");
  return { ok: true };
}

/** 포인트 정책 — 최소 사용량·단위·만료 개월 */
export async function updatePointPolicy(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireAdmin();
  const minUse = Number(formData.get("minUse"));
  const unit = Number(formData.get("unit"));
  const expiryMonths = Number(formData.get("expiryMonths"));
  if (!Number.isInteger(minUse) || minUse < 0 || minUse > 10_000_000) return { error: "최소 사용 포인트는 0 이상의 정수여야 합니다." };
  if (!Number.isInteger(unit) || unit < 1 || unit > 100_000) return { error: "사용 단위는 1 이상의 정수여야 합니다. (1 이면 제한 없음)" };
  if (minUse > 0 && minUse % unit !== 0) return { error: "최소 사용 포인트는 사용 단위의 배수여야 합니다." };
  if (!Number.isInteger(expiryMonths) || expiryMonths < 0 || expiryMonths > 120) return { error: "만료 개월은 0 ~ 120 사이 정수여야 합니다. (0 이면 만료 없음)" };
  await savePointPolicy({ minUse, unit, expiryMonths });
  await audit({
    action: "SETTING_POINTS",
    target: "setting",
    targetId: "points",
    summary: `최소 ${minUse.toLocaleString("ko-KR")}P · ${unit.toLocaleString("ko-KR")}P 단위 · 만료 ${expiryMonths === 0 ? "없음" : `${expiryMonths}개월`}`,
    meta: { minUse, unit, expiryMonths },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** 전체 회원 자동 승급 재평가 — 올라가기만, 수동 고정은 건너뜀. 바뀐 회원마다 감사 로그 */
export async function reevaluateAllGrades(
  _prev: ReevaluateState,
  _formData: FormData,
): Promise<ReevaluateState> {
  await requireAdmin();
  const members = await db.user.findMany({ where: { role: "MEMBER", gradeLocked: false }, select: { id: true, companyName: true } });
  const grades = await getGrades();
  let changed = 0;
  for (const m of members) {
    const promoted = await evaluateGradeFor(m.id);
    if (!promoted) continue;
    changed++;
    await audit({
      action: "MEMBER_GRADE",
      target: "member",
      targetId: m.id,
      summary: `${m.companyName} 자동 승급 ${gradeName(grades, promoted.from)} → ${gradeName(grades, promoted.to)} (전체 재평가)`,
      meta: { ...promoted, auto: true },
    });
  }
  revalidatePath("/admin/members");
  revalidatePath("/account");
  return { ok: true, changed };
}

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

/**
 * 사업자·고객센터 정보. 전자상거래법상 표시 항목이라 푸터·약관·개인정보처리방침이
 * 전부 이 값을 본다 — 저장 후 전 페이지를 갱신한다.
 */
export async function updateCompanyInfo(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireAdmin();

  const values: Record<string, string> = {};
  for (const { key } of COMPANY_FIELDS) values[key] = String(formData.get(key) ?? "");

  // 상호·대표자·사업자등록번호는 법정 표시 항목이라 비울 수 없다
  for (const key of ["name", "ceo", "businessNumber", "email"] as const) {
    if (values[key].trim() === "") {
      const label = COMPANY_FIELDS.find((f) => f.key === key)?.label ?? key;
      return { error: `${label}은(는) 비워둘 수 없습니다.` };
    }
  }

  await saveCompany(values);
  await audit({
    action: "COMPANY_UPDATE",
    target: "setting",
    targetId: "company",
    summary: `사업자·고객센터 정보 수정 (${values.name})`,
  });
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
  return { ok: true };
}

/** 저장한 값을 지우고 코드 기본값으로 되돌린다 */
export async function resetCompanyInfo(): Promise<void> {
  await requireAdmin();
  await resetCompany();
  await audit({
    action: "COMPANY_UPDATE",
    target: "setting",
    targetId: "company",
    summary: "사업자·고객센터 정보 기본값으로 되돌림",
  });
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
}

/**
 * 무통장입금 계좌. 계좌가 바뀔 때 배포 없이 여기서 고친다.
 * 주문서·주문 완료·주문 상세 안내가 전부 이 값을 본다.
 */
export async function updateBankAccount(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireAdmin();

  const values: Record<string, string> = {};
  for (const { key } of BANK_FIELDS) values[key] = String(formData.get(key) ?? "");

  // 셋 중 하나만 비어도 "하나은행 (예금주: )" 같은 반쪽 안내가 나간다 → 전부 필수
  for (const { key, label } of BANK_FIELDS) {
    if (values[key].trim() === "") return { error: `${label}을(를) 입력해주세요.` };
  }

  await saveBankAccount(values);
  await audit({
    action: "SETTING_BANK",
    target: "setting",
    targetId: "bank",
    summary: `입금 계좌 변경 — ${values.bank} ${values.number} (${values.holder})`,
  });
  // 주문서·완료·주문 상세가 이 값을 쓴다
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
  return { ok: true };
}
