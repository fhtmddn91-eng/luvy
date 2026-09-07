import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  authSignature,
  approveSignData,
  cancelSignData,
  netCancelSignData,
  webhookSignature,
  signatureMatches,
  checkAuthResult,
  checkWebhook,
  nicePayOrderId,
  safeGoodsName,
  ediDateNow,
} from "./nicepaySign";

const SECRET = "test-secret-key";
const CLIENT = "R2_testclientkey";
const hex = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

describe("서명 계산식 — 매뉴얼과 자리 순서가 같아야 한다", () => {
  it("returnUrl signature = sha256(authToken + clientId + amount + SecretKey)", () => {
    expect(authSignature("tok", "cid", 1000, SECRET)).toBe(hex(`tokcid1000${SECRET}`));
  });

  it("승인 signData = sha256(tid + amount + ediDate + SecretKey)", () => {
    expect(approveSignData("T1", 1000, "D1", SECRET)).toBe(hex(`T11000D1${SECRET}`));
  });

  it("취소 signData = sha256(tid + ediDate + SecretKey)", () => {
    expect(cancelSignData("T1", "D1", SECRET)).toBe(hex(`T1D1${SECRET}`));
  });

  it("망취소 signData = sha256(orderId + ediDate + SecretKey)", () => {
    expect(netCancelSignData("O1", "D1", SECRET)).toBe(hex(`O1D1${SECRET}`));
  });

  it("웹훅 signature = sha256(tid + amount + ediDate + SecretKey)", () => {
    expect(webhookSignature("T1", 1000, "D1", SECRET)).toBe(hex(`T11000D1${SECRET}`));
  });

  it("자리 순서를 섞으면 값이 달라진다 (순서를 못 박는 테스트)", () => {
    // 승인과 취소는 amount 유무로 갈린다 — 실수로 같은 식을 쓰면 승인이 통째로 거절된다
    expect(approveSignData("T1", 1000, "D1", SECRET)).not.toBe(cancelSignData("T1", "D1", SECRET));
    expect(authSignature("a", "b", 1, SECRET)).not.toBe(authSignature("b", "a", 1, SECRET));
  });

  it("ediDate 는 ISO 8601", () => {
    expect(ediDateNow(new Date("2026-09-07T01:02:03.000Z"))).toBe("2026-09-07T01:02:03.000Z");
  });
});

describe("signatureMatches", () => {
  it("같으면 true, 다르면 false", () => {
    expect(signatureMatches("abc", "abc")).toBe(true);
    expect(signatureMatches("abc", "abd")).toBe(false);
  });

  it("길이가 다르면 예외 없이 false (timingSafeEqual 은 길이가 다르면 throw 한다)", () => {
    expect(signatureMatches("abc", "ab")).toBe(false);
    expect(signatureMatches("abc", "")).toBe(false);
    expect(signatureMatches("abc", undefined as unknown as string)).toBe(false);
  });
});

