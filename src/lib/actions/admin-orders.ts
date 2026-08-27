"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { statusChangeRejection, orderStatusLabel } from "@/lib/orderStatus";
import { cancelOrderCore, RefundFailedError } from "@/lib/orderCancel";
import { parseDepositInput, depositGapLabel } from "@/lib/deposit";
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

export interface StatusFormState {
  error?: string;
  ok?: boolean;
}

/**
 * 배송 상태 변경.
 *
 * 취소는 여기로 오지 않는다 — statusChangeRejection 이 CANCELED 를 거부한다.
 * 화면 드롭다운에서 뺀 것만으로는 부족하다: 서버 액션은 폼 값을 그대로 받으므로
 * 목록에 없는 값도 들어올 수 있고, 그 길로 들어오면 재고 복원·환불이 통째로 빠진다.
 */
export async function setOrderStatus(
  id: string,
  _prev: StatusFormState,
  formData: FormData,
): Promise<StatusFormState> {
  await requireAdmin();
  const status = String(formData.get("status") ?? "").trim();

  const before = await db.order.findUnique({
    where: { id },
    select: { status: true, paymentMethod: true, depositConfirmedAt: true },
  });
  if (!before) return { error: "주문을 찾을 수 없습니다." };

  const why = statusChangeRejection({
    from: before.status,
    to: status,
    paymentMethod: before.paymentMethod,
    depositConfirmedAt: before.depositConfirmedAt,
  });
  if (why) return { error: why };

  if (status === before.status) return { ok: true };

  await db.order.update({ where: { id }, data: { status } });

  await audit({
    action: "ORDER_STATUS",
    target: "order",
    targetId: id,
    summary: `주문 ${shortId(id)} ${orderStatusLabel(before.status)} → ${orderStatusLabel(status)}`,
    meta: { from: before.status, to: status },
  });

  revalidateOrder(id);
  return { ok: true };
}

export interface DepositFormState {
  error?: string;
  ok?: boolean;
  values?: { depositorName: string; depositAmount: string };
}

/**
 * 무통장 입금 확인 → 배송준비 전환.
 *
 * 상태만 바꾸는 대신 이 액션을 거치게 하는 이유: "돈이 들어왔다"는 판단은
 * 운영자가 통장을 보고 내리는 것인데, 예전 흐름은 그 근거를 아무 데도 남기지
 * 않았다. 누가·언제·얼마를·누구 이름으로 확인했는지가 없으면 나중에 입금 분쟁이
 * 났을 때 시스템에서 확인할 방법이 없다.
 *
 * 부분·초과 입금은 **막지 않고 기록한다** — 배송비를 빼고 넣거나 여러 주문을
 * 한 번에 보내는 일이 잦아서, 여기서 차단하면 운영자가 시스템을 우회한다.
 */
export async function confirmDeposit(
  id: string,
  _prev: DepositFormState,
  formData: FormData,
): Promise<DepositFormState> {
  const admin = await requireAdmin();
  const raw = {
    depositorName: String(formData.get("depositorName") ?? ""),
    depositAmount: String(formData.get("depositAmount") ?? ""),
  };
  const values = { depositorName: raw.depositorName, depositAmount: raw.depositAmount };

  const order = await db.order.findUnique({
    where: { id },
    select: { status: true, paymentMethod: true, depositConfirmedAt: true, total: true },
  });
  if (!order) return { error: "주문을 찾을 수 없습니다.", values };
  if (order.paymentMethod !== "BANK_TRANSFER") {
    return { error: "무통장입금 주문이 아닙니다.", values };
  }
  if (order.depositConfirmedAt) return { error: "이미 입금 확인된 주문입니다.", values };
  if (order.status !== "RECEIVED") {
    return { error: `접수됨 상태에서만 입금을 확인할 수 있습니다. (현재 ${orderStatusLabel(order.status)})`, values };
  }

  const parsed = parseDepositInput(raw);
  if (!parsed.ok) return { error: parsed.error, values };

  // 조건부 claim — 운영자가 두 번 눌러도 확인 기록이 덮이거나 두 번 남지 않는다
  const claimed = await db.order.updateMany({
    where: { id, status: "RECEIVED", depositConfirmedAt: null },
    data: {
      status: "PREPARING",
      depositConfirmedAt: new Date(),
      depositConfirmedBy: admin.email,
      depositorName: parsed.value.depositorName,
      depositAmount: parsed.value.depositAmount,
    },
  });
  if (claimed.count !== 1) return { error: "이미 처리된 주문입니다.", values };

  const gap = depositGapLabel(parsed.value.depositAmount, order.total);
  await audit({
    action: "ORDER_DEPOSIT_CONFIRM",
    target: "order",
    targetId: id,
    summary:
      `주문 ${shortId(id)} 입금 확인 — ${parsed.value.depositorName} ` +
      `${parsed.value.depositAmount.toLocaleString("ko-KR")}원${gap ? ` (${gap})` : ""} → 배송준비`,
    meta: {
      depositorName: parsed.value.depositorName,
      depositAmount: parsed.value.depositAmount,
      total: order.total,
      gap: gap || null,
    },
  });

  revalidateOrder(id);
  return { ok: true };
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
