import { resolveUnitPrice, type Tier } from "@/lib/pricing";

/**
 * 상품 옵션 계산 (순수 함수 — 서버·클라이언트·테스트에서 같이 쓴다).
 *
 * 옵션은 "있으면 그쪽 값이 이긴다"가 원칙이다.
 *  - unitPrice 가 0 이면 안 정한 것 → 상품의 수량별 도매가를 그대로 쓴다
 *  - 재고도 옵션이 추적하면 옵션 재고가, 아니면 상품 재고가 상한이 된다
 */
export interface OptionLite {
  id: string;
  name: string;
  unitPrice: number;
  trackStock: boolean;
  stock: number;
  active: boolean;
}

export interface StockLike {
  trackStock: boolean;
  stock: number;
}

/** 화면에 보여줄 옵션만 (숨긴 옵션 제외) */
export function sellableOptions<T extends { active: boolean }>(options: T[]): T[] {
  return options.filter((o) => o.active);
}

/** 이 옵션·수량의 개당 단가 */
export function optionUnitPrice(
  option: Pick<OptionLite, "unitPrice"> | null | undefined,
  tiers: Tier[],
  quantity: number,
): number {
  if (option && option.unitPrice > 0) return option.unitPrice;
  return resolveUnitPrice(tiers, quantity);
}

/** 이 옵션으로 주문할 수 있는 최대 수량 */
export function optionMaxQty(
  option: Pick<OptionLite, "trackStock" | "stock"> | null | undefined,
  product: StockLike,
  cap: number,
): number {
  if (option?.trackStock) return Math.max(0, Math.min(option.stock, cap));
  if (product.trackStock) return Math.max(0, Math.min(product.stock, cap));
  return cap;
}

/** 품절 여부 — 옵션이 재고를 추적하면 옵션 기준 */
export function isOptionSoldOut(
  option: Pick<OptionLite, "trackStock" | "stock"> | null | undefined,
  product: StockLike,
): boolean {
  if (option?.trackStock) return option.stock <= 0;
  return product.trackStock && product.stock <= 0;
}

/**
 * 옵션이 하나라도 팔 수 있으면 상품은 판매 가능.
 * 옵션이 없는 상품은 상품 재고로 판단한다.
 */
export function anyOptionAvailable(
  options: Pick<OptionLite, "trackStock" | "stock" | "active">[],
  product: StockLike,
): boolean {
  const live = options.filter((o) => o.active);
  if (live.length === 0) return !(product.trackStock && product.stock <= 0);
  return live.some((o) => !isOptionSoldOut(o, product));
}
