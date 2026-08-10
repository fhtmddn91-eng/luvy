import { describe, it, expect } from "vitest";
import {
  optionUnitPrice,
  optionMaxQty,
  isOptionSoldOut,
  anyOptionAvailable,
  sellableOptions,
} from "./options";
import type { Tier } from "./pricing";

const tiers: Tier[] = [
  { minQty: 1, unitPrice: 9000 },
  { minQty: 20, unitPrice: 8000 },
];

import type { OptionLite } from "./options";

const opt = (over: Partial<OptionLite> = {}): OptionLite => ({
  id: "o1",
  name: "레드",
  unitPrice: 0,
  trackStock: false,
  stock: 0,
  active: true,
  ...over,
});

describe("optionUnitPrice", () => {
  it("옵션 단가를 안 정했으면 상품의 수량별 도매가를 쓴다", () => {
    expect(optionUnitPrice(opt(), tiers, 1)).toBe(9000);
    expect(optionUnitPrice(opt(), tiers, 20)).toBe(8000);
    expect(optionUnitPrice(null, tiers, 20)).toBe(8000);
  });

  it("옵션 단가가 있으면 수량과 무관하게 그 값이 이긴다", () => {
    expect(optionUnitPrice(opt({ unitPrice: 7000 }), tiers, 1)).toBe(7000);
    expect(optionUnitPrice(opt({ unitPrice: 7000 }), tiers, 100)).toBe(7000);
  });
});

describe("optionMaxQty", () => {
  const product = { trackStock: true, stock: 50 };

  it("옵션이 재고를 추적하면 옵션 재고가 상한", () => {
    expect(optionMaxQty(opt({ trackStock: true, stock: 3 }), product, 1000)).toBe(3);
  });

  it("옵션이 추적하지 않으면 상품 재고를 따른다", () => {
    expect(optionMaxQty(opt(), product, 1000)).toBe(50);
  });

  it("둘 다 추적하지 않으면 상한만 적용", () => {
    expect(optionMaxQty(opt(), { trackStock: false, stock: 0 }, 1000)).toBe(1000);
  });
});

describe("isOptionSoldOut / anyOptionAvailable", () => {
  it("옵션 재고가 0이면 그 옵션만 품절", () => {
    expect(isOptionSoldOut(opt({ trackStock: true, stock: 0 }), { trackStock: false, stock: 0 })).toBe(true);
    expect(isOptionSoldOut(opt({ trackStock: true, stock: 1 }), { trackStock: false, stock: 0 })).toBe(false);
  });

  it("옵션 하나라도 살아 있으면 상품은 주문 가능", () => {
    const options = [
      opt({ id: "a", trackStock: true, stock: 0 }),
      opt({ id: "b", trackStock: true, stock: 5 }),
    ];
    expect(anyOptionAvailable(options, { trackStock: false, stock: 0 })).toBe(true);
  });

  it("옵션이 전부 품절이면 주문 불가", () => {
    const options = [opt({ trackStock: true, stock: 0 })];
    expect(anyOptionAvailable(options, { trackStock: false, stock: 0 })).toBe(false);
  });

  it("옵션이 없으면 상품 재고로 판단한다", () => {
    expect(anyOptionAvailable([], { trackStock: true, stock: 0 })).toBe(false);
    expect(anyOptionAvailable([], { trackStock: true, stock: 2 })).toBe(true);
    expect(anyOptionAvailable([], { trackStock: false, stock: 0 })).toBe(true);
  });

  it("숨긴 옵션은 판단에서 빠진다", () => {
    const options = [opt({ active: false, trackStock: true, stock: 99 })];
    expect(sellableOptions(options)).toEqual([]);
    expect(anyOptionAvailable(options, { trackStock: true, stock: 0 })).toBe(false);
  });
});
