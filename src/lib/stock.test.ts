import { describe, it, expect } from "vitest";
import {
  stockState,
  isSoldOut,
  maxOrderable,
  clampToStock,
  findStockShortages,
  stockLabel,
  LOW_STOCK_THRESHOLD,
} from "./stock";

const tracked = (stock: number) => ({ trackStock: true, stock });
const untracked = { trackStock: false, stock: 0 };

describe("stockState", () => {
  it("재고 미추적 상품은 항상 무제한", () => {
    expect(stockState(untracked)).toBe("unlimited");
    expect(stockState({ trackStock: false, stock: -5 })).toBe("unlimited");
  });

  it("0 이하는 품절", () => {
    expect(stockState(tracked(0))).toBe("sold_out");
    expect(stockState(tracked(-3))).toBe("sold_out");
  });

  it("임계값 이하는 부족", () => {
    expect(stockState(tracked(1))).toBe("low");
    expect(stockState(tracked(LOW_STOCK_THRESHOLD))).toBe("low");
    expect(stockState(tracked(LOW_STOCK_THRESHOLD + 1))).toBe("in_stock");
  });
});

describe("isSoldOut", () => {
  it("추적 상품만 품절이 될 수 있다", () => {
    expect(isSoldOut(tracked(0))).toBe(true);
    expect(isSoldOut(untracked)).toBe(false);
  });
});

describe("maxOrderable", () => {
  it("미추적이면 상한까지 허용", () => {
    expect(maxOrderable(untracked, 100_000)).toBe(100_000);
  });

  it("추적이면 재고까지만", () => {
    expect(maxOrderable(tracked(7), 100_000)).toBe(7);
    expect(maxOrderable(tracked(0), 100_000)).toBe(0);
    // 음수 재고가 들어와도 0으로 방어
    expect(maxOrderable(tracked(-2), 100_000)).toBe(0);
  });
});

describe("clampToStock", () => {
  it("미추적 상품은 MOQ 하한만 적용", () => {
    expect(clampToStock(3, 5, untracked)).toBe(5);
    expect(clampToStock(50, 5, untracked)).toBe(50);
  });

  it("재고 상한을 넘지 않는다", () => {
    expect(clampToStock(100, 5, tracked(20))).toBe(20);
    expect(clampToStock(10, 5, tracked(20))).toBe(10);
  });

  it("재고가 MOQ보다 적으면 재고만큼만 허용한다", () => {
    // MOQ 10인데 재고 3 → 3까지만 (MOQ까지 올려버리면 초과판매)
    expect(clampToStock(10, 10, tracked(3))).toBe(3);
  });

  it("품절이면 0", () => {
    expect(clampToStock(5, 5, tracked(0))).toBe(0);
  });

  it("잘못된 수량 입력은 MOQ로 보정", () => {
    expect(clampToStock(0, 5, untracked)).toBe(5);
    expect(clampToStock(Number.NaN, 5, untracked)).toBe(5);
  });
});

describe("findStockShortages", () => {
  it("재고보다 많이 담긴 항목만 골라낸다", () => {
    const items = [
      { quantity: 5, product: { ...tracked(10), name: "충분" } },
      { quantity: 12, product: { ...tracked(4), name: "부족" } },
      { quantity: 99, product: { ...untracked, name: "미추적" } },
      { quantity: 1, product: { ...tracked(0), name: "품절" } },
    ];
    expect(findStockShortages(items)).toEqual([
      { name: "부족", requested: 12, available: 4 },
      { name: "품절", requested: 1, available: 0 },
    ]);
  });

  it("문제가 없으면 빈 배열", () => {
    expect(findStockShortages([{ quantity: 1, product: { ...tracked(5), name: "ok" } }])).toEqual([]);
  });
});

describe("stockLabel", () => {
  it("상태별 라벨", () => {
    expect(stockLabel(untracked)).toBe("무제한");
    expect(stockLabel(tracked(0))).toBe("품절");
    expect(stockLabel(tracked(5))).toBe("5개 (부족)");
    expect(stockLabel(tracked(50))).toBe("50개");
  });
});
