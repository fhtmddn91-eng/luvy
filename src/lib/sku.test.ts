import { describe, it, expect } from "vitest";
import { normalizeSku, skuError } from "./sku";

describe("normalizeSku", () => {
  it("빈 입력은 null — 빈 문자열이면 여러 상품이 unique 제약에 걸린다", () => {
    expect(normalizeSku("")).toBeNull();
    expect(normalizeSku("   ")).toBeNull();
  });

  it("앞뒤 공백을 없애고 대문자로 모은다", () => {
    expect(normalizeSku("  lv-2601 ")).toBe("LV-2601");
  });

  it("가운데 공백도 제거한다 — 눈으로 같아 보이는 품번이 갈리면 안 된다", () => {
    expect(normalizeSku("LV 2601")).toBe("LV2601");
  });

  it("대소문자만 다른 입력은 같은 품번이 된다", () => {
    expect(normalizeSku("lv-2601")).toBe(normalizeSku("LV-2601"));
  });
});

describe("skuError", () => {
  it("품번을 안 쓰면 오류 없음", () => {
    expect(skuError(null)).toBeNull();
  });

  it("영문·숫자·허용 기호 조합은 통과", () => {
    for (const s of ["LV-2601", "A1", "LV_26.01", "CAT/01"]) {
      expect(skuError(s)).toBeNull();
    }
  });

  it("기호로 시작하면 거부", () => {
    expect(skuError("-2601")).not.toBeNull();
  });

  it("허용하지 않는 문자는 거부", () => {
    expect(skuError("LV#2601")).not.toBeNull();
    expect(skuError("품번01")).not.toBeNull();
  });

  it("32자를 넘으면 거부", () => {
    expect(skuError("A".repeat(33))).not.toBeNull();
    expect(skuError("A".repeat(32))).toBeNull();
  });
});
