"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { cancelPortOnePayment } from "@/lib/portone";
import { FULFILLMENT_STATUSES } from "@/lib/orderStatus";
import { restoreStock, linesFromOrderItems, type TxClient } from "@/lib/stockOps";

/**
 * 주문을 취소 상태로 바꾸고, 그 전이를 실제로 성공시킨 경우에만 재고를 되돌린다.
 * (이미 취소·결제실패인 주문을 다시 취소해도 재고가 중복 복원되지 않는다)
 */
async function cancelAndRestore(tx: TxClient, orderId: string): Promise<void> {
  const claimed = await tx.order.updateMany({
    where: { id: orderId, status: { notIn: ["CANCELED", "PAYMENT_FAILED"] } },
    data: { status: "CANCELED" },
  });
  if (claimed.count !== 1) return;

  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { productId: true, name: true, quantity: true },
  });
  await restoreStock(tx, linesFromOrderItems(items));
}

export async function setOrderStatus(id: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const status = String(formData.get("status") ?? "").trim();
  // 허용된 배송 상태만 반영 (임의 문자열 주입 방지)
  if (!(FULFILLMENT_STATUSES as readonly string[]).includes(status)) return;
  await db.order.update({ where: { id }, data: { status } });
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath(`/orders/${id}`);
}

/**
 * 주문 취소. 결제(PAID)가 있으면 포트원 취소 API를 먼저 호출한다.
 * 환불이 실패하면 로컬 상태를 취소로 바꾸지 않고(오결제 방지) Payment를
 * CANCEL_FAILED로 표시한 뒤 에러를 던져 운영자가 재시도하도록 한다.
 */
export async function cancelOrderPayment(orderId: string): Promise<void> {
  await requireAdmin();
  const payment = await db.payment.findUnique({ where: { orderId } });

  if (payment && payment.status === "PAID") {
    try {
      await cancelPortOnePayment(payment.paymentId, "관리자 취소");
    } catch (e) {
      await db.payment.update({ where: { orderId }, data: { status: "CANCEL_FAILED" } });
      revalidatePath(`/admin/orders/${orderId}`);
      throw new Error(
        `결제 취소(환불)에 실패했습니다. 주문 상태는 변경되지 않았습니다. (${e instanceof Error ? e.message : "unknown"})`,
      );
    }
    await db.$transaction(async (tx) => {
      await tx.payment.update({
        where: { orderId },
        data: { status: "CANCELED", canceledAt: new Date() },
      });
      await cancelAndRestore(tx, orderId);
    });
  } else {
    // 결제 없는(모의) 주문 또는 미결제 주문: 상태만 취소
    await db.$transaction(async (tx) => {
      await cancelAndRestore(tx, orderId);
    });
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/orders");
}
