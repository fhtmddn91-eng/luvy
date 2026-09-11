/**
 * 버려진 결제대기 주문 판정 — 회귀 테스트.
 * 핵심은 "돈이 나갔을 수 있는 주문은 절대 건드리지 않는다"이다.
 */
import { describe, it, expect } from "vitest";
import { isAbandonedPending, staleBefore, STALE_PENDING_MINUTES } from "./pendingRules";

const NOW = new Date("2026-09-11T12:00:00Z");
const min = (m: number) => new Date(NOW.getTime() - m * 60_000);

const base = { status: "PENDING_PAYMENT", paymentMethod: "NICEPAY", payment: { status: "READY" } };

describe("isAbandonedPending", () => {
  it("결제창만 열고 30분 넘게 돌아오지 않은 주문은 정리 대상이다", () => {
    expect(isAbandonedPending({ ...base, createdAt: min(31) }, NOW)).toBe(true);
    expect(isAbandonedPending({ ...base, createdAt: min(STALE_PENDING_MINUTES) }, NOW)).toBe(true);
  });

  it("30분이 안 됐으면 아직 결제 중일 수 있다 — 건드리지 않는다", () => {
    expect(isAbandonedPending({ ...base, createdAt: min(29) }, NOW)).toBe(false);
    expect(isAbandonedPending({ ...base, createdAt: min(0) }, NOW)).toBe(false);
  });

  /** 이 세 줄이 이 모듈의 존재 이유다 */
  it("돈이 나갔을 수 있는 결제(UNCERTAIN·PAID·CANCEL_FAILED)는 아무리 오래돼도 정리하지 않는다", () => {
    for (const s of ["UNCERTAIN", "PAID", "CANCEL_FAILED", "CANCELED"]) {
      expect(isAbandonedPending({ ...base, payment: { status: s }, createdAt: min(999) }, NOW), s).toBe(false);
    }
  });

  it("승인 거절로 FAILED 가 남은 주문도 정리 대상이다 (돈이 안 나갔다)", () => {
    expect(isAbandonedPending({ ...base, payment: { status: "FAILED" }, createdAt: min(31) }, NOW)).toBe(true);
  });

  it("Payment 행이 없는 옛 잔재 주문도 정리한다 (승인이 있었을 리 없다)", () => {
    expect(isAbandonedPending({ ...base, payment: null, createdAt: min(31) }, NOW)).toBe(true);
  });

  it("결제대기가 아니거나 카드가 아니면 대상이 아니다", () => {
    expect(isAbandonedPending({ ...base, status: "PAID", createdAt: min(999) }, NOW)).toBe(false);
    expect(isAbandonedPending({ ...base, status: "RECEIVED", createdAt: min(999) }, NOW)).toBe(false);
    expect(isAbandonedPending({ ...base, paymentMethod: "BANK_TRANSFER", createdAt: min(999) }, NOW)).toBe(false);
  });
});

describe("staleBefore", () => {
  it("지금 − 30분", () => {
    expect(staleBefore(NOW).toISOString()).toBe("2026-09-11T11:30:00.000Z");
  });
});
