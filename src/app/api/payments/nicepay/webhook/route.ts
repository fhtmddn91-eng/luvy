import { db } from "@/lib/db";
import { checkWebhook } from "@/lib/nicepaySign";
import { nicePaySecret } from "@/lib/nicepay";
import { settleNicePayPaid, markNicePayCanceled, markNicePayPartialCanceled } from "@/lib/nicepayOrders";

/**
 * 나이스페이 웹훅(노티) 수신.
 *
 * 응답 규칙이 까다롭다 — 매뉴얼: **HTTP 200 + Content-Type text/html + 본문 "OK"**.
 * 셋 중 하나라도 어긋나면 나이스페이가 실패로 보고 계속 재전송한다. JSON 을 돌려주던
 * 예전 포트원 라우트를 그대로 두면 재전송이 쌓인다.
 *
 * 웹훅이 필요한 이유(승인 경로가 따로 있는데도):
 *  · 승인 API 응답을 못 받아 우리가 "실패"로 처리한 거래가 실제로는 승인된 경우
 *  · 나이스페이 가맹점관리자에서 사람이 직접 취소한 경우 — 우리 DB 는 모른다
 *
 * 언제 200 OK 를 주는가: **더 볼 것이 없을 때만**. 우리 DB 쓰기가 실패하면
 * 일부러 500 을 줘서 나이스페이가 다시 보내게 한다(그게 재전송의 목적이다).
 */

const OK = () =>
  new Response("OK", { status: 200, headers: { "Content-Type": "text/html;charset=utf-8" } });

/**
 * 등록 검증용. 나이스페이 관리자에서 End-point 를 등록할 때 이 주소를 찔러
 * 200 이 아니면 등록이 거부된다. 어떤 메서드로 오는지 보장이 없어 GET·HEAD 도 200 을 준다.
 */
export async function GET(): Promise<Response> {
  return OK();
}

export async function HEAD(): Promise<Response> {
  return OK();
}

export async function POST(req: Request): Promise<Response> {
  const secret = nicePaySecret();
  // 키가 없으면 검증 자체를 할 수 없다. 등록 검증은 통과시키되 아무것도 처리하지 않는다.
  if (!secret) return OK();

  const raw = await req.text();
  if (!raw.trim()) return OK(); // 빈 본문 = 등록 검증 호출

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.warn("[nicepay webhook] JSON 아님 — 무시");
    return OK();
  }

  const checked = checkWebhook(payload, secret);
  if (!checked.ok) {
    /**
     * 서명이 안 맞아도 **200 OK 를 준다**. 응답 코드는 "받았다"는 인사일 뿐이고,
     * 실제 방어는 아래 처리 로직을 건너뛰는 것이다.
     *
     * 실측(2026-09-07): 여기서 401 을 줬더니 나이스페이 가맹점관리자의 웹훅 등록이
     * "401 Unauthorized" 로 실패했다 — 등록 검증 호출이 **서명 없는 표본 전문**으로
     * 오기 때문이다. 등록을 못 하면 웹훅 자체가 없는 것과 같다.
     * 인증 실패를 응답 코드로 알릴 상대도 없다(공격자에게 알려줄 이유가 없다).
     */
    console.warn(`[nicepay webhook] 검증 실패(${checked.code}) — 처리하지 않음`);
    return OK();
  }

  // paymentId 는 우리가 채번한 나이스페이 주문번호(luvy-<orderId>-<n>)다
  const payment = await db.payment.findUnique({ where: { paymentId: checked.orderId } });
  if (!payment) {
    // 우리가 만든 적 없는 거래 — 재전송받아도 달라지지 않으니 조용히 받아넘긴다
    return OK();
  }

  try {
    const status = (checked.status || "").toLowerCase();
    if (status === "paid") {
      await settleNicePayPaid({
        paymentId: checked.orderId,
        tid: checked.tid,
        amount: checked.amount,
        raw,
        source: "webhook",
      });
    } else if (status === "cancelled" || status === "canceled") {
      await markNicePayCanceled({ paymentId: checked.orderId, raw });
    } else if (status === "partialcancelled") {
      // 부분 취소는 주문을 닫지 않는다 — 전체 취소와 같은 길로 보내면 재고가 통째로 돌아간다
      await markNicePayPartialCanceled({ paymentId: checked.orderId, raw });
    }
  } catch {
    // DB 쓰기 실패 — 여기서 OK 를 주면 이 사건이 영영 사라진다. 재전송을 받는다.
    return new Response("RETRY", { status: 500, headers: { "Content-Type": "text/html;charset=utf-8" } });
  }

  return OK();
}
