import { describe, it, expect } from "vitest";
import {
  MAX_DISCOUNT_BP,
  effectiveDiscountBp,
  discountedPrice,
  parseDiscountPercent,
  formatDiscountPercent,
  discountLabel,
  orderDiscountAmount,
} from "./discount";

describe("effectiveDiscountBp — 회원 개별이 등급을 덮는다", () => {
  it("개별 할인율이 없으면(null) 등급 값을 쓴다", () => {
    expect(effectiveDiscountBp(null, 500)).toBe(500);
    expect(effectiveDiscountBp(undefined, 300)).toBe(300);
  });

  it("개별 할인율이 있으면 등급보다 우선한다", () => {
    expect(effectiveDiscountBp(700, 500)).toBe(700);
  });

  /**
   * null(등급 따름)과 0(이 거래처는 할인 없음)은 다른 뜻이다.
   * 0 을 "안 정함"으로 취급하면 골드 거래처에서 할인을 뺄 방법이 사라진다.
   */
  it("개별 0% 는 '등급 따름'이 아니라 '할인 없음'이다", () => {
    expect(effectiveDiscountBp(0, 500)).toBe(0);
  });

  it("개별이 등급보다 낮아도 그대로 쓴다 (특별 관리 거래처)", () => {
    expect(effectiveDiscountBp(100, 500)).toBe(100);
  });

  it("상한을 넘는 값은 상한으로 자른다", () => {
    expect(effectiveDiscountBp(99_999, 0)).toBe(MAX_DISCOUNT_BP);
    expect(effectiveDiscountBp(null, 99_999)).toBe(MAX_DISCOUNT_BP);
  });

  it("음수·깨진 값은 0 으로 본다 (할인 대신 할증이 되면 안 된다)", () => {
    expect(effectiveDiscountBp(-500, 300)).toBe(0);
    expect(effectiveDiscountBp(NaN, 300)).toBe(0);
    expect(effectiveDiscountBp(null, NaN)).toBe(0);
  });
});

describe("discountedPrice", () => {
  it("할인율 0 이면 정가 그대로", () => {
    expect(discountedPrice(5000, 0)).toBe(5000);
  });

  it("5% 할인", () => {
    expect(discountedPrice(5000, 500)).toBe(4750);
  });

  /** 원 미만은 버린다 — 손님에게 유리한 쪽이고, 청구액에 소수가 남지 않는다 */
  it("원 미만은 버린다", () => {
    expect(discountedPrice(9999, 500)).toBe(9499); // 9499.05
    expect(discountedPrice(3333, 300)).toBe(3233); // 3233.01
  });

  /**
   * 0원은 "아직 단가를 안 정한 수집 상품"이라는 뜻이다(pricing.hasPrice).
   * 여기서 최소 1원으로 올려버리면 가격 미설정 상품이 1원짜리로 팔린다.
   */
  it("정가 0원(가격 미설정)은 0원으로 남는다", () => {
    expect(discountedPrice(0, 500)).toBe(0);
  });

  /** 반대로 값이 있는 상품은 할인 때문에 0원 주문이 되면 안 된다 */
  it("정가가 있으면 아무리 깎여도 최소 1원", () => {
    expect(discountedPrice(1, MAX_DISCOUNT_BP)).toBe(1);
    expect(discountedPrice(10, MAX_DISCOUNT_BP)).toBe(1);
  });

  it("상한(90%)을 넘겨 부르면 상한까지만 깎는다", () => {
    expect(discountedPrice(10_000, 99_999)).toBe(1000);
  });

  it("음수·깨진 할인율은 정가 그대로 (안전한 쪽으로)", () => {
    expect(discountedPrice(5000, -500)).toBe(5000);
    expect(discountedPrice(5000, NaN)).toBe(5000);
  });

  it("깨진 정가는 0", () => {
    expect(discountedPrice(NaN, 500)).toBe(0);
    expect(discountedPrice(-100, 500)).toBe(0);
  });

  /**
   * 만분율을 정수로 곱하고 마지막에 한 번만 나눈다(points.ts 와 같은 이유).
   * 부동소수로 0.075 를 곱하면 큰 금액에서 원 단위가 흔들린다.
   */
  it("큰 금액에서도 원 단위가 정확하다", () => {
    expect(discountedPrice(1_234_567, 750)).toBe(Math.floor((1_234_567 * 9250) / 10_000));
  });
});

describe("parseDiscountPercent — 관리자 폼 입력", () => {
  it("정수·소수 % 를 만분율로 바꾼다", () => {
    expect(parseDiscountPercent("5")).toBe(500);
    expect(parseDiscountPercent("0")).toBe(0);
    expect(parseDiscountPercent("2.5")).toBe(250);
    expect(parseDiscountPercent("0.25")).toBe(25);
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(parseDiscountPercent(" 5 ")).toBe(500);
  });

  /**
   * 실수 방지선. 5% 를 넣으려다 '500' 을 치면 0원 주문이 나간다 —
   * 싼 단계(폼)에서 막아 비싼 단계(주문)를 살린다.
   */
  it("상한 90% 를 넘으면 거부한다", () => {
    expect(parseDiscountPercent("90")).toBe(MAX_DISCOUNT_BP);
    expect(parseDiscountPercent("90.01")).toBeNull();
    expect(parseDiscountPercent("100")).toBeNull();
    expect(parseDiscountPercent("500")).toBeNull();
  });

  it("숫자가 아니거나 음수면 거부한다", () => {
    expect(parseDiscountPercent("")).toBeNull();
    expect(parseDiscountPercent("-5")).toBeNull();
    expect(parseDiscountPercent("오퍼센트")).toBeNull();
    expect(parseDiscountPercent("5%")).toBeNull();
    expect(parseDiscountPercent("1.234")).toBeNull(); // 소수 셋째 자리는 만분율로 안 떨어진다
  });
});

describe("formatDiscountPercent / discountLabel", () => {
  it("만분율을 사람이 읽는 % 로", () => {
    expect(formatDiscountPercent(500)).toBe("5");
    expect(formatDiscountPercent(250)).toBe("2.5");
    expect(formatDiscountPercent(0)).toBe("0");
  });

  it("할인이 없으면 라벨도 없다 (빈 배지를 그리지 않게)", () => {
    expect(discountLabel(0)).toBe("");
  });

  it("할인이 있으면 배지 문구", () => {
    expect(discountLabel(500)).toBe("5% 할인");
    expect(discountLabel(250)).toBe("2.5% 할인");
  });
});

describe("orderDiscountAmount — 저장된 주문에서 되짚기", () => {
  it("할인 품목의 차액 × 수량을 더한다", () => {
    expect(
      orderDiscountAmount([
        { listPrice: 1000, unitPrice: 950, quantity: 3 },
        { listPrice: 1500, unitPrice: 1350, quantity: 2 },
      ]),
    ).toBe(150 + 300);
  });

  /**
   * 할인 도입 전 주문은 listPrice 가 0 이다(컬럼 기본값).
   * 그걸 정가로 읽으면 옛 주문마다 음수 할인이 찍힌다.
   */
  it("listPrice 가 0 인 옛 주문은 할인 0 으로 본다", () => {
    expect(orderDiscountAmount([{ listPrice: 0, unitPrice: 1000, quantity: 5 }])).toBe(0);
  });

  it("할인이 없으면(정가 = 청구가) 0", () => {
    expect(orderDiscountAmount([{ listPrice: 1000, unitPrice: 1000, quantity: 5 }])).toBe(0);
  });

  it("빈 주문은 0", () => {
    expect(orderDiscountAmount([])).toBe(0);
  });
});
