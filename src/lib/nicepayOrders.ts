import "server-only";
import { db } from "@/lib/db";
import { cancelOrderCore } from "@/lib/orderCancel";
import { cancelPayment } from "@/lib/nicepay";
import { audit, shortId } from "@/lib/audit";
import { isAbandonedPending, staleBefore, STALE_PENDING_MINUTES } from "@/lib/pendingRules";

/**
 * 버려진 카드 결제대기 주문 정리 (2026-09-11 리뷰 #5).
 *
 * 어드민 주문 목록·대시보드를 열 때 돈다 — 회원 포인트 만료(expireAllDuePoints)와
 * 같은 "페이지 로드 시 정리" 방식이다. 별도 스케줄러 없이도 운영자가 하루 한 번
 * 화면을 열면 재고가 풀린다. 판정 규칙은 pendingRules.ts(순수)에 있고, 여기서는
 * 후보를 DB 에서 좁게 읽어 **한 번 더** 그 규칙으로 걸러 취소 경로에 넘긴다.
 *
 * 취소는 cancelOrderCore(skipPgRefund) — 돈이 안 나간 주문만 넘기지만, 혹시
 * 그 사이 웹훅이 PAID 로 바꿨다면 cancelOrderCore 가 MONEY_OUT 관문에서 막는다.
 * 한 건이 실패해도 나머지는 계속 정리한다.
 */
export async function sweepAbandonedPendingOrders(now = new Date()): Promise<number> {
  const candidates = await db.order.findMany({
    where: {
      status: "PENDING_PAYMENT",
      paymentMethod: "NICEPAY",
      createdAt: { lt: staleBefore(now) },
    },
    select: { id: true, status: true, paymentMethod: true, createdAt: true, payment: { select: { status: true } } },
    take: 200, // 한 번에 너무 많이 돌지 않게 — 나머지는 다음 화면 로드에서
  });

  let swept = 0;
  for (const o of candidates) {
    if (!isAbandonedPending(o, now)) continue;
    try {
      await cancelOrderCore(
        o.id,
        { by: "SYSTEM", reason: `결제창을 닫고 ${STALE_PENDING_MINUTES}분 넘게 돌아오지 않음 — 자동 정리` },
        { skipPgRefund: true },
      );
      swept += 1;
    } catch (e) {
      // 돈이 나간 결제로 바뀐 경우 등 — 이 건은 두고 나머지를 계속한다
      console.warn(`[pending sweep] ${o.id} 정리 실패:`, e instanceof Error ? e.message : e);
    }
  }

  if (swept > 0) {
    await audit({
      action: "PAYMENT_PENDING_SWEPT",
      target: "order",
      targetId: "",
      summary: `결제창을 닫고 돌아오지 않은 카드 주문 ${swept}건 자동 정리 — 재고 복원`,
      meta: { swept, candidates: candidates.length, staleMinutes: STALE_PENDING_MINUTES },
      actor: { id: null, name: "시스템", role: "SYSTEM" },
    });
  }
  return swept;
}

/**
 * 나이스페이 결제 결과를 우리 주문에 반영한다.
 *
 * 이 함수는 **두 경로에서 불린다** — returnUrl 승인 직후와 웹훅. 둘이 동시에 들어와도
 * 주문 확정·장바구니 비움이 한 번만 일어나야 한다. 그래서 상태 전이를 조건부 claim 으로
 * 선점하고, 선점에 성공한 호출자만 뒷일을 한다.
 */

export type SettleResult =
  | { ok: true; orderId: string; firstTime: boolean }
  | { ok: false; code: string; message: string };

/**
 * 승인된 결제를 주문에 확정 반영.
 *
 * 금액은 여기서 **한 번 더** 본다. returnUrl 단계에서 이미 검증했지만, 웹훅은 그 검증을
 * 거치지 않고 들어오므로 여기가 마지막 방어선이다. 우리가 저장해 둔 금액과 다르면
 * 확정하지 않는다 — 덜 받고 물건을 내보내는 게 최악이다.
 *
 * 주문이 이미 취소돼 있으면(손님이 결제창을 두 번 열어 앞 주문이 정리된 경우 등)
 * 확정하지 않고 **즉시 환불**한다. 취소된 주문을 PAID 로 되살리면 재고는 이미
 * 돌아간 뒤라 "돈은 받았는데 물건은 없는" 주문이 된다.
 */
