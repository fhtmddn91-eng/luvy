"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateTempPassword } from "@/lib/tempPassword";
import { audit } from "@/lib/audit";
import { GRADE_CODES, adjustPoints, getGrades, gradeName } from "@/lib/memberPoints";
import { parseDiscountPercent, formatDiscountPercent, MAX_DISCOUNT_BP } from "@/lib/discount";

export type GradeFormState = { error?: string; ok?: boolean };

/** 회원 등급 지정 (운영자 요청서 2번). 등급은 관리자가 수동으로 정한다 */
export async function setMemberGrade(
  id: string,
  _prev: GradeFormState,
  formData: FormData,
): Promise<GradeFormState> {
  await requireAdmin();
  const code = String(formData.get("gradeCode") ?? "").trim();
  const gradeLocked = formData.get("gradeLocked") === "on";
  if (!(GRADE_CODES as readonly string[]).includes(code)) return { error: "등급을 선택해주세요." };
  const target = await db.user.findUnique({ where: { id }, select: { companyName: true, gradeCode: true, gradeLocked: true } });
  if (!target) return { error: "회원을 찾을 수 없습니다." };
  if (target.gradeCode === code && target.gradeLocked === gradeLocked) return { ok: true };

  await db.user.update({ where: { id }, data: { gradeCode: code, gradeLocked } });
  const grades = await getGrades();
  await audit({
    action: "MEMBER_GRADE",
    target: "member",
    targetId: id,
    summary: `${target.companyName} 등급 ${gradeName(grades, target.gradeCode)} → ${gradeName(grades, code)}${gradeLocked ? " (수동 고정)" : ""}`,
    meta: { from: target.gradeCode, to: code, gradeLocked },
  });
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${id}`);
  revalidatePath("/account");
  return { ok: true };
}

export type DiscountFormState = { error?: string; ok?: boolean };

/**
 * 이 거래처만의 할인율 (2026-09-08).
 *
 * **빈 칸 = 등급 기본값(null), 0 = 이 거래처는 할인 없음.** 둘을 같게 취급하면
 * 골드 거래처에서 할인만 빼는 지정이 불가능해진다 — 도매는 그런 경우가 생긴다.
 *
 * 다음 주문부터 적용된다. 이미 들어온 주문 금액은 스냅샷이라 바뀌지 않는다.
 */
export async function setMemberDiscount(
  id: string,
  _prev: DiscountFormState,
  formData: FormData,
): Promise<DiscountFormState> {
  await requireAdmin();
  const raw = String(formData.get("discountPercent") ?? "").trim();
  const next = raw === "" ? null : parseDiscountPercent(raw);
  if (raw !== "" && next === null) {
    return {
      error: `할인율은 0 ~ ${formatDiscountPercent(MAX_DISCOUNT_BP)}% 사이로 입력해주세요. (비워두면 등급 기본값)`,
    };
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { companyName: true, discountBp: true, grade: { select: { name: true, discountBp: true } } },
  });
  if (!target) return { error: "회원을 찾을 수 없습니다." };
  if (target.discountBp === next) return { ok: true };

  await db.user.update({ where: { id }, data: { discountBp: next } });
  const show = (v: number | null) =>
    v === null ? `등급 기본값(${formatDiscountPercent(target.grade.discountBp)}%)` : `${formatDiscountPercent(v)}%`;
  await audit({
    action: "MEMBER_DISCOUNT",
    target: "member",
    targetId: id,
    summary: `${target.companyName} 할인율 ${show(target.discountBp)} → ${show(next)}`,
    meta: { from: target.discountBp, to: next, gradeDiscountBp: target.grade.discountBp },
  });
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${id}`);
  return { ok: true };
}

export type PointFormState = { error?: string; ok?: boolean; balance?: number };

/**
 * 포인트 수동 지급/차감 (운영자 요청서 3번). 사유는 필수 — 원장에 남는 유일한 설명이다.
 * 금액은 양수만 받고 지급/차감 선택으로 부호를 정한다 — 운영자가 마이너스 기호를 빠뜨려
 * 차감이 지급으로 나가는 사고를 막는다.
 */
