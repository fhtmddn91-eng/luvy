"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { FULFILLMENT_STATUSES } from "@/lib/orderStatus";
import { cancelOrderCore, RefundFailedError } from "@/lib/orderCancel";
import { audit, shortId } from "@/lib/audit";
import {
  courierName,
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

export async function setOrderStatus(id: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const status = String(formData.get("status") ?? "").trim();
  // 허용된 배송 상태만 반영 (임의 문자열 주입 방지)
  if (!(FULFILLMENT_STATUSES as readonly string[]).includes(status)) return;
  const before = await db.order.findUnique({ where: { id }, select: { status: true } });
  await db.order.update({ where: { id }, data: { status } });

  await audit({
    action: "ORDER_STATUS",
    target: "order",
    targetId: id,
    summary: `주문 ${shortId(id)} ${before?.status} → ${status}`,
    meta: { from: before?.status, to: status },
  });

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
    await audit({
      action: "ORDER_SHIPPING_CLEAR",
      target: "order",
      targetId: id,
      summary: `주문 ${shortId(id)} 송장 삭제`,
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

  await audit({
    action: "ORDER_SHIPPING",
    target: "order",
    targetId: id,
    summary: `주문 ${shortId(id)} 송장 ${courierName(courier)} ${trackingNo}${advance ? " (배송중 전환)" : ""}`,
    meta: { courier, trackingNo, advanced: advance },
  });

  revalidateOrder(id);
  return { ok: true, values: { courier, trackingNo } };
}

/** 관리자 주문 취소. 환불·재고 복원은 회원 취소와 같은 경로를 쓴다. */
export async function cancelOrderPayment(orderId: string): Promise<void> {
  await requireAdmin();
  try {
    await cancelOrderCore(orderId, { by: "ADMIN", reason: "관리자 취소" });
    await audit({
      action: "ORDER_CANCEL_ADMIN",
      target: "order",
      targetId: orderId,
      summary: `주문 ${shortId(orderId)} 취소 — 재고 복원`,
    });
  } catch (e) {
    // 환불 실패는 돈이 걸린 사고라 반드시 남긴다
    if (e instanceof RefundFailedError) {
      await audit({
        action: "ORDER_REFUND_FAILED",
        target: "order",
        targetId: orderId,
        summary: `주문 ${shortId(orderId)} 환불 실패 — 주문 상태 유지`,
        meta: { message: e.message },
      });
    }
    throw e;
  } finally {
    // 환불 실패로 Payment 가 CANCEL_FAILED 가 된 경우에도 화면에 반영되어야 한다.
    revalidateOrder(orderId);
  }
}
