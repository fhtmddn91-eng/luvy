"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireApprovedUser } from "@/lib/auth";
import { buildOrderDraft } from "@/lib/payments";
import { reserveStock, InsufficientStockError, linesFromOrderItems } from "@/lib/stockOps";

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
