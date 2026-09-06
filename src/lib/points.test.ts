/**
 * 등급별 적립 포인트 계산 (운영자 요청서 3번, 2026-09-05).
 * 적립률은 만분율(100 = 1%)로 저장한다 — 0.5% 같은 소수 % 를 정수로 안전하게 다루기 위해.
 */
import { describe, it, expect } from "vitest";
import { pointsFor, parseRatePercent, formatRatePercent } from "./points";

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
