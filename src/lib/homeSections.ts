/**
 * 메인 상품 탭의 선택 규칙 — 순수 모듈.
 *
 * 자동 탭(인기·재구매)은 주문 데이터에서 계산한다. 그런데 오픈 직후에는
 * 주문이 0건이라 그대로 두면 탭 4개 중 2~3개가 빈 채로 뜬다.
 * 그래서 모자란 자리는 신상품으로 메꾼다 — 빈 탭보다는 낫다.
 */

export const HOME_MODES = {
  AUTO_NEW: "신상품 (등록일순)",
  AUTO_POPULAR: "인기 (판매수량순)",
  AUTO_REPEAT: "재구매 높은 (재구매 회원수순)",
  MANUAL: "직접 고르기",
} as const;

export type HomeMode = keyof typeof HOME_MODES;

export const isHomeMode = (v: string): v is HomeMode =>
  Object.prototype.hasOwnProperty.call(HOME_MODES, v);

export const homeModeLabel = (mode: string): string =>
  (HOME_MODES as Record<string, string>)[mode] ?? mode;

/** 탭 하나에 채울 상품 수 */
export const HOME_TAB_SIZE = 8;

/**
 * 규칙으로 뽑은 순서(ranked)를 우선 쓰고, 모자라면 fallback 으로 채운다.
 * 두 목록에 같은 상품이 있어도 한 번만 들어간다.
 */
export function fillTab<T extends { id: string }>(
  ranked: readonly T[],
  fallback: readonly T[],
  size: number = HOME_TAB_SIZE,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const p of [...ranked, ...fallback]) {
    if (out.length >= size) break;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * 판매 집계(상품별 수치)를 큰 순서로 정렬해 상품 id 목록으로 만든다.
 * 동점이면 id 순으로 고정한다 — 새로고침마다 순서가 흔들리면 안 된다.
 */
export function rankIds(rows: readonly { productId: string; value: number }[]): string[] {
  return [...rows]
    .filter((r) => r.value > 0)
    .sort((a, b) => (b.value - a.value) || a.productId.localeCompare(b.productId))
    .map((r) => r.productId);
}

/** id 목록 순서대로 상품을 늘어놓는다 (조회 결과는 순서가 보장되지 않는다) */
export function orderByIds<T extends { id: string }>(products: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is T => p !== undefined);
}

/** 기본 4탭 — 관리자가 아직 설정하지 않았을 때 쓴다 */
export const DEFAULT_SECTIONS: { label: string; mode: HomeMode }[] = [
  { label: "HOT", mode: "AUTO_POPULAR" },
  { label: "이번주 추천", mode: "MANUAL" },
  { label: "입문 추천", mode: "MANUAL" },
  { label: "재구매 높은", mode: "AUTO_REPEAT" },
];
