"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireApprovedUser, requireUser } from "@/lib/auth";
import { buildOrderDraft } from "@/lib/payments";
import { reserveStock, InsufficientStockError, linesFromOrderItems } from "@/lib/stockOps";
import { cancelOrderCore, RefundFailedError } from "@/lib/orderCancel";
import { audit, shortId } from "@/lib/audit";
import {
  isMemberCancelable,
  isCancelReason,
  formatCancelReason,
  orderStatusLabel,
} from "@/lib/orderStatus";

export type OrderState = { error?: string };

function parseShipping(formData: FormData) {
  return {
    recipient: String(formData.get("recipient") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    memo: String(formData.get("memo") ?? "").trim() || null,
  };
}

/**
 * 모의 결제(포트원 미설정) 플로우: 주문을 바로 접수 처리하고 장바구니를 비운다.
 */
export async function placeOrder(_prev: OrderState, formData: FormData): Promise<OrderState> {
  const user = await requireApprovedUser();
  const s = parseShipping(formData);
  if (!s.recipient || !s.phone || !s.address) {
    return { error: "수령인, 연락처, 주소를 모두 입력해주세요." };
  }

  const draft = await buildOrderDraft(user.id);
  if (!draft) return { error: "장바구니가 비어 있습니다." };

  let order;
  try {
    order = await db.$transaction(async (tx) => {
      // 재고 차감을 주문 생성과 같은 트랜잭션에 묶는다.
      // 부족하면 예외가 나면서 주문·장바구니 변경까지 전부 롤백된다.
      await reserveStock(tx, linesFromOrderItems(draft.items));
      const created = await tx.order.create({
        data: {
          userId: user.id,
          status: "RECEIVED",
          recipient: s.recipient,
          phone: s.phone,
          address: s.address,
          memo: s.memo,
          subtotal: draft.subtotal,
          shippingFee: draft.shippingFee,
          total: draft.total,
          items: { create: draft.items },
        },
      });
      await tx.cartItem.deleteMany({ where: { userId: user.id } });
      return created;
    });
  } catch (e) {
    if (e instanceof InsufficientStockError) return { error: e.message };
    throw e;
  }

  revalidatePath("/", "layout");
  redirect(`/checkout/complete?order=${order.id}`);
}

export type PendingOrderResult =
  | { ok: true; orderId: string; paymentId: string; orderName: string; amount: number }
  | { ok: false; error: string };

/**
 * 포트원 결제 플로우: 결제 대기 주문 + Payment(READY)를 만들고 결제창 호출에
 * 필요한 값을 반환한다. 장바구니는 결제 완료 시점에 비운다.
 */
export async function createPendingOrder(formData: FormData): Promise<PendingOrderResult> {
  const user = await requireApprovedUser();
  const s = parseShipping(formData);
  if (!s.recipient || !s.phone || !s.address) {
    return { ok: false, error: "수령인, 연락처, 주소를 모두 입력해주세요." };
  }

  const draft = await buildOrderDraft(user.id);
  if (!draft) return { ok: false, error: "장바구니가 비어 있습니다." };

  // 결제창을 띄우기 전에 재고를 선점한다.
  // 결제가 끝난 뒤에 차감하면, 마지막 재고를 두 명이 동시에 결제해
  // "돈은 받았지만 보낼 물건이 없는" 상황이 생긴다.
  // 결제 실패·취소 시에는 restoreStock 으로 되돌린다.
  let order;
  try {
    order = await db.$transaction(async (tx) => {
      await reserveStock(tx, linesFromOrderItems(draft.items));
      return tx.order.create({
        data: {
          userId: user.id,
          status: "PENDING_PAYMENT",
          recipient: s.recipient,
          phone: s.phone,
          address: s.address,
          memo: s.memo,
          subtotal: draft.subtotal,
          shippingFee: draft.shippingFee,
          total: draft.total,
          items: { create: draft.items },
        },
      });
    });
  } catch (e) {
    if (e instanceof InsufficientStockError) return { ok: false, error: e.message };
    throw e;
  }

  const paymentId = `luvy-${order.id}`;
  await db.payment.create({
    data: { orderId: order.id, paymentId, amount: draft.total, status: "READY" },
  });

  return { ok: true, orderId: order.id, paymentId, orderName: draft.orderName, amount: draft.total };
}

export type CancelState = { error?: string };

/**
 * 회원의 주문 취소. 발송 전(결제완료·접수됨·배송준비)까지만 허용한다.
 *
 * 결제·재고 처리는 관리자 취소와 같은 cancelOrderCore 를 쓴다.
 * (두 경로가 갈라지면 한쪽만 환불되거나 재고가 안 돌아오는 사고가 난다)
 */
export async function cancelMyOrder(
  orderId: string,
  _prev: CancelState,
  formData: FormData,
): Promise<CancelState> {
  // requireApprovedUser 가 아니라 requireUser: 승인 상태가 바뀌어도
  // 이미 넣은 주문은 스스로 취소할 수 있어야 한다.
  const user = await requireUser();

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { userId: true, status: true, trackingNo: true },
  });
  // 남의 주문인지 없는 주문인지 구분해 알려주지 않는다
  if (!order || order.userId !== user.id) return { error: "주문을 찾을 수 없습니다." };

  if (!isMemberCancelable(order)) {
    return {
      error:
        order.status === "CANCELED"
          ? "이미 취소된 주문입니다."
          : `이미 발송 단계로 넘어간 주문(${orderStatusLabel(order.status)})은 직접 취소할 수 없습니다. 고객센터로 문의해주세요.`,
    };
  }

  const reason = String(formData.get("reason") ?? "").trim();
  if (!isCancelReason(reason)) return { error: "취소 사유를 선택해주세요." };
  const detail = String(formData.get("detail") ?? "").slice(0, 200);

  try {
    await cancelOrderCore(orderId, { by: "MEMBER", reason: formatCancelReason(reason, detail) });
  } catch (e) {
    if (e instanceof RefundFailedError) return { error: e.message };
    throw e;
  }

  await audit({
    action: "ORDER_CANCEL_MEMBER",
    target: "order",
    targetId: orderId,
    summary: `주문 ${shortId(orderId)} 회원 취소 — ${formatCancelReason(reason, detail)}`,
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  return {};
}
