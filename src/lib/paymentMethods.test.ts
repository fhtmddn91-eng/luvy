import { describe, it, expect } from "vitest";
import {
  PAYMENT_METHODS,
  readyMethods,
  isSelectableMethod,
  paymentMethodLabel,
} from "./paymentMethods";

describe("paymentMethods", () => {
  it("주문서에 세 가지 수단이 모두 노출된다", () => {
    expect(PAYMENT_METHODS.map((m) => m.value)).toEqual([
      "BANK_TRANSFER",
      "NICEPAY",
      "NHN_KCP",
    ]);
  });

  it("PG 연동 전에는 무통장입금만 고를 수 있다", () => {
    expect(readyMethods().map((m) => m.value)).toEqual(["BANK_TRANSFER"]);
  });

  // 화면에서 disabled 여도 폼 값은 조작 가능하므로 서버 판정이 최종 방어선이다
  it("준비 중인 PG는 값을 직접 넣어도 거부한다", () => {
    expect(isSelectableMethod("NICEPAY")).toBe(false);
    expect(isSelectableMethod("NHN_KCP")).toBe(false);
  });

  it("모르는 값·빈 값은 거부한다", () => {
    expect(isSelectableMethod("")).toBe(false);
    expect(isSelectableMethod("FREE_MONEY")).toBe(false);
  });

  it("고를 수 있는 수단은 통과한다", () => {
    expect(isSelectableMethod("BANK_TRANSFER")).toBe(true);
  });

  it("관리자 표기는 라벨로, 모르는 값은 값 그대로", () => {
    expect(paymentMethodLabel("BANK_TRANSFER")).toBe("무통장 입금");
    expect(paymentMethodLabel("LEGACY")).toBe("LEGACY");
  });

  it("ready 를 켜면 별도 수정 없이 선택 가능해진다", () => {
    // 연동 완료 시 실제로 하게 될 변경을 그대로 흉내낸다
    const kcp = PAYMENT_METHODS.find((m) => m.value === "NHN_KCP")!;
    kcp.ready = true;
    try {
      expect(isSelectableMethod("NHN_KCP")).toBe(true);
      expect(readyMethods().map((m) => m.value)).toContain("NHN_KCP");
    } finally {
      kcp.ready = false;
    }
  });
});
