import "server-only";
import { db } from "@/lib/db";
import { shippingFor, type Tier } from "@/lib/pricing";
import { optionUnitPrice } from "@/lib/options";
import { getShippingPolicy } from "@/lib/settings";
import { partitionCart, blockedCartMessage } from "@/lib/orderDraft";
import { getMemberDiscountBp } from "@/lib/memberDiscount";
import { discountedPrice } from "@/lib/discount";

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
    /** 실제 청구 단가 (할인 적용 후) */
    unitPrice: number;
    /** 할인 전 정가. 할인이 없으면 unitPrice 와 같다 */
    listPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  subtotal: number;
  shippingFee: number;
  total: number;
  orderName: string;
  /** 이 주문에 적용된 할인율(만분율). 주문에 스냅샷으로 남긴다 */
  discountBp: number;
  /** 할인으로 깎인 금액 합계 — 주문서에 "회원 할인 −N원"으로 보여준다 */
  discountAmount: number;
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

  /*
   * 할인율은 여기서 **직접** 읽는다 — 호출자가 넘기게 두면 한 경로(무통장/카드/
   * 재주문)가 빠뜨렸을 때 그 경로만 정가로 청구된다. 주문서가 금액의 진실이므로
   * 진실을 만드는 자리에서 조회한다. 장바구니에 담은 뒤 등급이 바뀌었어도
   * **주문 시점 값**이 적용된다.
   */
  const discountBp = await getMemberDiscountBp(userId);

  const items = orderable.map((it) => {
    const option = it.optionId ? it.product.options.find((o) => o.id === it.optionId) : undefined;
    const listPrice = optionUnitPrice(option, it.product.priceTiers as Tier[], it.quantity);
    const unitPrice = discountedPrice(listPrice, discountBp);
    return {
      productId: it.productId,
      name: it.product.name,
      brand: it.product.brand,
      sku: it.product.sku ?? "",
      optionName: option?.name ?? "",
      optionId: option?.id ?? "",
      unitPrice,
      listPrice,
      quantity: it.quantity,
      lineTotal: unitPrice * it.quantity,
    };
  });

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const discountAmount = items.reduce((sum, i) => sum + (i.listPrice - i.unitPrice) * i.quantity, 0);
  /*
   * 무료배송 판정은 **할인 후** 금액으로 한다(2026-09-08 결정). 실제로 받은 돈이
   * 기준이라 회계와 어긋나지 않는다 — 정가로 재면 할인율을 올릴수록 배송비가 샌다.
   * 포인트 적립도 subtotal 을 보므로 같은 기준이 자동으로 따라온다.
   */
  const shippingFee = shippingFor(subtotal, await getShippingPolicy());
  const orderName =
    items.length === 1 ? items[0].name : `${items[0].name} 외 ${items.length - 1}건`;

  return {
    ok: true,
    draft: {
      items,
      subtotal,
      shippingFee,
      total: subtotal + shippingFee,
      orderName,
      discountBp,
      discountAmount,
    },
  };
}
