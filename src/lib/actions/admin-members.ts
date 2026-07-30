"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateTempPassword } from "@/lib/tempPassword";
import { audit } from "@/lib/audit";

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
