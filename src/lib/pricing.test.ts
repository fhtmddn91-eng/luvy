import { describe, it, expect } from "vitest";
import { resolveUnitPrice, getMoq, shippingFor, type Tier } from "./pricing";

const tiers: Tier[] = [
  { minQty: 10, unitPrice: 6500 },
  { minQty: 30, unitPrice: 5900 },
  { minQty: 60, unitPrice: 5400 },
];

describe("getMoq", () => {
  it("returns the smallest minQty", () => {
    expect(getMoq(tiers)).toBe(10);
  });
});

describe("resolveUnitPrice", () => {
  it("uses the highest tier whose minQty <= qty", () => {
    expect(resolveUnitPrice(tiers, 10)).toBe(6500);
    expect(resolveUnitPrice(tiers, 29)).toBe(6500);
    expect(resolveUnitPrice(tiers, 30)).toBe(5900);
    expect(resolveUnitPrice(tiers, 100)).toBe(5400);
  });
  it("falls back to the lowest tier price below MOQ", () => {
    expect(resolveUnitPrice(tiers, 1)).toBe(6500);
  });
});

describe("empty tiers", () => {
  it("getMoq defaults to 1 and resolveUnitPrice to 0 (order path must guard tier-less products)", () => {
    expect(getMoq([])).toBe(1);
    expect(resolveUnitPrice([], 5)).toBe(0);
  });
});

describe("shippingFor", () => {
  it("charges 3000 below threshold, free at/above 100000", () => {
    expect(shippingFor(99999)).toBe(3000);
    expect(shippingFor(100000)).toBe(0);
  });
  it("is free for empty subtotal", () => {
    expect(shippingFor(0)).toBe(0);
  });
});