describe("checkAuthResult — 승인 API 를 부르기 전 관문", () => {
  const ctx = { clientKey: CLIENT, secretKey: SECRET, expectedAmount: 132000, expectedOrderId: "luvy-ord1-1" };
  const good = () => {
    const amount = 132000;
    return {
      authResultCode: "0000",
      tid: "T123",
      clientId: CLIENT,
      orderId: "luvy-ord1-1",
      amount: String(amount),
      authToken: "TOK",
      signature: authSignature("TOK", CLIENT, amount, SECRET),
    };
  };

  it("정상 전문은 통과한다", () => {
    expect(checkAuthResult(good(), ctx)).toEqual({ ok: true, tid: "T123", amount: 132000, authToken: "TOK" });
  });

  it("인증 실패 코드는 거부하고 사유 문구를 넘긴다", () => {
    const r = checkAuthResult({ ...good(), authResultCode: "2001", authResultMsg: "한도 초과" }, ctx);
    expect(r).toEqual({ ok: false, code: "AUTH_2001", message: "한도 초과" });
  });

  it("인증 코드가 없으면 거부한다", () => {
    expect(checkAuthResult({}, ctx)).toMatchObject({ ok: false, code: "AUTH_EMPTY" });
  });

  it("금액이 변조되면 거부한다 — 서명을 새로 만들어 와도 막힌다", () => {
    // 공격 시나리오: 브라우저에서 amount 를 100 으로 바꾸고 서명도 100 기준으로 다시 만든다.
    // 우리 DB 의 금액과 대조하므로 서명이 맞아도 통과하지 못한다.
    const forged = { ...good(), amount: "100", signature: authSignature("TOK", CLIENT, 100, SECRET) };
    expect(checkAuthResult(forged, ctx)).toMatchObject({ ok: false, code: "AUTH_AMOUNT_MISMATCH" });
  });

  it("금액 형식이 숫자가 아니면 거부한다", () => {
    for (const amount of ["", "1000원", " 132000", "1.5e5", "-100", "abc"]) {
      expect(checkAuthResult({ ...good(), amount }, ctx), amount).toMatchObject({
        ok: false,
        code: "AUTH_AMOUNT_FORMAT",
      });
    }
  });

  it("다른 주문의 결과를 끼워 넣으면 거부한다", () => {
    expect(checkAuthResult({ ...good(), orderId: "luvy-other-1" }, ctx)).toMatchObject({
      ok: false,
      code: "AUTH_ORDER_MISMATCH",
    });
  });

  it("우리 가맹점이 아닌 clientId 는 거부한다", () => {
    expect(checkAuthResult({ ...good(), clientId: "someone-else" }, ctx)).toMatchObject({
      ok: false,
      code: "AUTH_CLIENT_MISMATCH",
    });
  });

  it("서명이 틀리면 거부한다", () => {
    expect(checkAuthResult({ ...good(), signature: "0".repeat(64) }, ctx)).toMatchObject({
      ok: false,
      code: "AUTH_SIGNATURE",
    });
  });

  it("필수 항목이 비면 거부한다", () => {
    for (const key of ["tid", "authToken", "signature", "clientId"] as const) {
      const p = { ...good(), [key]: undefined };
      expect(checkAuthResult(p, ctx), key).toMatchObject({ ok: false, code: "AUTH_MISSING_FIELD" });
    }
  });
});

describe("checkWebhook — 공개 주소로 들어오는 전문", () => {
  const good = () => ({
    resultCode: "0000",
    tid: "T123",
    orderId: "luvy-ord1-1",
    amount: 132000,
    status: "paid",
    ediDate: "2026-09-07T01:02:03.000Z",
    signature: webhookSignature("T123", 132000, "2026-09-07T01:02:03.000Z", SECRET),
  });

  it("정상 전문은 통과한다", () => {
    expect(checkWebhook(good(), SECRET)).toEqual({
      ok: true,
      tid: "T123",
      orderId: "luvy-ord1-1",
      amount: 132000,
      status: "paid",
    });
  });

  it("서명 없는 가짜 '결제됐다' 전문은 거부한다", () => {
    // 이걸 안 막으면 아무나 POST 한 방으로 물건을 받아 간다
    expect(checkWebhook({ ...good(), signature: "0".repeat(64) }, SECRET)).toMatchObject({
      ok: false,
      code: "HOOK_SIGNATURE",
    });
    expect(checkWebhook({ ...good(), signature: undefined }, SECRET)).toMatchObject({
      ok: false,
      code: "HOOK_MISSING_FIELD",
    });
  });

  it("금액이 문자열로 와도 받아준다", () => {
    const p = { ...good(), amount: "132000" };
    expect(checkWebhook(p, SECRET)).toMatchObject({ ok: true, amount: 132000 });
  });

  it("금액 형식이 이상하면 거부한다", () => {
    expect(checkWebhook({ ...good(), amount: "132,000" }, SECRET)).toMatchObject({
      ok: false,
      code: "HOOK_AMOUNT_FORMAT",
    });
  });

  it("다른 시크릿으로 만든 서명은 거부한다", () => {
    expect(checkWebhook(good(), "다른키")).toMatchObject({ ok: false, code: "HOOK_SIGNATURE" });
  });
});

describe("주문번호·상품명", () => {
  it("시도마다 다른 주문번호를 만든다 (나이스페이는 재호출을 거부한다)", () => {
    expect(nicePayOrderId("ord1", 1)).toBe("luvy-ord1-1");
    expect(nicePayOrderId("ord1", 2)).toBe("luvy-ord1-2");
    expect(nicePayOrderId("ord1", 1)).not.toBe(nicePayOrderId("ord1", 2));
  });

  it("주문번호는 64byte 를 넘지 않는다", () => {
    expect(nicePayOrderId("c".repeat(25), 99).length).toBeLessThanOrEqual(64);
  });

  it("상품명의 금지 문자(\" 와 |)를 바꾼다", () => {
    expect(safeGoodsName('페탈"진동기|세트')).toBe("페탈-진동기-세트");
  });

  it("상품명을 길이 제한으로 자른다", () => {
    expect(safeGoodsName("가".repeat(100)).length).toBe(40);
  });
});
