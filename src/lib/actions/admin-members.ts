"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function setMemberStatus(id: string, status: "APPROVED" | "PENDING" | "REJECTED"): Promise<void> {
  const admin = await requireAdmin();
  // 관리자 자신의 상태는 변경하지 않음
  if (id === admin.id) return;
  await db.user.update({ where: { id }, data: { status } });
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${id}`);
}
