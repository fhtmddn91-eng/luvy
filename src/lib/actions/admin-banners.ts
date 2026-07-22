"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export type BannerFormState = { error?: string };

function parse(formData: FormData) {
  return {
    eyebrow: String(formData.get("eyebrow") ?? "").trim(),
    title: String(formData.get("title") ?? "").trim(),
    subtitle: String(formData.get("subtitle") ?? "").trim(),
    primaryLabel: String(formData.get("primaryLabel") ?? "").trim(),
    primaryHref: String(formData.get("primaryHref") ?? "").trim() || "/",
    secondaryLabel: String(formData.get("secondaryLabel") ?? "").trim(),
    secondaryHref: String(formData.get("secondaryHref") ?? "").trim() || "/",
    sortOrder: parseInt(String(formData.get("sortOrder") ?? "0"), 10) || 0,
    active: formData.get("active") === "on",
  };
}

function validate(f: ReturnType<typeof parse>): string | null {
  if (!f.eyebrow) return "상단 라벨(eyebrow)을 입력해주세요.";
  if (!f.title) return "제목을 입력해주세요.";
  if (!f.primaryLabel) return "기본 버튼 문구를 입력해주세요.";
  return null;
}

function revalidate() {
  revalidatePath("/admin/banners");
  revalidatePath("/", "layout");
}

export async function createBanner(_prev: BannerFormState, formData: FormData): Promise<BannerFormState> {
  await requireAdmin();
  const data = parse(formData);
  const err = validate(data);
  if (err) return { error: err };
  await db.banner.create({ data });
  revalidate();
  redirect("/admin/banners");
}

export async function updateBanner(id: string, _prev: BannerFormState, formData: FormData): Promise<BannerFormState> {
  await requireAdmin();
  const data = parse(formData);
  const err = validate(data);
  if (err) return { error: err };
  await db.banner.update({ where: { id }, data });
  revalidate();
  redirect("/admin/banners");
}

export async function toggleBannerActive(id: string, active: boolean): Promise<void> {
  await requireAdmin();
  await db.banner.update({ where: { id }, data: { active } });
  revalidate();
}

export async function deleteBanner(id: string): Promise<void> {
  await requireAdmin();
  await db.banner.delete({ where: { id } });
  revalidate();
}
