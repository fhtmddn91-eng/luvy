/**
 * 회원별 구매금액 집계 (운영자 요청서 1번, 2026-09-05) — 기간 경계와 묶기는 순수 함수로.
 * 주는 월요일 시작(한국 관행). 빈 기간도 0 으로 채워야 표가 끊기지 않는다.
 */
import { describe, it, expect } from "vitest";
import { periodStart, bucketOrders, PAID_STATUSES } from "./purchaseStats";

describe("periodStart — 목록 기간 탭의 시작 시각", () => {
  const now = new Date(2026, 8, 5, 15, 30); // 2026-09-05 (토)
  it("전체는 null (조건 없음)", () => {
    expect(periodStart("all", now)).toBeNull();
  });
  it("오늘은 그날 0시", () => {
    expect(periodStart("today", now)).toEqual(new Date(2026, 8, 5));
  });
  it("이번 주는 이번 월요일 0시", () => {
    expect(periodStart("week", now)).toEqual(new Date(2026, 7, 31)); // 8/31 월
  });
  it("일요일은 그 전 월요일이 이번 주 시작", () => {
    expect(periodStart("week", new Date(2026, 8, 6, 9))).toEqual(new Date(2026, 7, 31));
  });
  it("이번 달은 1일 0시", () => {
    expect(periodStart("month", now)).toEqual(new Date(2026, 8, 1));
  });
  it("모르는 값은 전체로", () => {
    expect(periodStart("whatever", now)).toBeNull();
  });
});

describe("bucketOrders — 상세 화면의 월·주·일 표", () => {
  const now = new Date(2026, 8, 5, 15, 30);
  const orders = [
    { createdAt: new Date(2026, 8, 5, 10), total: 10_000 },
    { createdAt: new Date(2026, 8, 4, 10), total: 20_000 },
    { createdAt: new Date(2026, 7, 20, 10), total: 30_000 },
    { createdAt: new Date(2025, 8, 1, 10), total: 99_000 }, // 13개월 전 — 월별 12개월 밖
  ];

  it("월별: 최근 12개월, 최신이 먼저, 빈 달은 0", () => {
    const rows = bucketOrders(orders, "month", now);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ label: "2026.09", count: 2, total: 30_000 });
    expect(rows[1]).toEqual({ label: "2026.08", count: 1, total: 30_000 });
    expect(rows[2]).toEqual({ label: "2026.07", count: 0, total: 0 });
    expect(rows[11].label).toBe("2025.10");
  });

  it("주별: 최근 12주, 월요일 날짜로 표시", () => {
    const rows = bucketOrders(orders, "week", now);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ label: "08.31 주", count: 2, total: 30_000 });
    expect(rows[2]).toEqual({ label: "08.17 주", count: 1, total: 30_000 });
  });

  it("일별: 최근 30일", () => {
    const rows = bucketOrders(orders, "day", now);
    expect(rows).toHaveLength(30);
    expect(rows[0]).toEqual({ label: "09.05", count: 1, total: 10_000 });
    expect(rows[1]).toEqual({ label: "09.04", count: 1, total: 20_000 });
    expect(rows[16]).toEqual({ label: "08.20", count: 1, total: 30_000 });
  });

  it("범위 밖 주문은 어느 칸에도 안 들어간다", () => {
    const sum = bucketOrders(orders, "month", now).reduce((a, r) => a + r.total, 0);
    expect(sum).toBe(60_000);
  });
});

describe("PAID_STATUSES — 결제가 확인된 주문만", () => {
  it("접수됨(무통장 미입금)·취소·실패는 없다", () => {
    expect(PAID_STATUSES).toEqual(["PAID", "PREPARING", "SHIPPED", "DELIVERED"]);
  });
});
