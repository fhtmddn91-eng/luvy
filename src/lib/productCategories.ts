/**
 * 상품이 속한 카테고리 집합을 다루는 순수 로직.
 *
 * 규칙 하나: **대표 카테고리는 항상 집합에 포함된다.**
 * 매장 목록은 ProductCategory 만 보고 조회하기 때문에, 대표 카테고리가
 * 빠지면 그 상품이 자기 대표 매대에서 사라진다.
 */

/** 대표 + 추가 선택을 실제로 저장할 목록으로 정규화한다 (중복·빈값 제거) */
export function categorySetFor(primary: string, extras: readonly string[]): string[] {
  const out: string[] = [];
  for (const slug of [primary, ...extras]) {
    const s = slug.trim();
    if (s !== "" && !out.includes(s)) out.push(s);
  }
  return out;
}

/** 존재하지 않는 카테고리는 버린다 — FK 위반으로 저장 전체가 실패하는 것보다 낫다 */
export function keepKnown(slugs: readonly string[], known: readonly string[]): string[] {
  return slugs.filter((s) => known.includes(s));
}
