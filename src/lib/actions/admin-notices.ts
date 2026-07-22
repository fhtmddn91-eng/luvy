"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export type NoticeFormState = { error?: string };

function parse(formData: FormData) {
  return {
    kind: String(formData.get("kind") ?? "notice"),
    tag: String(formData.get("tag") ?? "").trim(),
    text: String(formData.get("text") ?? "").trim(),
    sortOrder: parseInt(String(formData.get("sortOrder") ?? "0"), 10) || 0,
    active: formData.get("active") === "on",
  };
}

function validate(f: ReturnType<typeof parse>): string | null {
  if (!f.tag) return "태그를 입력해주세요.";
  if (!f.text) return "내용을 입력해주세요.";
  return null;
}

function revalidate() {
  revalidatePath("/admin/notices");
  revalidatePath("/", "layout");
}

export async function createNotice(_prev: NoticeFormState, formData: FormData): Promise<NoticeFormState> {
  await requireAdmin();
  const data = parse(formData);
  const err = validate(data);
  if (err) return { error: err };
  await db.notice.create({ data });
  revalidate();
  redirect("/admin/notices");
}

export async function updateNotice(id: string, _prev: NoticeFormState, formData: FormData): Promise<NoticeFormState> {
  await requireAdmin();
  const data = parse(formData);
  const err = validate(data);
  if (err) return { error: err };
  await db.notice.update({ where: { id }, data });
  revalidate();
  redirect("/admin/notices");
}

export async function toggleNoticeActive(id: string, active: boolean): Promise<void> {
  await requireAdmin();
  await db.notice.update({ where: { id }, data: { active } });
  revalidate();
}

export async function deleteNotice(id: string): Promise<void> {
  await requireAdmin();
  await db.notice.delete({ where: { id } });
  revalidate();
}
