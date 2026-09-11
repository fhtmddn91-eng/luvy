/**
 * 나이스페이 웹훅 라우트.
 *
 * 이 라우트는 서명이 틀려도 **200 OK** 를 준다(등록 검증 호출이 서명 없는 표본
 * 전문으로 오기 때문 — 실측 2026-09-07 401 로 등록 실패). 그래서 유일한 방어선은
 * **"검증을 통과한 전문만 처리 함수까지 간다"** 는 것이다. 이 파일이 그걸 지킨다.
 *
 * 이게 깨지면 아무나 POST 한 방으로 "이 주문 결제됐다"를 만들어 물건을 받아 간다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { webhookSignature } from "@/lib/nicepaySign";

const SECRET = "test-secret";
process.env.NICEPAY_SECRET_KEY = SECRET;
process.env.NICEPAY_CLIENT_KEY = "test-client";

const settle = vi.fn();
const markCanceled = vi.fn();
const markPartial = vi.fn();
const findPayment = vi.fn();

vi.mock("@/lib/db", () => ({ db: { payment: { findUnique: (...a: unknown[]) => findPayment(...a) } } }));
vi.mock("@/lib/nicepayOrders", () => ({
  settleNicePayPaid: (...a: unknown[]) => settle(...a),
  markNicePayCanceled: (...a: unknown[]) => markCanceled(...a),
  markNicePayPartialCanceled: (...a: unknown[]) => markPartial(...a),
}));

const { POST, GET } = await import("./route");

const EDI = "2026-09-07T01:02:03.000Z";
const post = (body: string) =>
  POST(new Request("https://x/api/payments/nicepay/webhook", { method: "POST", body }));

const signed = (over: Record<string, unknown> = {}) => {
  const base = { tid: "T1", orderId: "luvy-ord1-1", amount: 132000, ediDate: EDI, status: "paid" };
  const p = { ...base, ...over };
  return JSON.stringify({
    ...p,
    signature: webhookSignature(String(p.tid), Number(p.amount), String(p.ediDate), SECRET),
  });
};

beforeEach(() => {
  settle.mockReset().mockResolvedValue({ ok: true });
  markCanceled.mockReset().mockResolvedValue(undefined);
  markPartial.mockReset().mockResolvedValue(undefined);
  findPayment.mockReset().mockResolvedValue({ paymentId: "luvy-ord1-1", orderId: "ord1", amount: 132000 });
});

describe("등록 검증 호출은 통과시킨다", () => {
  it("GET 은 200 + text/html + 본문 OK", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html;charset=utf-8");
    expect(await res.text()).toBe("OK");
  });

  it("빈 본문 POST 도 200 OK", async () => {
    const res = await post("");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(settle).not.toHaveBeenCalled();
  });

  it("서명 없는 표본 전문도 200 OK — 401 을 주면 웹훅 등록이 실패한다", async () => {
    const res = await post(JSON.stringify({ tid: "T1", orderId: "x", amount: 1000, status: "paid" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  it("JSON 이 아니어도 200 OK", async () => {
    const res = await post("not json");
    expect(res.status).toBe(200);
  });
});

describe("검증을 통과한 전문만 처리된다 — 이게 유일한 방어선", () => {
  it("서명 없는 '결제됐다' 전문은 처리 함수까지 가지 않는다", async () => {
    await post(JSON.stringify({ tid: "T1", orderId: "luvy-ord1-1", amount: 132000, ediDate: EDI, status: "paid" }));
    expect(settle).not.toHaveBeenCalled();
    expect(markCanceled).not.toHaveBeenCalled();
  });

  it("서명이 틀린 전문도 처리되지 않는다", async () => {
    const body = JSON.stringify({
      tid: "T1", orderId: "luvy-ord1-1", amount: 132000, ediDate: EDI, status: "paid",
      signature: "0".repeat(64),
    });
    await post(body);
    expect(settle).not.toHaveBeenCalled();
  });

  it("다른 시크릿으로 만든 서명은 처리되지 않는다", async () => {
    const body = JSON.stringify({
      tid: "T1", orderId: "luvy-ord1-1", amount: 132000, ediDate: EDI, status: "paid",
      signature: webhookSignature("T1", 132000, EDI, "다른키"),
    });
    await post(body);
    expect(settle).not.toHaveBeenCalled();
  });

  it("금액만 바꾸면 서명이 깨져 처리되지 않는다", async () => {
    // 서명은 tid+amount+ediDate 로 만들어지므로 금액을 손대면 자동으로 어긋난다
    const body = signed().replace('"amount":132000', '"amount":100');
    await post(body);
    expect(settle).not.toHaveBeenCalled();
  });

  it("정상 서명 + 결제 완료 전문은 확정 처리로 넘어간다", async () => {
    const res = await post(signed());
    expect(res.status).toBe(200);
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: "luvy-ord1-1", tid: "T1", amount: 132000, source: "webhook" }),
    );
  });

  it("취소 전문은 취소 반영으로 넘어간다", async () => {
    await post(signed({ status: "cancelled" }));
    expect(markCanceled).toHaveBeenCalledWith(expect.objectContaining({ paymentId: "luvy-ord1-1" }));
    expect(settle).not.toHaveBeenCalled();
  });

  it("우리가 만든 적 없는 주문은 조용히 받아넘긴다", async () => {
    findPayment.mockResolvedValue(null);
    const res = await post(signed());
    expect(res.status).toBe(200);
    expect(settle).not.toHaveBeenCalled();
  });

  it("모르는 상태값은 아무것도 하지 않는다", async () => {
    await post(signed({ status: "ready" }));
    expect(settle).not.toHaveBeenCalled();
    expect(markCanceled).not.toHaveBeenCalled();
  });
});

describe("우리 쪽 저장이 실패하면 재전송을 받는다", () => {
  it("처리 중 예외가 나면 500 — 200 을 주면 이 사건이 영영 사라진다", async () => {
    settle.mockRejectedValue(new Error("db down"));
    const res = await post(signed());
    expect(res.status).toBe(500);
  });
});

/**
 * 부분 취소는 전체 취소가 아니다.
 *
 * 실사례(2026-09-11 리뷰): partialcancelled 가 전체 취소와 같은 함수로 갔다. 50,000원
 * 주문에서 1,000원만 돌려줘도 주문이 CANCELED 가 되고 재고가 통째로 돌아왔다 —
 * 손님은 49,000원을 낸 채 물건을 못 받는다. 부분 취소는 사람을 부르는 길로만 간다.
 */
describe("부분 취소는 주문을 닫지 않는다", () => {
  it("partialcancelled 는 부분 취소 처리로 가고, 전체 취소 처리는 부르지 않는다", async () => {
    const res = await post(signed({ status: "partialcancelled" }));
    expect(res.status).toBe(200);
    expect(markPartial).toHaveBeenCalledTimes(1);
    expect(markCanceled).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it("전체 취소(cancelled)는 여전히 전체 취소 처리로 간다", async () => {
    await post(signed({ status: "cancelled" }));
    expect(markCanceled).toHaveBeenCalledTimes(1);
    expect(markPartial).not.toHaveBeenCalled();
  });

  it("서명이 틀린 부분 취소 전문은 처리되지 않는다", async () => {
    const body = JSON.parse(signed({ status: "partialcancelled" }));
    body.signature = "0".repeat(64);
    const res = await post(JSON.stringify(body));
    expect(res.status).toBe(200);
    expect(markPartial).not.toHaveBeenCalled();
  });
});
