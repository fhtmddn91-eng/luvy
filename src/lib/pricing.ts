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

export function shippingFor(
  subtotal: number,
  policy: ShippingPolicy = { fee: SHIPPING_FEE, freeThreshold: FREE_SHIPPING_THRESHOLD },
): number {
  if (subtotal <= 0) return 0;
  return subtotal >= policy.freeThreshold ? 0 : policy.fee;
}
