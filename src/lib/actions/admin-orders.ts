"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { cancelPortOnePayment } from "@/lib/portone";
import { FULFILLMENT_STATUSES } from "@/lib/orderStatus";
import { restoreStock, linesFromOrderItems, type TxClient } from "@/lib/stockOps";
import {
  isCourierCode,
  isValidTrackingNo,
  normalizeTrackingNo,
  shouldAdvanceToShipped,
} from "@/lib/shipping";

export interface ShippingFormState {
  error?: string;
  ok?: boolean;
  /**
   * 방금 제출한 값. React 19 는 서버 액션 제출 후 form 을 초기화하므로,
   * 검증 실패로 돌아왔을 때 운영자가 입력한 값을 이걸로 되살린다.
   */
  values?: { courier: string; trackingNo: string };
}

/** 주문 관련 화면(어드민·회원)을 한 번에 갱신한다. */
function revalidateOrder(id: string): void {
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath(`/orders/${id}`);
}

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
  revalidateOrder(id);
}

/**
 * 운송장(송장) 정보 저장.
 *
 * 번호를 넣으면 배송 전 상태의 주문은 자동으로 '배송중'이 되고 발송 시각이 찍힌다.
 * (운영자가 상태 변경을 따로 누르지 않아 회원이 배송 조회를 못 하는 일을 막는다)
 * 번호를 비우면 잘못 입력한 송장을 지우는 동작이며, 상태는 그대로 두어
 * 운영자가 의도적으로 되돌리도록 한다.
 */
export async function setShipping(
  id: string,
  _prev: ShippingFormState,
  formData: FormData,
): Promise<ShippingFormState> {
  await requireAdmin();

  const courier = String(formData.get("courier") ?? "").trim();
  const rawNo = String(formData.get("trackingNo") ?? "").trim();
  const values = { courier, trackingNo: rawNo };

  // 둘 다 비었으면 송장 삭제
  if (courier === "" && rawNo === "") {
    await db.order.update({
      where: { id },
      data: { courier: "", trackingNo: "", shippedAt: null },
    });
    revalidateOrder(id);
    return { ok: true, values };
  }

  if (!isCourierCode(courier)) return { error: "택배사를 선택해주세요.", values };
  if (rawNo === "") return { error: "운송장번호를 입력해주세요.", values };
  if (!isValidTrackingNo(rawNo)) {
    return { error: "운송장번호 형식이 올바르지 않습니다. (영문·숫자 8~20자리)", values };
  }

  const trackingNo = normalizeTrackingNo(rawNo);

  const order = await db.order.findUnique({ where: { id }, select: { status: true } });
  if (!order) return { error: "주문을 찾을 수 없습니다.", values };

  const advance = shouldAdvanceToShipped(order.status);
  await db.order.update({
    where: { id },
    data: {
      courier,
      trackingNo,
      shippedAt: new Date(),
      ...(advance ? { status: "SHIPPED" } : {}),
    },
  });

  revalidateOrder(id);
  return { ok: true, values: { courier, trackingNo } };
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

  revalidateOrder(orderId);
}
