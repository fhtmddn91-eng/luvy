import "server-only";

import { db } from "@/lib/db";
import { cancelPayment as cancelNicePayPayment } from "@/lib/nicepay";
import { restoreStock, linesFromOrderItems, STOCK_LINE_SELECT, type TxClient } from "@/lib/stockOps";
import { reversePointsForOrder, refundPointsForOrder } from "@/lib/memberPoints";

export class RefundFailedError extends Error {
  constructor(cause: string) {
    super(
      `결제 취소(환불)에 실패했습니다. 주문 상태는 변경되지 않았습니다. 고객센터로 문의해주세요. (${cause})`,
    );
    this.name = "RefundFailedError";
  }
}

export interface CancelMeta {
  /** MEMBER | ADMIN | SYSTEM | PG */
  by: string;
  reason: string;
}

export interface CancelOptions {
  /**
   * PG 환불 호출을 건너뛴다. 두 경우에만 켠다:
   *  · 승인 전에 실패해 돈이 안 나간 주문 (환불할 게 없다)
   *  · PG 쪽에서 이미 취소된 것을 웹훅으로 받아 반영하는 경우
   *    (다시 부르면 "이미 취소된 거래" 오류가 나고, 그 오류 때문에 재고 복원이 막힌다)
   */
  skipPgRefund?: boolean;
}

/**
 * 주문을 취소 상태로 바꾸고, 그 전이를 실제로 성공시킨 경우에만 재고를 되돌린다.
 * (이미 취소·결제실패인 주문을 다시 취소해도 재고가 중복 복원되지 않는다)
 */
async function claimCancel(tx: TxClient, orderId: string, meta: CancelMeta): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: { id: orderId, status: { notIn: ["CANCELED", "PAYMENT_FAILED"] } },
    data: {
      status: "CANCELED",
      canceledAt: new Date(),
      canceledBy: meta.by,
      cancelReason: meta.reason,
    },
  });
  if (claimed.count !== 1) return;

  const items = await tx.orderItem.findMany({ where: { orderId }, select: STOCK_LINE_SELECT });
  await restoreStock(tx, linesFromOrderItems(items));
  // 배송완료 뒤 취소된 주문이면 적립 포인트도 같은 트랜잭션에서 회수하고,
  // 결제에 쓴 포인트는 새 묶음으로 돌려준다 (둘 다 주문당 한 번)
  await reversePointsForOrder(tx, orderId);
  await refundPointsForOrder(tx, orderId);
}

/**
 * PG 환불 호출. 어느 PG 로 결제됐는지는 Payment.channel 이 안다.
 *
 * 나이스페이 취소는 tid(pgTxId)로 부르고 orderId 를 함께 보낸다 — 같은 orderId 로는
 * 재호출이 거부되므로 그 자체가 중복 환불 방어가 된다.
 *
 * 모르는 channel 은 **조용히 넘기지 않고 실패시킨다**. 환불을 건너뛰고 주문만 취소하면
 * 손님 돈은 그대로 있는데 우리 장부에는 취소로 남는다 — 그게 제일 나쁘다.
 * (포트원 경로는 2026-09-07 제거됐다. 그 시절 결제는 실제로 한 건도 없었다)
 */
async function refundAtPg(
  payment: { channel: string; paymentId: string; pgTxId: string | null },
  reason: string,
): Promise<void> {
  if (payment.channel !== "nicepay") {
    throw new Error(`지원하지 않는 결제 채널(${payment.channel}) — 환불을 수동으로 처리해야 합니다.`);
  }
  if (!payment.pgTxId) throw new Error("승인 키(tid)가 없어 환불할 수 없습니다.");
  const r = await cancelNicePayPayment(payment.pgTxId, { reason, orderId: payment.paymentId });
  if (!r.ok) throw new Error(`${r.code} ${r.message}`);
}

/**
 * 주문 취소의 공통 처리. 회원 취소와 관리자 취소가 같은 경로를 쓴다.
 *
 * 결제(PAID)가 있으면 포트원 환불을 **먼저** 호출한다. 환불이 실패하면 로컬 상태를
 * 취소로 바꾸지 않고(돈은 받았는데 취소된 주문이 되는 상황 방지) Payment 를
 * CANCEL_FAILED 로 표시한 뒤 예외를 던져 운영자가 재시도하게 한다.
 */
export async function cancelOrderCore(
  orderId: string,
  meta: CancelMeta,
  options: CancelOptions = {},
): Promise<void> {
  const payment = await db.payment.findUnique({ where: { orderId } });

  if (payment && payment.status === "PAID" && !options.skipPgRefund) {
    try {
      await refundAtPg(payment, meta.reason);
    } catch (e) {
      await db.payment.update({ where: { orderId }, data: { status: "CANCEL_FAILED" } });
      throw new RefundFailedError(e instanceof Error ? e.message : "unknown");
    }
    await db.$transaction(async (tx) => {
      await tx.payment.update({
        where: { orderId },
        data: { status: "CANCELED", canceledAt: new Date() },
      });
      await claimCancel(tx, orderId, meta);
    });
    return;
  }

  // 결제 없는(모의) 주문 또는 미결제 주문: 상태만 취소
  await db.$transaction(async (tx) => {
    await claimCancel(tx, orderId, meta);
  });
}