export async function settleNicePayPaid(input: {
  paymentId: string;
  tid: string;
  amount: number;
  raw: string;
  source: "return" | "webhook";
  method?: string | null;
}): Promise<SettleResult> {
  const payment = await db.payment.findUnique({
    where: { paymentId: input.paymentId },
    include: { order: true },
  });
  if (!payment) return { ok: false, code: "NO_PAYMENT", message: "결제 정보를 찾을 수 없습니다." };

  if (payment.amount !== input.amount) {
    return { ok: false, code: "AMOUNT_MISMATCH", message: "결제 금액이 주문과 다릅니다." };
  }

  if (payment.order.status === "CANCELED" || payment.order.status === "PAYMENT_FAILED") {
    await refundStrayApproval({ paymentId: input.paymentId, tid: input.tid, orderId: payment.orderId, source: input.source });
    return { ok: false, code: "ORDER_CLOSED", message: "이미 닫힌 주문입니다. 결제는 취소 처리됩니다." };
  }

  // 조건부 claim — returnUrl 과 웹훅이 겹쳐 들어와도 여기를 통과하는 건 하나뿐이다
  const claimed = await db.payment.updateMany({
    where: { paymentId: input.paymentId, status: { not: "PAID" } },
    data: {
      status: "PAID",
      pgTxId: input.tid,
      method: input.method ?? null,
      approvedAt: new Date(),
      rawResponse: input.raw.slice(0, 8000),
    },
  });

  if (claimed.count === 0) {
    // 다른 경로가 이미 확정했다 — 성공이지만 뒷일을 또 하지는 않는다
    return { ok: true, orderId: payment.orderId, firstTime: false };
  }

  await db.$transaction([
    db.order.update({ where: { id: payment.orderId }, data: { status: "PAID" } }),
    db.cartItem.deleteMany({ where: { userId: payment.order.userId } }),
  ]);

  return { ok: true, orderId: payment.orderId, firstTime: true };
}

/**
 * 닫힌 주문에 승인이 들어온 경우의 환불. 실패하면 감사로그에 눈에 띄게 남긴다 —
 * 돈은 받았는데 주문은 없는 상태라 운영자가 손으로 환불해야 한다.
 */
async function refundStrayApproval(input: { paymentId: string; tid: string; orderId: string; source: string }): Promise<void> {
  const r = await cancelPayment(input.tid, { reason: "닫힌 주문에 대한 승인 — 자동 환불", orderId: input.paymentId });
  await db.payment.updateMany({
    where: { paymentId: input.paymentId },
    data: r.ok ? { status: "CANCELED", canceledAt: new Date(), pgTxId: input.tid } : { status: "CANCEL_FAILED", pgTxId: input.tid },
  });
  await audit({
    action: r.ok ? "PAYMENT_STRAY_REFUNDED" : "ORDER_REFUND_FAILED",
    target: "order",
    targetId: input.orderId,
    summary: r.ok
      ? `주문 ${shortId(input.orderId)} 닫힌 주문에 승인(${input.source}) → 자동 환불`
      : `주문 ${shortId(input.orderId)} 닫힌 주문에 승인(${input.source}) — 환불 실패, 수동 환불 필요 (${r.code})`,
    meta: { tid: input.tid, paymentId: input.paymentId, source: input.source, result: r.ok ? "refunded" : r.code },
  });
}

/**
 * 결제가 확정되지 못한 주문을 실패로 닫고 선점했던 재고를 되돌린다.
 * (승인 거절·금액 불일치·인증 실패 — 돈이 나가지 않은 경우)
 */
export async function failNicePayPayment(input: {
  paymentId: string;
  reason: string;
  raw?: string;
}): Promise<void> {
  const payment = await db.payment.findUnique({ where: { paymentId: input.paymentId } });
  if (!payment) return;

  const marked = await db.payment.updateMany({
    where: { paymentId: input.paymentId, status: { not: "PAID" } },
    data: { status: "FAILED", rawResponse: input.raw?.slice(0, 8000) ?? null },
  });

  if (marked.count === 0) {
    /*
     * 이미 PAID 다 — 우리가 "실패"라고 판단하는 사이 웹훅이 승인을 확정했다.
     * 여기서 취소하면 돈이 나간 주문을 닫는 꼴이라 아무것도 되돌리지 않고 남긴다.
     * (cancelOrderCore 도 돈이 나간 결제는 skip 으로 취소하지 않고 예외를 던진다 —
     *  그 예외가 returnUrl 을 500 으로 만들지 않게 여기서 먼저 걸러 둔다)
     */
    await audit({
      action: "PAYMENT_UNCERTAIN",
      target: "order",
      targetId: payment.orderId,
      summary: `주문 ${shortId(payment.orderId)} 실패 처리 중 웹훅이 먼저 승인 확정 — 취소하지 않음. 거래조회로 확인 필요 (${input.reason})`,
      meta: { paymentId: input.paymentId, reason: input.reason },
    });
    return;
  }

  // 재고·포인트 복원은 취소 공통 경로가 담당한다. PG 환불은 부르지 않는다 — 돈이 안 나갔다.
  await cancelOrderCore(payment.orderId, { by: "SYSTEM", reason: input.reason }, { skipPgRefund: true });
}

