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
import { isSelectableMethod, type Availability } from "@/lib/paymentMethods";
import { isNicePayConfigured, NICEPAY_CLIENT_KEY } from "@/lib/nicepay";
import { nicePayOrderId, safeGoodsName } from "@/lib/nicepaySign";
import { headers } from "next/headers";
import { publicOriginFrom } from "@/lib/publicOrigin";
import { getPointPolicy } from "@/lib/settings";
import { validatePointUse, orderTotalAfterPoints } from "@/lib/points";
import { pointSummary, usePointsForOrder, InsufficientPointsError } from "@/lib/memberPoints";

export type OrderState = { error?: string };

/**
 * 주문서의 포인트 사용량. 폼 값은 조작할 수 있으므로 정책·잔액·총액으로 다시 검사한다.
 * 잔액은 만료 정리 뒤의 값이다 — 화면에 보인 잔액과 같은 기준.
 */
async function parsePointsUsed(
  formData: FormData,
  userId: string,
  orderTotal: number,
): Promise<{ ok: true; amount: number } | { ok: false; error: string }> {
  const raw = String(formData.get("pointsUsed") ?? "0").replace(/,/g, "").trim();
  const requested = raw === "" ? 0 : Number(raw);
  const [policy, summary] = await Promise.all([getPointPolicy(), pointSummary(userId)]);
  return validatePointUse({ requested, balance: summary.balance, orderTotal, minUse: policy.minUse, unit: policy.unit });
}

/**
 * 포인트로 총액이 0원이 된 주문은 결제 절차가 없다 — 바로 배송준비로 두고
 * 입금 확인 칸에 "POINTS" 를 남겨 누가·왜 넘겼는지 대사할 수 있게 한다.
 */
function zeroPaidData(now: Date) {
  return { status: "PREPARING", depositConfirmedAt: now, depositConfirmedBy: "POINTS", depositAmount: 0 } as const;
}

function parseShipping(formData: FormData) {
  return {
    recipient: String(formData.get("recipient") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    memo: String(formData.get("memo") ?? "").trim() || null,
  };
}

/**
 * 결제 수단. 화면에서 '준비 중'을 못 고르게 막아뒀지만, 폼 값은 조작할 수 있으므로
 * 서버에서 다시 확인한다 — 연동도 안 된 PG로 주문이 들어오면 대사할 방법이 없다.
 */
function parsePaymentMethod(formData: FormData): string | null {
  const value = String(formData.get("paymentMethod") ?? "").trim();
  return isSelectableMethod(value, paymentAvailability()) ? value : null;
}

/** 서버만 아는 "지금 열 수 있는 결제 수단". 주문서 화면(checkout/page)도 같은 식으로 계산한다 */
function paymentAvailability(): Availability {
  return { nicepay: isNicePayConfigured() };
}

/**
 * 결제창이 돌아올 주소의 origin — returnUrl 라우트의 redirect 와 같은 규칙(publicOrigin).
 * (로컬에서 운영 주소로 돌아가면 결제 결과가 딴 서버로 간다)
 */
async function requestOrigin(): Promise<string> {
  return publicOriginFrom(await headers());
}

/**
 * 무통장입금 주문: 결제창 없이 바로 접수 처리하고 장바구니를 비운다.
 * (카드는 createNicePayOrder → 결제창 → returnUrl 경로를 탄다)
 */
export async function placeOrder(_prev: OrderState, formData: FormData): Promise<OrderState> {
  const user = await requireApprovedUser();
  const s = parseShipping(formData);
  if (!s.recipient || !s.phone || !s.address) {
    return { error: "수령인, 연락처, 주소를 모두 입력해주세요." };
  }

  const paymentMethod = parsePaymentMethod(formData);
  if (!paymentMethod) {
    return { error: "지금 이용할 수 있는 결제 수단을 선택해주세요." };
  }

  // 주문 불가 품목이 섞여 있으면 여기서 전체가 멈춘다 — 일부만 주문되지 않는다
  const draftResult = await buildOrderDraft(user.id);
  if (!draftResult.ok) return { error: draftResult.error };
  const draft = draftResult.draft;

  const points = await parsePointsUsed(formData, user.id, draft.total);
  if (!points.ok) return { error: points.error };
  const total = orderTotalAfterPoints(draft.subtotal, draft.shippingFee, points.amount);

  let order;
  try {
    order = await db.$transaction(async (tx) => {
      // 재고 차감·포인트 차감을 주문 생성과 같은 트랜잭션에 묶는다.
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
          paymentMethod,
          subtotal: draft.subtotal,
          shippingFee: draft.shippingFee,
          pointsUsed: points.amount,
          total,
          items: { create: draft.items },
          ...(total === 0 ? zeroPaidData(new Date()) : {}),
        },
      });
      await usePointsForOrder(tx, { userId: user.id, orderId: created.id, amount: points.amount });
      await tx.cartItem.deleteMany({ where: { userId: user.id } });
      return created;
    });
  } catch (e) {
    if (e instanceof InsufficientStockError) return { error: e.message };
    if (e instanceof InsufficientPointsError) return { error: e.message };
    throw e;
  }

  revalidatePath("/", "layout");
  redirect(`/checkout/complete?order=${order.id}`);
}

