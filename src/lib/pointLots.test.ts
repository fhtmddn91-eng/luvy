/**
 * 포인트 묶음(lot) 계산 — 선입선출 소진·만료 (2026-09-05 규칙).
 * 돈이 걸린 계산이라 전부 순수 함수로 떼어 못 박는다.
 */
import { describe, it, expect } from "vitest";
import { sortLotsFifo, allocateFifo, expiresAtFor, dueLots, expiringSoon, type Lot } from "./pointLots";

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const lot = (id: string, remaining: number, expiresAt: Date | null, createdAt: Date): Lot => ({
  id, remaining, expiresAt, createdAt,
});

describe("sortLotsFifo — 먼저 만료되는 것부터, 만료 없는 것은 맨 뒤", () => {
  it("만료일 오름차순, 같은 날이면 적립일 순", () => {
    const lots = [
      lot("c", 10, null, d(2026, 1, 1)),
      lot("a", 10, d(2027, 3, 1), d(2026, 3, 1)),
      lot("b", 10, d(2027, 1, 1), d(2026, 1, 1)),
      lot("d", 10, d(2027, 3, 1), d(2026, 2, 1)),
    ];
    expect(sortLotsFifo(lots).map((l) => l.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("allocateFifo — 요청량을 묶음에서 차례로 뺀다", () => {
  const lots = [
    lot("a", 300, d(2027, 1, 1), d(2026, 1, 1)),
    lot("b", 500, d(2027, 2, 1), d(2026, 2, 1)),
    lot("c", 200, null, d(2026, 3, 1)),
  ];
  it("앞 묶음부터 채우고 남은 묶음은 건드리지 않는다", () => {
    expect(allocateFifo(lots, 700)).toEqual({ takes: [{ id: "a", take: 300 }, { id: "b", take: 400 }], shortfall: 0 });
  });
  it("정확히 한 묶음이면 그 묶음만", () => {
    expect(allocateFifo(lots, 300)).toEqual({ takes: [{ id: "a", take: 300 }], shortfall: 0 });
  });
  it("모자라면 shortfall 로 알린다 — 호출자가 거부하거나(사용) 사유에 적는다(회수)", () => {
    expect(allocateFifo(lots, 1200)).toEqual({
      takes: [{ id: "a", take: 300 }, { id: "b", take: 500 }, { id: "c", take: 200 }],
      shortfall: 200,
    });
  });
  it("remaining 0 인 묶음은 건너뛴다", () => {
    expect(allocateFifo([lot("z", 0, null, d(2026, 1, 1)), ...lots], 100)).toEqual({ takes: [{ id: "a", take: 100 }], shortfall: 0 });
  });
  it("0 요청은 아무것도 안 뺀다", () => {
    expect(allocateFifo(lots, 0)).toEqual({ takes: [], shortfall: 0 });
  });
});

describe("expiresAtFor — 적립일 + 정책 개월", () => {
  it("12개월이면 이듬해 같은 날", () => {
    expect(expiresAtFor(d(2026, 9, 5), 12)).toEqual(d(2027, 9, 5));
  });
  it("0 이면 만료 없음", () => {
    expect(expiresAtFor(d(2026, 9, 5), 0)).toBeNull();
  });
  it("말일 넘김은 JS Date 규칙대로 (1/31 + 1개월 = 3/3) 가 아니라 그 달 말일로 맞춘다", () => {
    expect(expiresAtFor(d(2026, 1, 31), 1)).toEqual(d(2026, 2, 28));
  });
});

describe("dueLots / expiringSoon — 만료 판정", () => {
  const now = d(2026, 9, 5);
  const lots = [
    lot("gone", 100, d(2026, 9, 5), d(2025, 9, 5)),    // 오늘 0시 = 만료
    lot("soon", 200, d(2026, 9, 20), d(2025, 9, 20)),  // 15일 뒤
    lot("later", 300, d(2026, 12, 1), d(2025, 12, 1)),
    lot("never", 400, null, d(2026, 1, 1)),
    lot("empty", 0, d(2026, 8, 1), d(2025, 8, 1)),
  ];
  it("만료일이 지났고 남은 게 있는 묶음만", () => {
    expect(dueLots(lots, now).map((l) => l.id)).toEqual(["gone"]);
  });
  it("30일 내 소멸 예정 합계 (이미 만료된 것은 제외)", () => {
    expect(expiringSoon(lots, now, 30)).toBe(200);
  });
});
