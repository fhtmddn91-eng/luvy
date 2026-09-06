/**
 * 등급별 적립 포인트 계산 (운영자 요청서 3번, 2026-09-05).
 * 적립률은 만분율(100 = 1%)로 저장한다 — 0.5% 같은 소수 % 를 정수로 안전하게 다루기 위해.
 */
import { describe, it, expect } from "vitest";
import {
  pointsFor,
  parseRatePercent,
  formatRatePercent,
  validatePointUse,
  maxPointUse,
  accrualBase,
  orderTotalAfterPoints,
} from "./points";

describe("pointsFor — 기준액 × 적립률, 원 미만 버림", () => {
  it("1% 면 100분의 1", () => {
    expect(pointsFor(123_456, 100)).toBe(1234);
  });
  it("0.5% 도 정수로 계산된다", () => {
    expect(pointsFor(100_000, 50)).toBe(500);
  });
  it("0% 또는 0원이면 0", () => {
    expect(pointsFor(50_000, 0)).toBe(0);
    expect(pointsFor(0, 200)).toBe(0);
  });
  it("음수·깨진 값은 0 — 회수는 별도 기록이라 여기서 음수를 만들지 않는다", () => {
    expect(pointsFor(-1000, 100)).toBe(0);
    expect(pointsFor(1000, -100)).toBe(0);
    expect(pointsFor(Number.NaN, 100)).toBe(0);
  });
});

describe("parseRatePercent — 설정 폼 입력(%) → 만분율", () => {
  it("정수·소수 둘째 자리까지 받는다", () => {
    expect(parseRatePercent("1")).toBe(100);
    expect(parseRatePercent("0.5")).toBe(50);
    expect(parseRatePercent("2.75")).toBe(275);
    expect(parseRatePercent(" 3 ")).toBe(300);
  });
  it("범위 밖·깨진 값은 null — 저장하지 않고 폼에 알린다", () => {
    expect(parseRatePercent("-1")).toBeNull();
    expect(parseRatePercent("101")).toBeNull();
    expect(parseRatePercent("abc")).toBeNull();
    expect(parseRatePercent("")).toBeNull();
    expect(parseRatePercent("0.123")).toBeNull(); // 셋째 자리는 만분율로 못 담는다
  });
});

describe("formatRatePercent — 만분율 → 화면 %", () => {
  it("불필요한 0 은 떼고 보여준다", () => {
    expect(formatRatePercent(100)).toBe("1");
    expect(formatRatePercent(50)).toBe("0.5");
    expect(formatRatePercent(275)).toBe("2.75");
    expect(formatRatePercent(0)).toBe("0");
  });
});

describe("validatePointUse — 주문서 포인트 사용 검사 (규칙: 단위·최소·잔액·총액)", () => {
  const policy = { minUse: 1000, unit: 100 };
  it("0 이면 사용 안 함으로 통과", () => {
    expect(validatePointUse({ requested: 0, balance: 5000, orderTotal: 30_000, ...policy })).toEqual({ ok: true, amount: 0 });
  });
  it("규칙 안이면 그대로", () => {
    expect(validatePointUse({ requested: 3000, balance: 5000, orderTotal: 30_000, ...policy })).toEqual({ ok: true, amount: 3000 });
  });
  it("총액까지 전부 쓸 수 있다 (0원 주문)", () => {
    expect(validatePointUse({ requested: 30_000, balance: 50_000, orderTotal: 30_000, ...policy })).toEqual({ ok: true, amount: 30_000 });
  });
  it("단위에 안 맞으면 거부", () => {
    const r = validatePointUse({ requested: 1050, balance: 5000, orderTotal: 30_000, ...policy });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("100P 단위");
  });
  it("최소 사용량 미만이면 거부", () => {
    const r = validatePointUse({ requested: 500, balance: 5000, orderTotal: 30_000, ...policy });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("1,000P 이상");
  });
  it("잔액보다 많으면 거부", () => {
    const r = validatePointUse({ requested: 6000, balance: 5000, orderTotal: 30_000, ...policy });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("잔액");
  });
  it("총액보다 많으면 거부 — 포인트로 거스름돈은 없다", () => {
    const r = validatePointUse({ requested: 40_000, balance: 50_000, orderTotal: 30_000, ...policy });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("결제 금액");
  });
  it("음수·소수·NaN 은 거부", () => {
    expect(validatePointUse({ requested: -100, balance: 5000, orderTotal: 30_000, ...policy }).ok).toBe(false);
    expect(validatePointUse({ requested: 100.5, balance: 5000, orderTotal: 30_000, ...policy }).ok).toBe(false);
    expect(validatePointUse({ requested: Number.NaN, balance: 5000, orderTotal: 30_000, ...policy }).ok).toBe(false);
  });
  it("정책이 0/1 이면 제한 없이 1P 단위", () => {
    expect(validatePointUse({ requested: 7, balance: 10, orderTotal: 30_000, minUse: 0, unit: 1 })).toEqual({ ok: true, amount: 7 });
  });
});

describe("maxPointUse — 「전액 사용」 버튼이 채울 값", () => {
  it("잔액과 총액 중 작은 쪽을 단위로 내림", () => {
    expect(maxPointUse({ balance: 5_250, orderTotal: 30_000, minUse: 1000, unit: 100 })).toBe(5200);
    expect(maxPointUse({ balance: 50_000, orderTotal: 30_000, minUse: 1000, unit: 100 })).toBe(30_000);
  });
  it("최소 사용량에 못 미치면 0", () => {
    expect(maxPointUse({ balance: 900, orderTotal: 30_000, minUse: 1000, unit: 100 })).toBe(0);
  });
});

describe("accrualBase / orderTotalAfterPoints — 포인트로 산 부분엔 적립 없음", () => {
  it("적립 기준액 = 상품금액 − 사용 포인트, 0 미만은 0", () => {
    expect(accrualBase(100_000, 30_000)).toBe(70_000);
    expect(accrualBase(20_000, 23_000)).toBe(0); // 배송비까지 포인트로 낸 경우
  });
  it("결제금액 = 상품 + 배송비 − 포인트", () => {
    expect(orderTotalAfterPoints(100_000, 3000, 30_000)).toBe(73_000);
    expect(orderTotalAfterPoints(20_000, 3000, 23_000)).toBe(0);
  });
});
