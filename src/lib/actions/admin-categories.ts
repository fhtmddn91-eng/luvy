"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export type CategoryFormState = { error?: string; ok?: boolean };

/** 스토어 전역이 카테고리를 쓰므로 레이아웃째로 갱신한다 */
function revalidateCategories(): void {
  revalidatePath("/", "layout");
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * 카테고리 추가. slug 는 URL(/category/{slug})에 그대로 들어가므로
 * 소문자 영숫자와 하이픈만 허용한다.
 */
export async function createCategory(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  await requireAdmin();

  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();

  if (!name) return { error: "카테고리 이름을 입력해주세요." };
  if (!SLUG_RE.test(slug)) {
    return { error: "주소(slug)는 소문자 영문·숫자·하이픈만 쓸 수 있습니다. 예) costume" };
  }
  if (await db.category.findUnique({ where: { slug } })) {
    return { error: `이미 있는 주소입니다: ${slug}` };
  }

  const last = await db.category.aggregate({ _max: { sortOrder: true } });
  await db.category.create({
    data: { slug, name: name.slice(0, 30), sortOrder: (last._max.sortOrder ?? -1) + 1 },
  });

  revalidateCategories();
  return { ok: true };
}

export async function renameCategory(slug: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 30);
  if (!name) return;
  await db.category.update({ where: { slug }, data: { name } });
  revalidateCategories();
}

export async function toggleCategoryActive(slug: string): Promise<void> {
  await requireAdmin();
  const cat = await db.category.findUnique({ where: { slug } });
  if (!cat) return;
  await db.category.update({ where: { slug }, data: { active: !cat.active } });
  revalidateCategories();
}

/** 위/아래 한 칸 이동 — 이웃과 sortOrder 를 맞바꾼다 */
export async function moveCategory(slug: string, dir: "up" | "down"): Promise<void> {
  await requireAdmin();
  const all = await db.category.findMany({ orderBy: { sortOrder: "asc" } });
  const i = all.findIndex((c) => c.slug === slug);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return;

  await db.$transaction([
    db.category.update({ where: { slug: all[i].slug }, data: { sortOrder: all[j].sortOrder } }),
    db.category.update({ where: { slug: all[j].slug }, data: { sortOrder: all[i].sortOrder } }),
  ]);
  revalidateCategories();
}

/**
 * 삭제는 상품이 하나도 없을 때만. 상품이 있는 카테고리를 지우면
 * 그 상품들이 어느 목록에도 안 잡히는 고아가 된다 — 숨김을 쓰라고 안내한다.
 */
export async function deleteCategory(slug: string): Promise<void> {
  await requireAdmin();
  const count = await db.product.count({ where: { categorySlug: slug } });
  if (count > 0) return;
  await db.category.delete({ where: { slug } });
  revalidateCategories();
}
