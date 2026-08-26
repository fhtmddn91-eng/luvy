import { describe, it, expect } from "vitest";
import {
  productPublishGate,
  allowsExposure,
  gateSummary,
  isPlaceholderBrand,
  PLACEHOLDER_BRAND,
  TRANSLATE_STATUS,
} from "./productPublishGate";

const a = (translateStatus: string | null, originalUrl: string | null = "/uploads/a.jpg") => ({
  translateStatus,
  originalUrl,
});

describe("allowsExposure — 노출 허용 상태", () => {
  it("VERIFIED·NO_FOREIGN_TEXT·legacy(null)만 허용", () => {
    expect(allowsExposure(TRANSLATE_STATUS.VERIFIED)).toBe(true);
    expect(allowsExposure(TRANSLATE_STATUS.NO_FOREIGN_TEXT)).toBe(true);
    expect(allowsExposure(null)).toBe(true);
  });
  it("VERIFIED 아닌 모든 판정 상태는 차단", () => {
    for (const s of ["TRANSLATING", "NEEDS_REVIEW", "RETRYABLE", "VERIFICATION_FAILED", "FAILED"]) {
      expect(allowsExposure(s)).toBe(false);
    }
  });
});

/** 실제 브랜드 — 브랜드 검사와 번역 검사를 섞지 않기 위해 기본값으로 쓴다 */
const BRAND = "루비";

describe("productPublishGate — ACTIVE 승격 판정", () => {
  it("번역 비대상 소스(국내·수동)는 항상 통과", () => {
    expect(productPublishGate([a("FAILED")], false, BRAND).ready).toBe(true);
  });
  it("전부 VERIFIED/NO_FOREIGN_TEXT 면 통과", () => {
    expect(productPublishGate([a("VERIFIED"), a("NO_FOREIGN_TEXT")], true, BRAND).ready).toBe(true);
  });
  it("legacy(상태 null + 번역본 있음)는 통과 — 기존 판매 상품을 숨기지 않는다", () => {
    expect(productPublishGate([a(null, "/uploads/orig.jpg")], true, BRAND).ready).toBe(true);
  });
  it("미번역(상태 null + 원본 그대로)은 차단", () => {
    const g = productPublishGate([a(null, null)], true, BRAND);
    expect(g.ready).toBe(false);
    expect(g.blocking.untranslated).toBe(1);
  });
  it.each([
    ["TRANSLATING", "translating"],
    ["NEEDS_REVIEW", "review"],
    ["VERIFICATION_FAILED", "review"],
    ["RETRYABLE", "retryable"],
    ["FAILED", "failed"],
  ] as const)("%s 1장이면 차단", (status, key) => {
    const g = productPublishGate([a("VERIFIED"), a(status)], true, BRAND);
    expect(g.ready).toBe(false);
    expect(g.blocking[key]).toBe(1);
  });
});

describe("gateSummary", () => {
  it("통과면 빈 문자열", () => {
    expect(gateSummary(productPublishGate([a("VERIFIED")], true, BRAND))).toBe("");
  });
  it("사유를 사람이 읽게", () => {
    const g = productPublishGate([a("NEEDS_REVIEW"), a("TRANSLATING"), a(null, null)], true, BRAND);
    const s = gateSummary(g);
    expect(s).toContain("검수 1");
    expect(s).toContain("번역 중 1");
    expect(s).toContain("미번역 1");
  });
});

describe("브랜드 자리표시자 — 손님 화면에 브랜드로 나가면 안 된다", () => {
  it('"미정"·빈 값·공백은 자리표시자', () => {
    expect(isPlaceholderBrand(PLACEHOLDER_BRAND)).toBe(true);
    expect(isPlaceholderBrand("  미정  ")).toBe(true);
    expect(isPlaceholderBrand("")).toBe(true);
    expect(isPlaceholderBrand("   ")).toBe(true);
    expect(isPlaceholderBrand(null)).toBe(true);
    expect(isPlaceholderBrand(undefined)).toBe(true);
  });
  it("실제 브랜드는 자리표시자가 아니다 — 이름에 '미정'이 들어가도 통째 일치만 본다", () => {
    expect(isPlaceholderBrand("루비")).toBe(false);
    expect(isPlaceholderBrand("미정글")).toBe(false);
    expect(isPlaceholderBrand("BRAND 미정품")).toBe(false);
  });

  it("번역이 다 끝났어도 브랜드가 미정이면 ACTIVE 차단", () => {
    const g = productPublishGate([a("VERIFIED")], true, PLACEHOLDER_BRAND);
    expect(g.ready).toBe(false);
    expect(g.blocking.brandMissing).toBe(1);
  });
  it("번역 비대상(국내 도매처)도 브랜드 미정이면 차단 — 수집분 양쪽 다 '미정'이 붙는다", () => {
    const g = productPublishGate([], false, PLACEHOLDER_BRAND);
    expect(g.ready).toBe(false);
    expect(g.blocking.brandMissing).toBe(1);
  });
  it("빈 브랜드도 같은 취급", () => {
    expect(productPublishGate([], false, "").ready).toBe(false);
    expect(productPublishGate([], false, null).ready).toBe(false);
  });
  it("브랜드를 채우면 통과 (다른 차단 사유가 없을 때)", () => {
    expect(productPublishGate([a("VERIFIED")], true, "루비").ready).toBe(true);
    expect(productPublishGate([], false, "루비").ready).toBe(true);
  });
  it("어드민 배지에 사유가 보인다", () => {
    expect(gateSummary(productPublishGate([a("VERIFIED")], true, PLACEHOLDER_BRAND))).toContain("브랜드 미정");
    const both = gateSummary(productPublishGate([a("NEEDS_REVIEW")], true, PLACEHOLDER_BRAND));
    expect(both).toContain("검수 1");
    expect(both).toContain("브랜드 미정");
  });
});

describe("보류 사유 요약 — 번역 게이트와 브랜드 게이트가 섞여도 원인이 보인다", () => {
  it("브랜드만 막힌 경우 '번역'이 아니라 '브랜드 미정'이 사유다", () => {
    const g = productPublishGate([a("VERIFIED")], true, PLACEHOLDER_BRAND);
    const s = gateSummary(g);
    expect(s).toBe("브랜드 미정"); // 번역 관련 문구가 섞이면 안 된다
    expect(s).not.toContain("번역");
  });
  it("둘 다 막히면 둘 다 적는다 — 하나만 고치고 기다리는 일이 없게", () => {
    const s = gateSummary(productPublishGate([a("TRANSLATING"), a(null, null)], true, PLACEHOLDER_BRAND));
    expect(s).toContain("번역 중 1");
    expect(s).toContain("미번역 1");
    expect(s).toContain("브랜드 미정");
  });
  it("브랜드를 채우면 사유에서 빠진다", () => {
    expect(gateSummary(productPublishGate([a("TRANSLATING")], true, "루비"))).toBe("번역 중 1");
  });
});
