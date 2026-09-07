import "server-only";
import { db } from "@/lib/db";
import { cancelOrderCore } from "@/lib/orderCancel";

/**
 * 나이스페이 결제 결과를 우리 주문에 반영한다.
 *
 * 이 함수는 **두 경로에서 불린다** — returnUrl 승인 직후와 웹훅. 둘이 동시에 들어와도
 * 주문 확정·장바구니 비움이 한 번만 일어나야 한다. 그래서 상태 전이를 조건부 claim 으로
 * 선점하고, 선점에 성공한 호출자만 뒷일을 한다.
 */

export type SettleResult =
  | { ok: true; orderId: string; firstTime: boolean }
  | { ok: false; code: string; message: string };

/**
 * 승인된 결제를 주문에 확정 반영.
 *
 * 금액은 여기서 **한 번 더** 본다. returnUrl 단계에서 이미 검증했지만, 웹훅은 그 검증을
 * 거치지 않고 들어오므로 여기가 마지막 방어선이다. 우리가 저장해 둔 금액과 다르면
 * 확정하지 않는다 — 덜 받고 물건을 내보내는 게 최악이다.
 */
export async function settleNicePayPaid(input: {
  paymentId: string;
  tid: string;
  amount: number;
  raw: string;
  source: "return" | "webhook";
  method?: string | null;
}): Promise<SettleResult> {
  const payment = await db.payment.findUnique({
    where: { paymentId: input.paymentId },
    include: { order: true },
  });
  if (!payment) return { ok: false, code: "NO_PAYMENT", message: "결제 정보를 찾을 수 없습니다." };

  if (payment.amount !== input.amount) {
    return { ok: false, code: "AMOUNT_MISMATCH", message: "결제 금액이 주문과 다릅니다." };
  }

  // 조건부 claim — returnUrl 과 웹훅이 겹쳐 들어와도 여기를 통과하는 건 하나뿐이다
  const claimed = await db.payment.updateMany({
    where: { paymentId: input.paymentId, status: { not: "PAID" } },
    data: {
      status: "PAID",
      pgTxId: input.tid,
      method: input.method ?? null,
      approvedAt: new Date(),
      rawResponse: input.raw.slice(0, 8000),
    },
  });

  if (claimed.count === 0) {
    // 다른 경로가 이미 확정했다 — 성공이지만 뒷일을 또 하지는 않는다
    return { ok: true, orderId: payment.orderId, firstTime: false };
  }

  await db.$transaction([
    db.order.update({ where: { id: payment.orderId }, data: { status: "PAID" } }),
    db.cartItem.deleteMany({ where: { userId: payment.order.userId } }),
  ]);

  return { ok: true, orderId: payment.orderId, firstTime: true };
}

/**
 * 결제가 확정되지 못한 주문을 실패로 닫고 선점했던 재고를 되돌린다.
 * (승인 거절·금액 불일치·인증 실패 — 돈이 나가지 않은 경우)
 */
export async function failNicePayPayment(input: {
  paymentId: string;
  reason: string;
  raw?: string;
}): Promise<void> {
  const payment = await db.payment.findUnique({ where: { paymentId: input.paymentId } });
  if (!payment) return;

  await db.payment.updateMany({
    where: { paymentId: input.paymentId, status: { not: "PAID" } },
    data: { status: "FAILED", rawResponse: input.raw?.slice(0, 8000) ?? null },
  });

  // 재고·포인트 복원은 취소 공통 경로가 담당한다. PG 환불은 부르지 않는다 — 돈이 안 나갔다.
  await cancelOrderCore(payment.orderId, { by: "SYSTEM", reason: input.reason }, { skipPgRefund: true });
}

/**
 * 나이스페이 쪽에서 이미 취소된 거래를 우리 DB 에 반영.
 * 가맹점관리자에서 사람이 직접 취소하면 이 경로로만 알 수 있다.
 */
export async function markNicePayCanceled(input: { paymentId: string; raw: string }): Promise<void> {
  const payment = await db.payment.findUnique({ where: { paymentId: input.paymentId } });
  if (!payment) return;

  await db.payment.updateMany({
    where: { paymentId: input.paymentId, status: { not: "CANCELED" } },
    data: { status: "CANCELED", canceledAt: new Date(), rawResponse: input.raw.slice(0, 8000) },
  });

  // PG 는 이미 취소했다 — 다시 부르면 "이미 취소된 거래" 오류가 난다
  await cancelOrderCore(payment.orderId, { by: "PG", reason: "나이스페이에서 취소됨" }, { skipPgRefund: true });
}
