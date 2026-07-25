/**
 * 카테고리 슬러그 → 이동 경로.
 * "brand"(브랜드관)는 상품 카테고리가 아니라 브랜드 목록 페이지로 보낸다.
 */
export function categoryHref(slug: string): string {
  return slug === "brand" ? "/brands" : `/category/${slug}`;
}
