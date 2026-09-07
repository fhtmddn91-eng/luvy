import { parseRatePercent, formatRatePercent } from "@/lib/points";

/**
 * 등급·회원별 할인율 (2026-09-08) — 순수 함수.
 *
 * 적립률(points.ts)과 같은 **만분율**(100 = 1%)로 저장한다. 소수 % 를 부동소수로
 * 들고 다니면 큰 금액에서 원 단위가 흔들려 청구액과 주문서가 어긋난다.
 * 정수로 곱하고 마지막에 한 번만 나눈다.
 *
 * 할인율은 두 군데에 있다:
 *  - `MemberGrade.discountBp` — 등급 기본값 (실버 3% / 골드 5% 식)
 *  - `User.discountBp` — 그 거래처만의 값. **null 이면 등급을 따른다**
 *
 * null 과 0 을 구분하는 이유: 0 을 "안 정함"으로 취급하면 골드 거래처에서
 * 할인만 빼는 지정이 불가능해진다. 도매는 "이 거래처는 특별가"가 반드시 생긴다.
 */

/**
 * 할인율 상한 90%.
 *
 * 실수 방지선이다. 5% 를 넣으려다 % 칸에 '500' 을 치면 곧바로 0원 주문이 나간다.
 * 폼과 서버 양쪽에서 이 값으로 자른다 — 싼 단계에서 막아 비싼 단계를 살린다.
 */
export const MAX_DISCOUNT_BP = 9_000;

/** 0 ~ 상한 사이의 정수로 정리. 음수·NaN 은 0 (할인이 할증이 되면 안 된다) */
function clampBp(bp: number): number {
  if (!Number.isFinite(bp) || bp <= 0) return 0;
  return Math.min(Math.floor(bp), MAX_DISCOUNT_BP);
}

/**
 * 이 회원에게 실제로 적용할 할인율.
 * 개별 지정이 있으면 그것이 이기고, 없으면(null/undefined) 등급 기본값.
 */
export function effectiveDiscountBp(
  userBp: number | null | undefined,
  gradeBp: number,
): number {
  return clampBp(userBp ?? gradeBp);
}

/**
 * 정가 → 할인가. 원 미만 버림(손님에게 유리한 쪽).
 *
 * 정가 0원은 "아직 단가를 안 정한 수집 상품"이라는 뜻이라(pricing.hasPrice)
 * 그대로 0원으로 남긴다. 반대로 값이 있는 상품은 할인 때문에 0원이 되면
 * 안 되므로 바닥이 1원이다.
 */
export function discountedPrice(listPrice: number, discountBp: number): number {
  if (!Number.isFinite(listPrice) || listPrice <= 0) return 0;
  const bp = clampBp(discountBp);
  if (bp === 0) return Math.floor(listPrice);
  const discounted = Math.floor((listPrice * (10_000 - bp)) / 10_000);
  return Math.max(1, discounted);
}

/**
 * 관리자 폼의 % 입력 → 만분율. 상한을 넘거나 형식이 틀리면 null.
 * 자릿수 검사는 적립률과 같은 규칙을 쓴다(points.parseRatePercent).
 */
export function parseDiscountPercent(raw: string): number | null {
  const bp = parseRatePercent(raw);
  if (bp === null || bp > MAX_DISCOUNT_BP) return null;
  return bp;
}

/** 만분율 → 화면 % ("5", "2.5") */
export function formatDiscountPercent(discountBp: number): string {
  return formatRatePercent(clampBp(discountBp));
}

/**
 * 이미 저장된 주문 품목에서 할인으로 깎인 금액 합계.
 *
 * 할인 도입 전 주문은 `listPrice` 가 0 이다(컬럼 기본값). 그걸 정가로 읽으면
 * 옛 주문마다 음수 할인이 찍히므로, **정가가 실제 청구가보다 클 때만** 센다.
 */
export function orderDiscountAmount(
  items: { listPrice: number; unitPrice: number; quantity: number }[],
): number {
  return items.reduce(
    (sum, i) => sum + (i.listPrice > i.unitPrice ? (i.listPrice - i.unitPrice) * i.quantity : 0),
    0,
  );
}

/** 화면 배지 문구. 할인이 없으면 빈 문자열 — 빈 배지를 그리지 않게 */
export function discountLabel(discountBp: number): string {
  const bp = clampBp(discountBp);
  return bp > 0 ? `${formatRatePercent(bp)}% 할인` : "";
}
