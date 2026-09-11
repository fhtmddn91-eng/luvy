/**
 * 결제 상세 표시 — 회귀 테스트.
 *
 * 실사례(2026-09-11 리뷰): 결제 상태 6개 중 4개가 영어 코드로 떴고, 수단은
 * 나이스페이가 주는 소문자 "card" 를 못 찾아 그대로 보였다. 위험한 두 상태
 * (환불 실패·승인 불명)는 뭘 해야 하는지까지 화면에 있어야 한다.
 */
import { describe, it, expect } from "vitest";
import {
  PAYMENT_STATUS,
  paymentStatusLabel,
  paymentStatusHint,
  paymentMethodName,
  parseNicePayReceipt,
  maskCardNum,
  installmentLabel,
} from "./paymentDetail";

describe("결제 상태 라벨 — 코드가 그대로 보이면 안 된다", () => {
  it("결제 흐름의 여섯 상태 전부 한글 라벨이 있다", () => {
    for (const s of ["READY", "PAID", "FAILED", "CANCELED", "CANCEL_FAILED", "UNCERTAIN"]) {
      expect(PAYMENT_STATUS[s], s).toBeDefined();
      expect(paymentStatusLabel(s)).not.toBe(s);
      expect(/^[A-Z_]+$/.test(paymentStatusLabel(s)), `${s} 라벨이 영어 코드`).toBe(false);
    }
  });

  /** 사람이 즉시 손을 써야 하는 두 상태 — 라벨만으로는 부족하다 */
  it("환불 실패·승인 불명은 해야 할 일(hint)이 붙어 있다", () => {
    expect(paymentStatusHint("CANCEL_FAILED")).toContain("환불 재시도");
    expect(paymentStatusHint("UNCERTAIN")).toContain("거래");
  });

  it("평상 상태에는 hint 가 없다 (경고를 남발하지 않게)", () => {
    expect(paymentStatusHint("PAID")).toBeUndefined();
    expect(paymentStatusHint("READY")).toBeUndefined();
  });

  it("모르는 상태는 코드를 그대로 보여주되 터지지 않는다", () => {
    expect(paymentStatusLabel("WHATEVER")).toBe("WHATEVER");
  });
});

describe("paymentMethodName — 나이스페이는 소문자로 준다", () => {
  it('"card" 는 신용카드', () => {
    expect(paymentMethodName("card")).toBe("신용카드");
    expect(paymentMethodName("CARD")).toBe("신용카드");
  });

  it("비어 있으면 대시, 모르는 값은 그대로 (undefined 금지)", () => {
    expect(paymentMethodName(null)).toBe("—");
    expect(paymentMethodName("")).toBe("—");
    expect(paymentMethodName("newthing")).toBe("newthing");
  });
});

/** 운영 실결제 1건의 응답 모양 그대로 (값은 가짜) */
const RAW = JSON.stringify({
  resultCode: "0000",
  tid: "UT0037039m01012609102052292299",
  orderId: "luvy-abc-1",
  status: "paid",
  paidAt: "2026-09-10T20:52:30.000+0900",
  cancelledAt: "0",
  payMethod: "card",
  amount: 4500,
  balanceAmt: 4500,
  approveNo: "30012345",
  receiptUrl: "https://npg.nicepay.co.kr/issue/IssueLoader.do?TID=UT0037039m01012609102052292299",
  card: { cardCode: "04", cardName: "신한", cardNum: "5310-****-****-1234", cardQuota: "00", cardType: "credit", acquCardName: "신한" },
});

describe("parseNicePayReceipt — 저장된 전문에서 화면에 쓸 것만", () => {
  it("카드사·카드번호·승인번호·할부·영수증·승인시각을 뽑는다", () => {
    const r = parseNicePayReceipt(RAW);
    expect(r.cardName).toBe("신한");
    expect(r.cardNum).toBe("5310-****-****-1234");
    expect(r.approveNo).toBe("30012345");
    expect(r.installment).toBe("00");
    expect(r.receiptUrl).toContain("https://npg.nicepay.co.kr");
    expect(r.paidAt?.toISOString()).toBe("2026-09-10T11:52:30.000Z");
    expect(r.cancelledAt).toBeNull(); // "0" 은 없음이다
    expect(r.balanceAmt).toBe(4500);
  });

  it("전문이 없거나 깨져 있어도 빈 영수증을 돌려준다", () => {
    for (const raw of [null, undefined, "", "not json", "[]", "42"]) {
      const r = parseNicePayReceipt(raw as string);
      expect(r.cardName).toBe("");
      expect(r.paidAt).toBeNull();
    }
  });

  /** 전문은 외부에서 온 값이다 — 아무 주소나 링크로 그리면 안 된다 */
  it("영수증 링크는 https 만 받는다", () => {
    const r = parseNicePayReceipt(JSON.stringify({ receiptUrl: "javascript:alert(1)" }));
    expect(r.receiptUrl).toBe("");
    expect(parseNicePayReceipt(JSON.stringify({ receiptUrl: "http://x" })).receiptUrl).toBe("");
  });

  it("card 가 없는 수단(가상계좌 등)도 터지지 않는다", () => {
    const r = parseNicePayReceipt(JSON.stringify({ payMethod: "vbank", approveNo: "1" }));
    expect(r.cardName).toBe("");
    expect(r.approveNo).toBe("1");
  });
});

describe("maskCardNum / installmentLabel", () => {
  it("이미 가려진 번호는 그대로", () => {
    expect(maskCardNum("5310-****-****-1234")).toBe("5310-****-****-1234");
  });

  it("맨 번호가 오면 앞 6·뒤 4만 남긴다 — 화면에 그대로 찍으면 안 된다", () => {
    expect(maskCardNum("5310123456781234")).toBe("531012******1234");
  });

  it("할부 표기", () => {
    expect(installmentLabel("00")).toBe("일시불");
    expect(installmentLabel("03")).toBe("3개월");
    expect(installmentLabel("")).toBe("일시불");
  });
});
