import { describe, it, expect } from "vitest";
import {
  PAYMENT_METHODS,
  readyMethods,
  isSelectableMethod,
  paymentMethodLabel,
  NO_AVAILABILITY,
} from "./paymentMethods";

const withNicePay = { nicepay: true };

describe("paymentMethods", () => {
  it("주문서에 세 가지 수단이 모두 노출된다", () => {
    expect(PAYMENT_METHODS.map((m) => m.value)).toEqual(["BANK_TRANSFER", "NICEPAY", "NHN_KCP"]);
  });

  it("키가 하나도 없으면 무통장입금만 고를 수 있다", () => {
    expect(readyMethods(NO_AVAILABILITY).map((m) => m.value)).toEqual(["BANK_TRANSFER"]);
    expect(readyMethods().map((m) => m.value)).toEqual(["BANK_TRANSFER"]);
  });

  it("나이스페이 키가 있으면 신용카드가 열린다 — 코드 수정 없이 환경변수만으로", () => {
    expect(readyMethods(withNicePay).map((m) => m.value)).toEqual(["BANK_TRANSFER", "NICEPAY"]);
    expect(isSelectableMethod("NICEPAY", withNicePay)).toBe(true);
  });

  it("키가 빠지면 신용카드는 자동으로 닫힌다 — Railway 변수만 지우면 끊긴다", () => {
    expect(isSelectableMethod("NICEPAY", NO_AVAILABILITY)).toBe(false);
    expect(isSelectableMethod("NICEPAY")).toBe(false);
  });

  // 화면에서 disabled 여도 폼 값은 조작 가능하므로 서버 판정이 최종 방어선이다
  it("코드가 없는 PG는 키 여부와 무관하게 거부한다", () => {
    expect(isSelectableMethod("NHN_KCP", withNicePay)).toBe(false);
    expect(isSelectableMethod("NHN_KCP")).toBe(false);
  });

  it("모르는 값·빈 값은 거부한다", () => {
    expect(isSelectableMethod("", withNicePay)).toBe(false);
    expect(isSelectableMethod("FREE_MONEY", withNicePay)).toBe(false);
  });

  it("무통장은 항상 열려 있다", () => {
    expect(isSelectableMethod("BANK_TRANSFER")).toBe(true);
    expect(isSelectableMethod("BANK_TRANSFER", withNicePay)).toBe(true);
  });

  it("관리자 표기는 라벨로, 모르는 값은 값 그대로", () => {
    expect(paymentMethodLabel("BANK_TRANSFER")).toBe("무통장 입금");
    expect(paymentMethodLabel("NICEPAY")).toBe("신용카드 결제");
    expect(paymentMethodLabel("LEGACY")).toBe("LEGACY");
  });
});
