/**
 * returnUrl 라우트 — 돈이 실제로 움직이는 유일한 경로.
 *
 * 나이스페이 API 와 DB 를 전부 가짜로 두고, "어떤 상황에서 승인 API 가 불리는가 /
 * 안 불리는가 / 망취소가 불리는가" 를 못 박는다. 한 줄이라도 틀리면 이중 결제나
 * 돈만 나가고 주문이 없는 사고가 난다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { authSignature } from "@/lib/nicepaySign";

const SECRET = "test-secret";
const CLIENT = "test-client";
process.env.NICEPAY_SECRET_KEY = SECRET;
process.env.NICEPAY_CLIENT_KEY = CLIENT;

const api = {
  approvePayment: vi.fn(),
  netCancel: vi.fn(),
  cancelPayment: vi.fn(),
};
const orders = {
  settleNicePayPaid: vi.fn(),
  failNicePayPayment: vi.fn(),
  markNicePayUncertain: vi.fn(),
};
const findPayment = vi.fn();

vi.mock("@/lib/db", () => ({ db: { payment: { findUnique: (...a: unknown[]) => findPayment(...a) } } }));
vi.mock("@/lib/nicepay", () => ({
  NICEPAY_CLIENT_KEY: CLIENT,
  nicePaySecret: () => SECRET,
  approvePayment: (...a: unknown[]) => api.approvePayment(...a),
  netCancel: (...a: unknown[]) => api.netCancel(...a),
  cancelPayment: (...a: unknown[]) => api.cancelPayment(...a),
}));
vi.mock("@/lib/nicepayOrders", () => ({
  settleNicePayPaid: (...a: unknown[]) => orders.settleNicePayPaid(...a),
  failNicePayPayment: (...a: unknown[]) => orders.failNicePayPayment(...a),
  markNicePayUncertain: (...a: unknown[]) => orders.markNicePayUncertain(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { POST } = await import("./route");

const NP_ORDER = "luvy-ord1-1";
const AMOUNT = 132000;

function form(over: Record<string, string> = {}) {
  const base: Record<string, string> = {
    authResultCode: "0000",
    tid: "TID1",
    clientId: CLIENT,
    orderId: NP_ORDER,
    amount: String(AMOUNT),
    authToken: "TOK",
  };
  const p = { ...base, ...over };
  if (!("signature" in over)) p.signature = authSignature(p.authToken, p.clientId, Number(p.amount), SECRET);
  const body = new URLSearchParams(p).toString();
  return POST(
    new Request("https://luvyb2b.com/api/payments/nicepay/return", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }),
  );
}

const location = (res: Response) => new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search;

beforeEach(() => {
  for (const f of [...Object.values(api), ...Object.values(orders), findPayment]) f.mockReset();
  findPayment.mockResolvedValue({
    paymentId: NP_ORDER,
    orderId: "ord1",
    amount: AMOUNT,
    status: "READY",
    order: { status: "PENDING_PAYMENT" },
  });
  api.approvePayment.mockResolvedValue({ ok: true, body: { resultCode: "0000", amount: AMOUNT, payMethod: "card" }, raw: "{}" });
  orders.settleNicePayPaid.mockResolvedValue({ ok: true, orderId: "ord1", firstTime: true });
  api.netCancel.mockResolvedValue({ ok: true, body: {}, raw: "{}" });
  api.cancelPayment.mockResolvedValue({ ok: true, body: {}, raw: "{}" });
});

describe("redirect 주소 — 프록시 안쪽 주소로 보내면 안 된다", () => {
  it("Railway 뒤에서 req.url 이 localhost:8080 이어도 손님 주소(luvyb2b.com)로 보낸다", async () => {
    // 실사례(2026-09-07 운영): https://localhost:8080/checkout 으로 redirect 돼 죽은 페이지
    findPayment.mockResolvedValue(null);
    const res = await POST(
      new Request("http://localhost:8080/api/payments/nicepay/return", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-forwarded-host": "luvyb2b.com",
          "x-forwarded-proto": "https",
        },
        body: new URLSearchParams({ orderId: "luvy-nope-1" }).toString(),
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://luvyb2b.com/checkout?pay=invalid");
  });

  it("본문 없는 POST 는 500 이 아니라 주문서로 돌려보낸다", async () => {
    const res = await POST(new Request("https://luvyb2b.com/api/payments/nicepay/return", { method: "POST" }));
    expect(res.status).toBe(303);
    expect(location(res)).toBe("/checkout?pay=invalid");
    expect(api.approvePayment).not.toHaveBeenCalled();
  });
});

describe("정상 흐름", () => {
  it("인증 성공 → 승인 → 확정 → 완료 화면 (303)", async () => {
    const res = await form();
    expect(res.status).toBe(303);
    expect(location(res)).toBe("/checkout/complete?order=ord1");
    expect(api.approvePayment).toHaveBeenCalledWith("TID1", AMOUNT);
    expect(orders.settleNicePayPaid).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: NP_ORDER, tid: "TID1", amount: AMOUNT, source: "return" }),
    );
    expect(api.netCancel).not.toHaveBeenCalled();
  });
});

describe("승인 API 를 부르면 안 되는 경우 — 돈이 나가지 않아야 한다", () => {
  it("우리 결제 기록이 없으면 아무것도 하지 않는다", async () => {
    findPayment.mockResolvedValue(null);
    const res = await form();
    expect(location(res)).toBe("/checkout?pay=invalid");
    expect(api.approvePayment).not.toHaveBeenCalled();
    expect(orders.failNicePayPayment).not.toHaveBeenCalled();
  });

  it("이미 확정된 결제(새로고침·뒤로가기 재진입)는 완료 화면으로만 보낸다", async () => {
    findPayment.mockResolvedValue({ paymentId: NP_ORDER, orderId: "ord1", amount: AMOUNT, status: "PAID", order: { status: "PAID" } });
    const res = await form();
    expect(location(res)).toBe("/checkout/complete?order=ord1");
    expect(api.approvePayment).not.toHaveBeenCalled(); // 두 번 승인하면 이중 결제
  });

  it("결제대기가 아닌 주문(취소됨 등)은 승인하지 않는다", async () => {
    findPayment.mockResolvedValue({ paymentId: NP_ORDER, orderId: "ord1", amount: AMOUNT, status: "READY", order: { status: "CANCELED" } });
    const res = await form();
    expect(location(res)).toBe("/orders/ord1");
    expect(api.approvePayment).not.toHaveBeenCalled();
  });

  it("카드 인증 실패 코드면 실패 처리하고 주문서로 돌려보낸다", async () => {
    const res = await form({ authResultCode: "2001", authResultMsg: "한도 초과" });
    expect(location(res)).toBe(`/checkout?pay=failed&why=${encodeURIComponent("한도 초과")}`);
    expect(api.approvePayment).not.toHaveBeenCalled();
    expect(orders.failNicePayPayment).toHaveBeenCalledWith(expect.objectContaining({ paymentId: NP_ORDER }));
  });

  it("금액이 변조되면 서명이 맞아도 승인하지 않는다", async () => {
    // 공격자가 amount 를 100 으로 바꾸고 그 기준으로 서명을 다시 만든 경우
    const res = await form({ amount: "100", signature: authSignature("TOK", CLIENT, 100, SECRET) });
    expect(location(res)).toContain("/checkout?pay=failed");
    expect(api.approvePayment).not.toHaveBeenCalled();
    expect(orders.failNicePayPayment).toHaveBeenCalled();
  });

  it("서명이 틀리면 승인하지 않는다", async () => {
    const res = await form({ signature: "0".repeat(64) });
    expect(location(res)).toContain("/checkout?pay=failed");
    expect(api.approvePayment).not.toHaveBeenCalled();
  });

  it("폼의 orderId 로 결제 기록을 찾는다 — 다른 주문번호를 넣으면 그 주문의 금액·상태로 검증된다", async () => {
    // 나이스페이 서명은 authToken+clientId+amount 만 덮는다(orderId 가 없다). 그래서 주문을
    // 바꿔치기해도 막는 건 "그 주문의 저장 금액과 다르다" 와 "결제대기가 아니다" 두 관문이다.
    findPayment.mockResolvedValue({ paymentId: "luvy-other-1", orderId: "other", amount: 999, status: "READY", order: { status: "PENDING_PAYMENT" } });
    const res = await form({ orderId: "luvy-other-1" });
    expect(findPayment).toHaveBeenCalledWith(expect.objectContaining({ where: { paymentId: "luvy-other-1" } }));
    expect(location(res)).toContain("/checkout?pay=failed"); // 132000 ≠ 999
    expect(api.approvePayment).not.toHaveBeenCalled();
  });
});

describe("승인 결과별 처리", () => {
  it("승인 거절이면 실패 처리 — 망취소는 부르지 않는다 (돈이 안 나갔다)", async () => {
    api.approvePayment.mockResolvedValue({ ok: false, kind: "declined", code: "3001", message: "카드사 거절", raw: "{}" });
    const res = await form();
    expect(location(res)).toBe(`/checkout?pay=failed&why=${encodeURIComponent("카드사 거절")}`);
    expect(orders.failNicePayPayment).toHaveBeenCalledWith(expect.objectContaining({ reason: expect.stringContaining("3001") }));
    expect(api.netCancel).not.toHaveBeenCalled();
    expect(orders.settleNicePayPaid).not.toHaveBeenCalled();
  });

  it("승인 응답을 못 받으면 **재시도가 아니라 망취소** 한다", async () => {
    api.approvePayment.mockResolvedValue({ ok: false, kind: "unknown", code: "NETWORK", message: "timeout" });
    const res = await form();
    expect(api.approvePayment).toHaveBeenCalledTimes(1); // 두 번 부르면 이중 결제
    expect(api.netCancel).toHaveBeenCalledWith(NP_ORDER);
    expect(orders.failNicePayPayment).toHaveBeenCalled();
    expect(location(res)).toContain("/checkout?pay=failed");
  });

  it("망취소까지 실패하면 아무것도 되돌리지 않고 '불명' 으로 남긴다", async () => {
    api.approvePayment.mockResolvedValue({ ok: false, kind: "unknown", code: "NETWORK", message: "timeout" });
    api.netCancel.mockResolvedValue({ ok: false, kind: "declined", code: "9999", message: "만료" });
    const res = await form();
    expect(orders.failNicePayPayment).not.toHaveBeenCalled(); // 재고를 풀면 안 된다
    expect(orders.settleNicePayPaid).not.toHaveBeenCalled(); // 확정해도 안 된다
    expect(orders.markNicePayUncertain).toHaveBeenCalledWith(expect.objectContaining({ paymentId: NP_ORDER }));
    expect(location(res)).toBe("/orders/ord1?pay=uncertain");
  });

  it("승인은 됐는데 응답 금액이 다르면 즉시 취소하고 실패 처리한다", async () => {
    api.approvePayment.mockResolvedValue({ ok: true, body: { resultCode: "0000", amount: 100 }, raw: "{}" });
    const res = await form();
    expect(api.cancelPayment).toHaveBeenCalledWith("TID1", expect.objectContaining({ orderId: NP_ORDER }));
    expect(orders.settleNicePayPaid).not.toHaveBeenCalled();
    expect(orders.failNicePayPayment).toHaveBeenCalled();
    expect(location(res)).toContain("/checkout?pay=failed");
  });

  it("확정 단계가 거부하면(닫힌 주문 등) 주문 상세로 보내고 사유를 붙인다", async () => {
    orders.settleNicePayPaid.mockResolvedValue({ ok: false, code: "ORDER_CLOSED", message: "닫힌 주문" });
    const res = await form();
    expect(location(res)).toBe("/orders/ord1?pay=ORDER_CLOSED");
  });
});
