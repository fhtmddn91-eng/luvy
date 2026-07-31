"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type CategoryFormState = { error?: string; ok?: boolean };

/** 스토어 전역이 카테고리를 쓰므로 레이아웃째로 갱신한다 */
function revalidateCategories(): void {
  revalidatePath("/", "layout");
  revalidatePath("/admin/categories");
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * 카테고리 추가. slug 는 URL(/category/{slug})에 그대로 들어가므로
 * 소문자 영숫자와 하이픈만 허용한다.
 *
 * parentSlug 가 있으면 그 대분류 아래의 세부 카테고리가 된다.
 */
export async function createCategory(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  await requireAdmin();

  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const parentSlug = String(formData.get("parentSlug") ?? "").trim() || null;

  if (!name) return { error: "카테고리 이름을 입력해주세요." };
  if (!SLUG_RE.test(slug)) {
    return { error: "주소(slug)는 소문자 영문·숫자·하이픈만 쓸 수 있습니다. 예) costume" };
  }
  if (await db.category.findUnique({ where: { slug } })) {
    return { error: `이미 있는 주소입니다: ${slug}` };
  }

  if (parentSlug !== null) {
    const parent = await db.category.findUnique({ where: { slug: parentSlug } });
    if (!parent) return { error: "상위 카테고리를 찾을 수 없습니다." };
    // 2단까지만. 세부 카테고리 아래에 또 만들면 매장 화면이 감당이 안 된다.
    if (parent.parentSlug !== null) {
      return { error: `${parent.name} 은(는) 이미 세부 카테고리입니다. 세부 카테고리 아래에는 더 만들 수 없습니다.` };
    }
  }

  // 정렬은 형제(같은 상위) 안에서만 의미가 있다
  const last = await db.category.aggregate({
    where: { parentSlug },
    _max: { sortOrder: true },
  });
  await db.category.create({
    data: {
      slug,
      name: name.slice(0, 30),
      parentSlug,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
    },
  });

  await audit({
    action: "CATEGORY_CREATE",
    target: "category",
    targetId: slug,
    summary: parentSlug ? `세부 카테고리 ${name} 추가 (상위 ${parentSlug})` : `카테고리 ${name} 추가`,
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
  const active = !cat.active;

  // 대분류를 숨기면 그 아래 세부 카테고리도 같이 숨긴다.
  // 안 그러면 상위가 사라진 세부 카테고리만 헤더 없이 떠 있게 된다.
  await db.$transaction([
    db.category.update({ where: { slug }, data: { active } }),
    ...(cat.parentSlug === null
      ? [db.category.updateMany({ where: { parentSlug: slug }, data: { active } })]
      : []),
  ]);
  revalidateCategories();
}

/** 위/아래 한 칸 이동 — 같은 상위를 가진 형제끼리만 자리를 맞바꾼다 */
export async function moveCategory(slug: string, dir: "up" | "down"): Promise<void> {
  await requireAdmin();
  const self = await db.category.findUnique({ where: { slug } });
  if (!self) return;

  const siblings = await db.category.findMany({
    where: { parentSlug: self.parentSlug },
    orderBy: { sortOrder: "asc" },
  });
  const i = siblings.findIndex((c) => c.slug === slug);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= siblings.length) return;

  await db.$transaction([
    db.category.update({ where: { slug: siblings[i].slug }, data: { sortOrder: siblings[j].sortOrder } }),
    db.category.update({ where: { slug: siblings[j].slug }, data: { sortOrder: siblings[i].sortOrder } }),
  ]);
  revalidateCategories();
}

/**
 * 삭제는 상품이 하나도 없을 때만. 상품이 있는 카테고리를 지우면
 * 그 상품들이 어느 목록에도 안 잡히는 고아가 된다 — 숨김을 쓰라고 안내한다.
 * 세부 카테고리가 남아 있는 대분류도 먼저 정리하게 막는다.
 */
export async function deleteCategory(slug: string): Promise<void> {
  await requireAdmin();
  const [primary, linked, children] = await Promise.all([
    db.product.count({ where: { categorySlug: slug } }),
    db.productCategory.count({ where: { categorySlug: slug } }),
    db.category.count({ where: { parentSlug: slug } }),
  ]);
  if (primary > 0 || linked > 0 || children > 0) return;

  const cat = await db.category.findUnique({ where: { slug }, select: { name: true } });
  await db.category.delete({ where: { slug } });
  await audit({
    action: "CATEGORY_DELETE",
    target: "category",
    targetId: slug,
    summary: `카테고리 ${cat?.name ?? slug} 삭제`,
  });
  revalidateCategories();
}
