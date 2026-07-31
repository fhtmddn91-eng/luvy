"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { saveImageUpload, deleteImageUpload } from "@/lib/storage";

export type BannerFormState = { error?: string };

/**
 * 배경 이미지 한 칸을 처리한다.
 * - 새 파일이 오면 저장하고 새 경로를 반환
 * - "제거" 체크면 빈 문자열(= 기본 이미지로 되돌림)
 * - 둘 다 아니면 undefined (기존 값 유지)
 */
async function handleBannerImage(
  formData: FormData,
  fileField: string,
  clearField: string,
): Promise<{ value?: string } | { error: string }> {
  if (formData.get(clearField) === "on") return { value: "" };
  const file = formData.get(fileField);
  if (!(file instanceof File) || file.size === 0) return {};
  const saved = await saveImageUpload(file);
  if (!saved.ok) return { error: saved.error };
  return { value: saved.url };
}

/** 업로드 경로만 지운다 — public/hero 의 기본 이미지를 건드리면 안 된다 */
async function cleanupIfUpload(url: string | null | undefined): Promise<void> {
  if (url && url.startsWith("/uploads/")) await deleteImageUpload(url);
}

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

  const desktop = await handleBannerImage(formData, "imageFile", "imageClear");
  if ("error" in desktop) return { error: desktop.error };
  const mobile = await handleBannerImage(formData, "imageMobileFile", "imageMobileClear");
  if ("error" in mobile) return { error: mobile.error };

  await db.banner.create({
    data: { ...data, image: desktop.value ?? "", imageMobile: mobile.value ?? "" },
  });
  revalidate();
  redirect("/admin/banners");
}

export async function updateBanner(id: string, _prev: BannerFormState, formData: FormData): Promise<BannerFormState> {
  await requireAdmin();
  const data = parse(formData);
  const err = validate(data);
  if (err) return { error: err };

  const desktop = await handleBannerImage(formData, "imageFile", "imageClear");
  if ("error" in desktop) return { error: desktop.error };
  const mobile = await handleBannerImage(formData, "imageMobileFile", "imageMobileClear");
  if ("error" in mobile) return { error: mobile.error };

  // 교체·제거된 예전 업로드 파일은 지운다 (안 그러면 디스크에 고아 파일이 쌓인다)
  const prev = await db.banner.findUnique({
    where: { id },
    select: { image: true, imageMobile: true },
  });
  if (desktop.value !== undefined && prev?.image !== desktop.value) {
    await cleanupIfUpload(prev?.image);
  }
  if (mobile.value !== undefined && prev?.imageMobile !== mobile.value) {
    await cleanupIfUpload(prev?.imageMobile);
  }

  await db.banner.update({
    where: { id },
    data: {
      ...data,
      ...(desktop.value !== undefined ? { image: desktop.value } : {}),
      ...(mobile.value !== undefined ? { imageMobile: mobile.value } : {}),
    },
  });
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
  const prev = await db.banner.findUnique({
    where: { id },
    select: { image: true, imageMobile: true },
  });
  await db.banner.delete({ where: { id } });
  await cleanupIfUpload(prev?.image);
  await cleanupIfUpload(prev?.imageMobile);
  revalidate();
}
