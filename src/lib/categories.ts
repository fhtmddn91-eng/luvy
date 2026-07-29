import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

/**
 * 카테고리는 DB(Category 테이블)가 원본이다.
 * 코드에 박아두면 관리자가 추가·이름 변경을 못 하기 때문에 이관했다.
 *
 * cache(): 같은 요청 안에서 헤더·본문·푸터가 각자 불러도 쿼리는 한 번만 나간다.
 */
export const getCategories = cache(() =>
  db.category.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
);

/** 어드민용 — 숨긴 카테고리 포함 전체 */
export const getAllCategories = cache(() =>
  db.category.findMany({ orderBy: { sortOrder: "asc" } }),
);

export async function categoryName(slug: string): Promise<string> {
  const all = await getAllCategories();
  return all.find((c) => c.slug === slug)?.name ?? slug;
}
