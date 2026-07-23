import "server-only";
import { db } from "@/lib/db";
import { resolveUnitPrice, shippingFor, type Tier } from "@/lib/pricing";
import { fetchPortOnePayment } from "@/lib/portone";

export interface OrderDraft {
  items: {
    productId: string;
    name: string;
    brand: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  subtotal: number;
  shippingFee: number;
  total: number;
  orderName: string;
}

/** 사용자 장바구니로부터 주문 스냅샷/금액을 계산. 비어있으면 null. */
export async function buildOrderDraft(userId: string): Promise<OrderDraft | null> {
  const cart = await db.cartItem.findMany({
    where: { userId },
    include: { product: { include: { priceTiers: true } } },
  });
  // 주문 가능한 항목만: 판매중(ACTIVE)이고 도매가 티어가 하나 이상 있어야 함.
  // (비활성/티어 없는 상품이 0원으로 주문되는 것을 방지)
  const orderable = cart.filter(
    (it) => it.product.status === "ACTIVE" && it.product.priceTiers.length > 0,
  );
  if (orderable.length === 0) return null;

  const items = orderable.map((it) => {
    const unitPrice = resolveUnitPrice(it.product.priceTiers as Tier[], it.quantity);
    return {
      productId: it.productId,
      name: it.product.name,
      brand: it.product.brand,
      unitPrice,
      quantity: it.quantity,
      lineTotal: unitPrice * it.quantity,
    };
  });

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const shippingFee = shippingFor(subtotal);
  const orderName =
    items.length === 1 ? items[0].name : `${items[0].name} 외 ${items.length - 1}건`;

  return { items, subtotal, shippingFee, total: subtotal + shippingFee, orderName };
}

export type FinalizeResult =
  | { ok: true; orderId: string }
  | { ok: false; reason: string; orderId?: string };

/**
 * 결제창 완료 후 서버 검증. 포트원 결제를 조회해 상태/금액을 대사하고
 * 일치하면 주문을 PAID로 확정하며 장바구니를 비운다.
 */
export async function finalizePayment(paymentId: string): Promise<FinalizeResult> {
  const payment = await db.payment.findUnique({ where: { paymentId }, include: { order: true } });
  if (!payment) return { ok: false, reason: "결제 정보를 찾을 수 없습니다." };
  if (payment.status === "PAID") return { ok: true, orderId: payment.orderId };

  let remote;
  try {
    remote = await fetchPortOnePayment(paymentId);
  } catch {
    return { ok: false, reason: "결제 조회에 실패했습니다.", orderId: payment.orderId };
  }

  const info = remote as unknown as {
    status: string;
    amount?: { total?: number };
    pgTxId?: string;
    method?: { type?: string };
  };

  const paidOk = info.status === "PAID" && info.amount?.total === payment.amount;

  if (!paidOk) {
    await db.$transaction([
      db.payment.update({ where: { paymentId }, data: { status: "FAILED", rawResponse: JSON.stringify(remote) } }),
      db.order.update({ where: { id: payment.orderId }, data: { status: "PAYMENT_FAILED" } }),
    ]);
    return { ok: false, reason: "결제가 완료되지 않았거나 금액이 일치하지 않습니다.", orderId: payment.orderId };
  }

  // 원자적 단일 실행: READY→PAID 전이를 성공시킨 호출자만 후속 처리(주문 확정·장바구니 비움).
  // 웹훅과 /complete가 동시에 들어와도 side effect는 한 번만 발생한다.
  const claimed = await db.payment.updateMany({
    where: { paymentId, status: { not: "PAID" } },
    data: {
      status: "PAID",
      method: info.method?.type ?? null,
      pgTxId: info.pgTxId ?? null,
      approvedAt: new Date(),
      rawResponse: JSON.stringify(remote),
    },
  });

  if (claimed.count === 0) {
    // 다른 경로에서 이미 확정됨
    return { ok: true, orderId: payment.orderId };
  }

  await db.$transaction([
    db.order.update({ where: { id: payment.orderId }, data: { status: "PAID" } }),
    db.cartItem.deleteMany({ where: { userId: payment.order.userId } }),
  ]);

  return { ok: true, orderId: payment.orderId };
}
