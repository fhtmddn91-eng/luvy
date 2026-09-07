import { discountedPrice } from "@/lib/discount";

export type Tier = { minQty: number; unitPrice: number };

/** 배송비 기본값 — 실제 적용값은 어드민 설정(Setting 테이블)이 우선한다 (lib/settings.ts) */
export const SHIPPING_FEE = 3000;
export const FREE_SHIPPING_THRESHOLD = 100_000;

export interface ShippingPolicy {
  fee: number;
  /** 이 금액 이상이면 무료. 0이면 항상 무료 */
  freeThreshold: number;
}

/** 오름차순 정렬 사본. */
function sorted(tiers: Tier[]): Tier[] {
  return [...tiers].sort((a, b) => a.minQty - b.minQty);
}

/**
 * 판매 가능한 가격이 정해졌는지.
 *
 * 1688 수집 상품은 단가 0원으로 들어온다(마진율을 운영자가 정해야 한다).
 * 그대로 두면 화면에 "0원"이 뜨고, 더 나쁘게는 0원 주문이 들어온다.
 */
export function hasPrice(tiers: Tier[]): boolean {
  return tiers.some((t) => t.unitPrice > 0);
}

export function getMoq(tiers: Tier[]): number {
  if (tiers.length === 0) return 1;
  return sorted(tiers)[0].minQty;
}

/** minQty <= qty 인 티어 중 가장 큰 minQty의 단가. 없으면 최저 티어 단가. */
export function resolveUnitPrice(tiers: Tier[], qty: number): number {
  const s = sorted(tiers);
  let price = s[0]?.unitPrice ?? 0;
  for (const t of s) {
    if (qty >= t.minQty) price = t.unitPrice;
  }
  return price;
}

/**
 * 이 회원이 실제로 낼 개당 단가 = 수량별 정가에 할인율을 먹인 값.
 *
 * `resolveUnitPrice` 는 **정가**로 남겨 둔다 — 화면에서 취소선(정가)과 회원가를
 * 나란히 보여주려면 둘 다 필요하기 때문이다.
 *
 * `discountBp` 에 기본값을 두지 않는 것은 일부러다. 기본값이 있으면 새로 만든
 * 화면이 할인을 빼먹어도 **조용히 정가로 팔린다**. 필수 인자면 타입이 잡는다.
 */
export function memberUnitPrice(tiers: Tier[], qty: number, discountBp: number): number {
  return discountedPrice(resolveUnitPrice(tiers, qty), discountBp);
}

export function shippingFor(
  subtotal: number,
  policy: ShippingPolicy = { fee: SHIPPING_FEE, freeThreshold: FREE_SHIPPING_THRESHOLD },
): number {
  if (subtotal <= 0) return 0;
  return subtotal >= policy.freeThreshold ? 0 : policy.fee;
}
