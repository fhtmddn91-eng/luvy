"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { FAQ_DEFAULTS } from "@/lib/faqDefaults";

export type FaqFormState = { error?: string };

function parse(formData: FormData) {
  return {
    category: String(formData.get("category") ?? "").trim().slice(0, 30),
    question: String(formData.get("question") ?? "").trim().slice(0, 200),
    answer: String(formData.get("answer") ?? "").trim().slice(0, 2000),
    sortOrder: parseInt(String(formData.get("sortOrder") ?? "0"), 10) || 0,
    active: formData.get("active") === "on",
  };
}

function validate(f: ReturnType<typeof parse>): string | null {
  if (!f.category) return "분류를 입력해주세요. 예) 배송";
  if (!f.question) return "질문을 입력해주세요.";
  if (!f.answer) return "답변을 입력해주세요.";
  return null;
}

function revalidate() {
  revalidatePath("/admin/faqs");
  revalidatePath("/support/faq");
}

export async function createFaq(_prev: FaqFormState, formData: FormData): Promise<FaqFormState> {
  await requireAdmin();
  const data = parse(formData);
  const err = validate(data);
  if (err) return { error: err };
  await db.faq.create({ data });
  revalidate();
  redirect("/admin/faqs");
}

export async function updateFaq(
  id: string,
  _prev: FaqFormState,
  formData: FormData,
): Promise<FaqFormState> {
  await requireAdmin();
  const data = parse(formData);
  const err = validate(data);
  if (err) return { error: err };
  await db.faq.update({ where: { id }, data });
  revalidate();
  redirect("/admin/faqs");
}

export async function toggleFaqActive(id: string, active: boolean): Promise<void> {
  await requireAdmin();
  await db.faq.update({ where: { id }, data: { active } });
  revalidate();
}

export async function deleteFaq(id: string): Promise<void> {
  await requireAdmin();
  await db.faq.delete({ where: { id } });
  revalidate();
}

/**
 * 기본 FAQ 14개를 DB로 불러온다 (수정 가능하게).
 * 이미 하나라도 있으면 중복 생성을 막기 위해 아무것도 하지 않는다.
 */
export async function seedDefaultFaqs(): Promise<void> {
  await requireAdmin();
  if ((await db.faq.count()) > 0) return;
  await db.faq.createMany({
    data: FAQ_DEFAULTS.map((f, i) => ({
      category: f.category,
      question: f.question,
      answer: f.answer,
      sortOrder: i,
    })),
  });
  revalidate();
}
