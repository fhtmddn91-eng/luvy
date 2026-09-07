import "server-only";
import { db } from "@/lib/db";
import { shippingFor, type Tier } from "@/lib/pricing";
import { optionUnitPrice } from "@/lib/options";
import { getShippingPolicy } from "@/lib/settings";
import { partitionCart, blockedCartMessage } from "@/lib/orderDraft";

export interface OrderDraft {
  items: {
    productId: string;
    name: string;
    brand: string;
    /** 주문 시점 품번 스냅샷. 안 쓰는 상품은 빈 문자열 */
    sku: string;
    /** 주문 시점 옵션명 스냅샷. 옵션 없는 상품은 빈 문자열 */
    optionName: string;
    /** 취소 시 재고를 되돌릴 곳 — 주문서에도 함께 남긴다 */
    optionId: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  subtotal: number;
  shippingFee: number;
  total: number;
  orderName: string;
}

export type OrderDraftResult =
  | { ok: true; draft: OrderDraft }
  | { ok: false; error: string };

/**
 * 사용자 장바구니로부터 주문 스냅샷/금액을 계산.
 *
 * 주문 불가 품목(비활성·가격 미설정)이 하나라도 있으면 **주문 전체를 멈춘다**.
 * 예전엔 그런 품목을 조용히 빼고 나머지만 주문해서, 손님이 본 장바구니와
 * 실제 주문서의 품목·금액이 달라졌다(orderDraft.ts 참고).
 */
export async function buildOrderDraft(userId: string): Promise<OrderDraftResult> {
  const cart = await db.cartItem.findMany({
    where: { userId },
    include: { product: { include: { priceTiers: true, options: true } } },
  });
  if (cart.length === 0) return { ok: false, error: "장바구니가 비어 있습니다." };

  const { orderable, blocked } = partitionCart(cart);
  if (blocked.length > 0) return { ok: false, error: blockedCartMessage(blocked) };

  const items = orderable.map((it) => {
    const option = it.optionId ? it.product.options.find((o) => o.id === it.optionId) : undefined;
    const unitPrice = optionUnitPrice(option, it.product.priceTiers as Tier[], it.quantity);
    return {
      productId: it.productId,
      name: it.product.name,
      brand: it.product.brand,
      sku: it.product.sku ?? "",
      optionName: option?.name ?? "",
      optionId: option?.id ?? "",
      unitPrice,
      quantity: it.quantity,
      lineTotal: unitPrice * it.quantity,
    };
  });

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const shippingFee = shippingFor(subtotal, await getShippingPolicy());
  const orderName =
    items.length === 1 ? items[0].name : `${items[0].name} 외 ${items.length - 1}건`;

  return {
    ok: true,
    draft: { items, subtotal, shippingFee, total: subtotal + shippingFee, orderName },
  };
}