/**
 * 승인 결과를 알 수 없고 망취소도 실패한 경우.
 *
 * 돈이 나갔을 수도, 안 나갔을 수도 있다. 이때 재고를 풀거나 주문을 닫으면 둘 중
 * 한쪽이 틀린다. 그래서 **아무것도 되돌리지 않고** 주문을 결제대기로 둔 채 운영자에게
 * 눈에 띄게 알린다 — 거래조회로 확인한 뒤 사람이 확정하거나 취소한다.
 */
export async function markNicePayUncertain(input: { paymentId: string; detail: string }): Promise<void> {
  const payment = await db.payment.findUnique({ where: { paymentId: input.paymentId } });
  if (!payment) return;

  await db.payment.updateMany({
    where: { paymentId: input.paymentId, status: { not: "PAID" } },
    data: { status: "UNCERTAIN", rawResponse: input.detail.slice(0, 8000) },
  });
  await audit({
    action: "PAYMENT_UNCERTAIN",
    target: "order",
    targetId: payment.orderId,
    summary: `주문 ${shortId(payment.orderId)} 승인 결과 불명 — 망취소 실패. 나이스페이 거래조회 후 수동 처리 필요`,
    meta: { paymentId: input.paymentId, detail: input.detail.slice(0, 500) },
  });
}

/**
 * 나이스페이 **부분** 취소 수신 — 주문을 닫지 않는다.
 *
 * 예전엔 부분 취소도 전체 취소와 같은 길로 보내 주문을 CANCELED 로 만들고 재고를
 * 전부 되돌렸다(2026-09-11 리뷰). 50,000원 주문에서 1,000원만 돌려줬는데 장부는
 * 통째로 취소되고 손님은 49,000원을 낸 채 물건을 못 받는 상태가 된다.
 *
 * 우리 데이터 모델에는 부분 환불 상태가 없다. 자동으로 무언가를 바꾸면 어느 쪽이든
 * 틀리므로, 응답 전문을 남기고 감사로그로 운영자를 부른다. 주문·재고·포인트는 그대로.
 */
export async function markNicePayPartialCanceled(input: { paymentId: string; raw: string }): Promise<void> {
  const payment = await db.payment.findUnique({ where: { paymentId: input.paymentId } });
  if (!payment) return;

  // 전문은 남긴다 — 얼마가 돌아갔는지 나중에 여기서 읽는다. 상태는 건드리지 않는다.
  await db.payment.updateMany({
    where: { paymentId: input.paymentId },
    data: { rawResponse: input.raw.slice(0, 8000) },
  });
  await audit({
    action: "PAYMENT_PARTIAL_CANCEL",
    target: "order",
    targetId: payment.orderId,
    summary: `주문 ${shortId(payment.orderId)} 나이스페이에서 부분 취소됨 — 주문은 유지. 금액·재고를 사람이 맞춰야 합니다`,
    meta: { paymentId: input.paymentId },
  });
}

/**
 * 나이스페이 쪽에서 이미 **전체** 취소된 거래를 우리 DB 에 반영.
 * 가맹점관리자에서 사람이 직접 취소하면 이 경로로만 알 수 있다.
 * (부분 취소는 markNicePayPartialCanceled — 여기로 오면 안 된다)
 */
export async function markNicePayCanceled(input: { paymentId: string; raw: string }): Promise<void> {
  const payment = await db.payment.findUnique({ where: { paymentId: input.paymentId } });
  if (!payment) return;

  await db.payment.updateMany({
    where: { paymentId: input.paymentId, status: { not: "CANCELED" } },
    data: { status: "CANCELED", canceledAt: new Date(), rawResponse: input.raw.slice(0, 8000) },
  });

  // PG 는 이미 취소했다 — 다시 부르면 "이미 취소된 거래" 오류가 난다
  await cancelOrderCore(payment.orderId, { by: "PG", reason: "나이스페이에서 취소됨" }, { skipPgRefund: true });
}
