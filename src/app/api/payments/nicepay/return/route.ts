import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { checkAuthResult } from "@/lib/nicepaySign";
import { NICEPAY_CLIENT_KEY, nicePaySecret, approvePayment, netCancel, cancelPayment } from "@/lib/nicepay";
import { settleNicePayPaid, failNicePayPayment, markNicePayUncertain } from "@/lib/nicepayOrders";

/**
 * 나이스페이 returnUrl — 결제창 인증이 끝나면 나이스페이가 손님 브라우저를 통해
 * 여기로 POST 한다. **돈은 아직 안 나갔다.** 여기서 우리가 승인 API 를 불러야 빠진다.
 *
 * 순서가 곧 안전장치다:
 *   1. 우리 결제 기록 찾기 (없으면 아무것도 하지 않는다)
 *   2. 이미 확정된 건이면 완료 화면으로 (새로고침·뒤로가기 재진입)
 *   3. 인증 결과 검증 — 인증 성공·주문 일치·**우리 DB 금액과 일치**·서명 일치
 *   4. 승인 API — 여기서 돈이 나간다
 *   5. 승인 응답 금액 재대조 → 확정
 *   6. 승인 응답을 못 받았으면 **망취소** (재시도 아님 — 승인은 멱등이 아니다)
 *   7. 망취소도 실패하면 아무것도 되돌리지 않고 운영자에게 알린다
 *
 * 응답은 전부 303 redirect — POST 로 들어온 요청을 GET 화면으로 보낸다.
 */
export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const p: Record<string, string> = {};
  for (const [k, v] of form.entries()) p[k] = String(v);

  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  const failed = (why: string) => to(`/checkout?pay=failed&why=${encodeURIComponent(why)}`);

  const npOrderId = p.orderId ?? "";
  if (!npOrderId) return to("/checkout?pay=invalid");

  const payment = await db.payment.findUnique({ where: { paymentId: npOrderId }, include: { order: true } });
  if (!payment) return to("/checkout?pay=invalid");
  const orderId = payment.orderId;

  if (payment.status === "PAID") return to(`/checkout/complete?order=${orderId}`);
  if (payment.order.status !== "PENDING_PAYMENT") return to(`/orders/${orderId}`);

  const check = checkAuthResult(p, {
    clientKey: NICEPAY_CLIENT_KEY,
    secretKey: nicePaySecret(),
    expectedAmount: payment.amount,
    expectedOrderId: npOrderId,
  });
  if (!check.ok) {
    // 인증 단계 실패 — 돈은 안 나갔다. 재고를 풀고 손님을 주문서로 돌려보낸다.
    await failNicePayPayment({ paymentId: npOrderId, reason: `카드 인증 실패 (${check.code})`, raw: JSON.stringify(p) });
    return failed(check.message);
  }

  const approval = await approvePayment(check.tid, check.amount);

  if (approval.ok) {
    const approvedAmount = approval.body.amount;
    if (typeof approvedAmount === "number" && approvedAmount !== check.amount) {
      // 요청과 다른 금액이 승인됐다 — 있어선 안 되는 일이지만, 있으면 즉시 되돌린다
      await cancelPayment(check.tid, { reason: "승인 금액 불일치 — 자동 취소", orderId: npOrderId });
      await failNicePayPayment({ paymentId: npOrderId, reason: "승인 금액 불일치", raw: approval.raw });
      return failed("결제 금액이 일치하지 않아 취소했습니다. 다시 시도해주세요.");
    }

    const settled = await settleNicePayPaid({
      paymentId: npOrderId,
      tid: check.tid,
      amount: check.amount,
      raw: approval.raw,
      source: "return",
      method: approval.body.payMethod ?? null,
    });
    if (settled.ok) {
      revalidatePath("/", "layout");
      return to(`/checkout/complete?order=${orderId}`);
    }
    return to(`/orders/${orderId}?pay=${encodeURIComponent(settled.code)}`);
  }

  if (approval.kind === "declined") {
    // 나이스페이가 명확히 거절했다 — 돈은 안 나갔다
    await failNicePayPayment({ paymentId: npOrderId, reason: `승인 거절 (${approval.code})`, raw: approval.raw });
    return failed(approval.message);
  }

  // 응답을 못 받았다 — 승인됐을 수도 있다. 다시 부르면 이중 결제. 망취소로 없던 일로 만든다.
  const nc = await netCancel(npOrderId);
  if (nc.ok) {
    await failNicePayPayment({ paymentId: npOrderId, reason: `승인 응답 유실 → 망취소 완료 (${approval.code})` });
    return failed("결제가 완료되지 않았습니다. 다시 시도해주세요.");
  }

  // 망취소까지 실패 — 돈이 나갔는지 모른다. 재고를 풀면 안 되고, 주문을 닫아도 안 된다.
  await markNicePayUncertain({
    paymentId: npOrderId,
    detail: `approve:${approval.code} ${approval.message} / netcancel:${nc.code} ${nc.message}`,
  });
  return to(`/orders/${orderId}?pay=uncertain`);
}
