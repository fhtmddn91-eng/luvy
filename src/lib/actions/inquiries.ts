"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { safeNextPath } from "@/lib/validation";
import { INQUIRY_TYPES } from "@/lib/inquiry";

export type InquiryFormState = { error?: string };

export async function createInquiry(
  _prev: InquiryFormState,
  formData: FormData,
): Promise<InquiryFormState> {
  const user = await requireUser();

  const type = String(formData.get("type") ?? "GENERAL");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const back = safeNextPath(String(formData.get("back") ?? "/support/inquiry"));

  if (!(type in INQUIRY_TYPES)) return { error: "잘못된 문의 유형입니다." };
  if (!title) return { error: "제목을 입력해주세요." };
  if (title.length > 100) return { error: "제목은 100자 이내로 입력해주세요." };
  if (!content) return { error: "내용을 입력해주세요." };
  if (content.length > 2000) return { error: "내용은 2,000자 이내로 입력해주세요." };

  await db.inquiry.create({ data: { userId: user.id, type, title, content } });

  revalidatePath("/support/inquiry");
  revalidatePath("/admin/inquiries");
  redirect(`${back}?submitted=1`);
}

export async function answerInquiry(
  id: string,
  _prev: InquiryFormState,
  formData: FormData,
): Promise<InquiryFormState> {
  await requireAdmin();

  const answer = String(formData.get("answer") ?? "").trim();
  if (!answer) return { error: "답변 내용을 입력해주세요." };

  await db.inquiry.update({
    where: { id },
    data: { answer, status: "ANSWERED", answeredAt: new Date() },
  });

  revalidatePath("/admin/inquiries");
  revalidatePath("/support/inquiry");
  redirect("/admin/inquiries");
}