export async function adjustMemberPoints(
  id: string,
  _prev: PointFormState,
  formData: FormData,
): Promise<PointFormState> {
  const admin = await requireAdmin();
  const direction = String(formData.get("direction") ?? "add");
  const raw = Number(String(formData.get("amount") ?? "").replace(/,/g, "").trim());
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isInteger(raw) || raw <= 0) return { error: "금액은 1 이상의 정수로 입력해주세요." };
  if (!reason) return { error: "사유를 입력해주세요. (회원 포인트 내역에 그대로 표시됩니다)" };
  const amount = direction === "subtract" ? -raw : raw;

  const result = await adjustPoints({ userId: id, amount, reason, adminId: admin.id });
  if (result.error) return { error: result.error };

  const target = await db.user.findUnique({ where: { id }, select: { companyName: true } });
  await audit({
    action: "POINT_ADJUST",
    target: "member",
    targetId: id,
    summary: `${target?.companyName ?? id} ${amount > 0 ? "+" : ""}${amount.toLocaleString("ko-KR")}P — ${reason}`,
    meta: { amount, reason, balance: result.balance },
  });
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${id}`);
  revalidatePath("/account");
  return { ok: true, balance: result.balance };
}

export async function setMemberStatus(id: string, status: "APPROVED" | "PENDING" | "REJECTED"): Promise<void> {
  const admin = await requireAdmin();
  // 관리자 자신의 상태는 변경하지 않음
  if (id === admin.id) return;
  const target = await db.user.findUnique({
    where: { id },
    select: { companyName: true, status: true },
  });
  await db.user.update({ where: { id }, data: { status } });

  await audit({
    action:
      status === "APPROVED" ? "MEMBER_APPROVE" : status === "REJECTED" ? "MEMBER_REJECT" : "MEMBER_PENDING",
    target: "member",
    targetId: id,
    summary: `${target?.companyName ?? id} → ${status}`,
    meta: { from: target?.status, to: status },
  });

  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${id}`);
}

export type TempPasswordState = {
  /** 방금 발급한 임시 비밀번호. 화면에 한 번만 보여주고 다시 조회할 수 없다. */
  password?: string;
  error?: string;
};

/**
 * 임시 비밀번호 발급. 회원이 비밀번호를 잊었을 때 관리자가 눌러
 * 전화·카톡으로 전달한다. (메일 발송이 붙기 전까지의 복구 수단)
 *
 * 평문은 DB에 남기지 않고 이 응답에서 한 번만 보여준다.
 */
export async function issueTempPassword(
  memberId: string,
  _prev: TempPasswordState,
  _formData: FormData,
): Promise<TempPasswordState> {
  const admin = await requireAdmin();

  const target = await db.user.findUnique({
    where: { id: memberId },
    select: { id: true, role: true, companyName: true },
  });
  if (!target) return { error: "회원을 찾을 수 없습니다." };
  // 관리자 계정 비밀번호는 이 버튼으로 못 바꾼다 (관리자 탈취 시 2차 피해 방지)
  if (target.role === "ADMIN" || target.id === admin.id) {
    return { error: "관리자 계정에는 임시 비밀번호를 발급할 수 없습니다." };
  }

  const password = generateTempPassword();
  await db.user.update({
    where: { id: memberId },
    // 계정을 탈취당해 발급 요청이 들어온 경우를 대비해 기존 세션을 모두 끊는다
    data: { passwordHash: await bcrypt.hash(password, 10), sessionVersion: { increment: 1 } },
  });

  // 발급된 비밀번호 자체는 절대 기록하지 않는다 (기록에 남으면 그게 유출 경로가 된다)
  await audit({
    action: "MEMBER_TEMP_PASSWORD",
    target: "member",
    targetId: memberId,
    summary: `${target.companyName} 임시 비밀번호 발급 — 기존 세션 전부 종료`,
  });

  return { password };
}
