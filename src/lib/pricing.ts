export type Tier = { minQty: number; unitPrice: number };

export const SHIPPING_FEE = 3000;
export const FREE_SHIPPING_THRESHOLD = 100_000;

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

export function shippingFor(subtotal: number): number {
  if (subtotal <= 0) return 0;
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
}
