/**
 * 재고 판정 순수 로직.
 * DB/서버 의존이 없어 단위 테스트로 고정한다. (차감·복원은 stockOps.ts)
 */

/** 재고가 이 수량 이하로 떨어지면 "부족"으로 표시해 발주를 유도한다 */
export const LOW_STOCK_THRESHOLD = 10;

export interface StockInfo {
  trackStock: boolean;
  stock: number;
}

export type StockState = "unlimited" | "in_stock" | "low" | "sold_out";

export function stockState(p: StockInfo): StockState {
  if (!p.trackStock) return "unlimited";
  if (p.stock <= 0) return "sold_out";
  return p.stock <= LOW_STOCK_THRESHOLD ? "low" : "in_stock";
}

export function isSoldOut(p: StockInfo): boolean {
  return stockState(p) === "sold_out";
}

/**
 * 주문 가능한 최대 수량. 재고 미추적이면 상한(cap)까지 허용한다.
 * 반환값이 moq 보다 작으면 사실상 주문 불가(재고가 MOQ 미만).
 */
export function maxOrderable(p: StockInfo, cap: number): number {
  return p.trackStock ? Math.min(cap, Math.max(0, p.stock)) : cap;
}

/**
 * 수량을 MOQ 하한과 재고 상한 사이로 조정.
 * 재고가 MOQ 미만이면 재고만큼만 허용한다(0이면 0 → 주문 불가).
 */
export function clampToStock(
  quantity: number,
  moq: number,
  p: StockInfo,
  cap = 100_000,
): number {
  const desired = Math.floor(quantity) || moq;
  const max = maxOrderable(p, cap);
  if (max <= 0) return 0;
  return Math.min(max, Math.max(Math.min(moq, max), desired));
}

/** 재고보다 많이 담긴 장바구니 항목을 찾아낸다 (결제 직전 검증용) */
export function findStockShortages<
  T extends { quantity: number; product: StockInfo & { name: string } },
>(items: T[]): { name: string; requested: number; available: number }[] {
  return items
    .filter((it) => it.product.trackStock && it.quantity > it.product.stock)
    .map((it) => ({
      name: it.product.name,
      requested: it.quantity,
      available: Math.max(0, it.product.stock),
    }));
}

export function stockLabel(p: StockInfo): string {
  switch (stockState(p)) {
    case "unlimited":
      return "무제한";
    case "sold_out":
      return "품절";
    case "low":
      return `${p.stock}개 (부족)`;
    default:
      return `${p.stock}개`;
  }
}
