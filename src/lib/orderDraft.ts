/**
 * 주문서 작성 전, 장바구니에서 "지금 주문할 수 없는" 품목을 가려내는 순수 함수.
 *
 * 예전 buildOrderDraft 는 이런 품목을 **조용히 걸러내고** 나머지만 주문했다.
 * 손님은 전부 주문된 줄 알고 결제까지 마치는데 실제 주문서에는 일부 품목이
 * 빠져 있다 — 금액도 화면에서 본 것과 달라진다. 소프트오픈 점검(2026-08-27)에서
 * 발견해, 하나라도 걸리면 주문 전체를 멈추고 어떤 품목이 왜 빠지는지 알려주는
 * 방식으로 바꿨다.
 */

export interface DraftBlockCheck {
  status: string;
  priceTiers: { length: number };
}

/** 이 상품을 지금 주문할 수 없는 이유. null 이면 주문 가능 */
export function orderBlockReason(product: DraftBlockCheck): string | null {
  if (product.status !== "ACTIVE") return "판매가 중지된 상품";
  // 티어가 없으면 도매가를 정할 수 없다 — 0원 주문 방지
  if (product.priceTiers.length === 0) return "가격이 설정되지 않은 상품";
  return null;
}

/** 옵션 해석에 필요한 최소 정보 */
export interface OptionLike {
  id: string;
  active: boolean;
}

/**
 * 장바구니가 들고 있는 optionId 를 지금도 쓸 수 있는지.
 *
 * 장바구니는 optionId 를 그대로 보관하는데 그 사이 운영자가 옵션을 지우거나
 * 판매 중지할 수 있다. 예전에는 `options.find(...)` 가 undefined 면 **조용히
 * 기본 상품·기본 가격으로** 주문됐다 — 손님은 "핑크 3만원"을 담았는데 주문서엔
 * 옵션 없이 기본가로 찍히고, 취소 시 되돌릴 옵션 재고 위치도 사라진다.
 * 다른 상품의 optionId 를 폼으로 밀어 넣어도 같은 길로 통과했다.
 * 대체하지 말고 멈춘다 — 값이 틀린 주문보다 안 된 주문이 낫다.
 */
export function optionBlockReason(
  optionId: string | null | undefined,
  options: OptionLike[],
): string | null {
  if (!optionId) return null; // 옵션을 안 고른 상품
  const option = options.find((o) => o.id === optionId);
  // 못 찾음 = 삭제됐거나 다른 상품의 옵션. 둘을 구분할 필요도, 구분할 방법도 없다
  if (!option) return "선택한 옵션이 삭제되었거나 더 이상 이 상품의 옵션이 아님";
  if (!option.active) return "판매가 중지된 옵션";
  return null;
}

export interface BlockedCartItem {
  name: string;
  reason: string;
}

/** 장바구니를 주문 가능/불가로 나눈다. 불가 품목에는 사유를 붙인다. */
export function partitionCart<
  T extends {
    optionId?: string | null;
    product: DraftBlockCheck & { name: string; options: OptionLike[] };
  },
>(cart: T[]): { orderable: T[]; blocked: BlockedCartItem[] } {
  const orderable: T[] = [];
  const blocked: BlockedCartItem[] = [];
  for (const item of cart) {
    // 상품 사유가 먼저다 — 상품이 내려간 마당에 옵션 사유를 보여주면 원인이 흐려진다
    const reason = orderBlockReason(item.product) ?? optionBlockReason(item.optionId, item.product.options);
    if (reason) blocked.push({ name: item.product.name, reason });
    else orderable.push(item);
  }
  return { orderable, blocked };
}

/** 주문을 멈추며 손님에게 보여줄 문구. 빠질 뻔한 품목과 사유를 전부 나열한다. */
export function blockedCartMessage(blocked: BlockedCartItem[]): string {
  const list = blocked.map((b) => `${b.name}(${b.reason})`).join(", ");
  return `다음 품목은 지금 주문할 수 없어 주문을 진행하지 않았습니다: ${list}. 해당 품목을 장바구니에서 빼신 뒤 다시 시도해주세요.`;
}
