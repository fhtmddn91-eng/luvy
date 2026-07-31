import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

export interface CategoryRow {
  slug: string;
  name: string;
  icon: string;
  sortOrder: number;
  active: boolean;
  parentSlug: string | null;
}

/** 대분류 + 그 아래 세부 카테고리 */
export interface CategoryNode extends CategoryRow {
  children: CategoryRow[];
}

/**
 * 카테고리는 DB(Category 테이블)가 원본이다.
 * 코드에 박아두면 관리자가 추가·이름 변경을 못 하기 때문에 이관했다.
 *
 * cache(): 같은 요청 안에서 헤더·본문·푸터가 각자 불러도 쿼리는 한 번만 나간다.
 */
export const getCategories = cache(
  (): Promise<CategoryRow[]> =>
    db.category.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
);

/** 어드민용 — 숨긴 카테고리 포함 전체 */
export const getAllCategories = cache(
  (): Promise<CategoryRow[]> => db.category.findMany({ orderBy: { sortOrder: "asc" } }),
);

/**
 * 대분류만. 헤더 카테고리 줄은 여기만 쓴다 —
 * 세부 카테고리까지 한 줄에 늘어놓으면 모바일에서 다시 잘린다.
 */
export async function getTopCategories(): Promise<CategoryRow[]> {
  return (await getCategories()).filter((c) => c.parentSlug === null);
}

/** 평평한 목록을 대분류 → 세부 2단으로 접는다 */
export function toTree(rows: CategoryRow[]): CategoryNode[] {
  const byParent = new Map<string, CategoryRow[]>();
  for (const r of rows) {
    if (r.parentSlug === null) continue;
    const list = byParent.get(r.parentSlug);
    if (list) list.push(r);
    else byParent.set(r.parentSlug, [r]);
  }
  return rows
    .filter((r) => r.parentSlug === null)
    .map((r) => ({ ...r, children: byParent.get(r.slug) ?? [] }));
}

/** 매장용 트리 (표시 중인 것만) */
export async function getCategoryTree(): Promise<CategoryNode[]> {
  return toTree(await getCategories());
}

/** 어드민용 트리 (숨김 포함) */
export async function getAdminCategoryTree(): Promise<CategoryNode[]> {
  return toTree(await getAllCategories());
}

/**
 * 이 카테고리 페이지에 담아야 할 slug 목록.
 * 대분류를 열면 그 아래 세부 카테고리 상품까지 전부 보여야 한다 —
 * 안 그러면 세부 카테고리를 만드는 순간 대분류가 텅 빈다.
 */
export async function selfAndDescendantSlugs(slug: string): Promise<string[]> {
  const all = await getCategories();
  return [slug, ...all.filter((c) => c.parentSlug === slug).map((c) => c.slug)];
}

export async function categoryName(slug: string): Promise<string> {
  const all = await getAllCategories();
  return all.find((c) => c.slug === slug)?.name ?? slug;
}

/** "남성용품 › 오나홀" 처럼 상위를 붙인 이름 (관리자 목록·선택 상자용) */
export async function categoryPath(slug: string): Promise<string> {
  const all = await getAllCategories();
  const self = all.find((c) => c.slug === slug);
  if (!self) return slug;
  if (self.parentSlug === null) return self.name;
  const parent = all.find((c) => c.slug === self.parentSlug);
  return parent ? `${parent.name} › ${self.name}` : self.name;
}
