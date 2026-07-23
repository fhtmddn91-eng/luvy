"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { cancelPortOnePayment } from "@/lib/portone";

export async function setOrderStatus(id: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const status = String(formData.get("status") ?? "").trim();
  if (!status) return;
  await db.order.update({ where: { id }, data: { status } });
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath(`/orders/${id}`);
}

/** 주문 취소. 결제(PAID)가 있으면 포트원 취소 API를 호출한 뒤 로컬 상태를 취소 처리. */
export async function cancelOrderPayment(orderId: string): Promise<void> {
  await requireAdmin();
  const payment = await db.payment.findUnique({ where: { orderId } });

  if (payment && payment.status === "PAID") {
    try {
      await cancelPortOnePayment(payment.paymentId, "관리자 취소");
    } catch {
      // 포트원 미설정/실패 시에도 로컬 취소는 진행 (운영자가 별도 조치)
    }
    await db.$transaction([
      db.payment.update({ where: { orderId }, data: { status: "CANCELED", canceledAt: new Date() } }),
      db.order.update({ where: { id: orderId }, data: { status: "CANCELED" } }),
    ]);
  } else {
    await db.order.update({ where: { id: orderId }, data: { status: "CANCELED" } });
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/orders");
}