/** 나이스페이 결제창(AUTHNICE.requestPay)에 그대로 넘기는 값 — 전부 공개 가능한 값이다 */
export interface NicePayWindowParams {
  clientId: string;
  orderId: string;
  amount: number;
  goodsName: string;
  returnUrl: string;
  buyerName: string;
  buyerTel: string;
  buyerEmail: string;
}

export type NicePayOrderResult =
  /** 포인트로 총액이 0원 — 결제창 없이 이미 접수됐다 */
  | { ok: true; paid: true; orderId: string }
  | { ok: true; paid: false; orderId: string; window: NicePayWindowParams }
  | { ok: false; error: string };

/**
 * 나이스페이 카드 결제 시작: 결제대기 주문 + Payment(READY, channel nicepay) 를 만들고
 * 결제창 호출값을 돌려준다. 장바구니는 승인이 확정된 뒤에 비운다.
 *
 * 같은 회원의 **이전 결제대기 주문은 여기서 정리**한다. 결제창을 닫고 다시 여는 손님이
 * 흔한데, 앞 주문이 재고를 문 채 남으면 "재고 부족"으로 자기 자신에게 막힌다.
 * 승인이 진행 중일 수 있는 건(READY 가 아닌 것)은 건드리지 않는다.
 */
export async function createNicePayOrder(formData: FormData): Promise<NicePayOrderResult> {
  const user = await requireApprovedUser();
  if (!isNicePayConfigured()) return { ok: false, error: "카드 결제가 아직 열리지 않았습니다." };

  const s = parseShipping(formData);
  if (!s.recipient || !s.phone || !s.address) {
    return { ok: false, error: "수령인, 연락처, 주소를 모두 입력해주세요." };
  }

  const draftResult = await buildOrderDraft(user.id);
  if (!draftResult.ok) return { ok: false, error: draftResult.error };
  const draft = draftResult.draft;

  const points = await parsePointsUsed(formData, user.id, draft.total);
  if (!points.ok) return { ok: false, error: points.error };
  const total = orderTotalAfterPoints(draft.subtotal, draft.shippingFee, points.amount);
  const zeroPaid = total === 0;

  // 이전 결제대기(미승인) 주문 정리 — 재고·포인트가 돌아와야 이번 주문이 잡힌다
  const stale = await db.order.findMany({
    where: { userId: user.id, status: "PENDING_PAYMENT", paymentMethod: "NICEPAY", payment: { status: { in: ["READY", "FAILED"] } } },
    select: { id: true },
  });
  for (const o of stale) {
    await cancelOrderCore(o.id, { by: "SYSTEM", reason: "새 결제 시작으로 이전 결제대기 주문 정리" }, { skipPgRefund: true });
  }

  let order;
  try {
    order = await db.$transaction(async (tx) => {
      await reserveStock(tx, linesFromOrderItems(draft.items));
      const created = await tx.order.create({
        data: {
          userId: user.id,
          status: "PENDING_PAYMENT",
          recipient: s.recipient,
          phone: s.phone,
          address: s.address,
          memo: s.memo,
          paymentMethod: "NICEPAY",
          subtotal: draft.subtotal,
          shippingFee: draft.shippingFee,
          pointsUsed: points.amount,
          total,
          items: { create: draft.items },
          ...(zeroPaid ? zeroPaidData(new Date()) : {}),
        },
      });
      await usePointsForOrder(tx, { userId: user.id, orderId: created.id, amount: points.amount });
      if (zeroPaid) await tx.cartItem.deleteMany({ where: { userId: user.id } });
      return created;
    });
  } catch (e) {
    if (e instanceof InsufficientStockError) return { ok: false, error: e.message };
    if (e instanceof InsufficientPointsError) return { ok: false, error: e.message };
    throw e;
  }

  if (zeroPaid) {
    revalidatePath("/", "layout");
    return { ok: true, paid: true, orderId: order.id };
  }

  const paymentId = nicePayOrderId(order.id, 1);
  await db.payment.create({
    data: { orderId: order.id, paymentId, amount: total, status: "READY", channel: "nicepay" },
  });

  return {
    ok: true,
    paid: false,
    orderId: order.id,
    window: {
      clientId: NICEPAY_CLIENT_KEY,
      orderId: paymentId,
      amount: total,
      goodsName: safeGoodsName(draft.orderName),
      returnUrl: `${await requestOrigin()}/api/payments/nicepay/return`,
      buyerName: s.recipient,
      buyerTel: s.phone,
      buyerEmail: user.email,
    },
  };
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
