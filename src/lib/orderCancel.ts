import "server-only";

import { db } from "@/lib/db";
import { cancelPortOnePayment } from "@/lib/portone";
import { restoreStock, linesFromOrderItems, STOCK_LINE_SELECT, type TxClient } from "@/lib/stockOps";

export class RefundFailedError extends Error {
  constructor(cause: string) {
    super(
      `결제 취소(환불)에 실패했습니다. 주문 상태는 변경되지 않았습니다. 고객센터로 문의해주세요. (${cause})`,
    );
    this.name = "RefundFailedError";
  }
}

export interface CancelMeta {
  /** MEMBER | ADMIN */
  by: string;
  reason: string;
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
}

/**
 * 주문 취소의 공통 처리. 회원 취소와 관리자 취소가 같은 경로를 쓴다.
 *
 * 결제(PAID)가 있으면 포트원 환불을 **먼저** 호출한다. 환불이 실패하면 로컬 상태를
 * 취소로 바꾸지 않고(돈은 받았는데 취소된 주문이 되는 상황 방지) Payment 를
 * CANCEL_FAILED 로 표시한 뒤 예외를 던져 운영자가 재시도하게 한다.
 */
export async function cancelOrderCore(orderId: string, meta: CancelMeta): Promise<void> {
  const payment = await db.payment.findUnique({ where: { orderId } });

  if (payment && payment.status === "PAID") {
    try {
      await cancelPortOnePayment(payment.paymentId, meta.reason);
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
