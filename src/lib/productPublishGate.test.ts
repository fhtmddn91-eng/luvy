import { describe, it, expect } from "vitest";
import {
  productPublishGate,
  BLOCKING_TRANSLATE_STATUSES,
  productSaveStatusData,
  revertedAssetTranslation,
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

/**
 * 상품 저장 시 status·publishRequestedAt 결정.
 *
 * 실사례(2026-08-27 감사): updateProduct 의 숨김 저장이 publishRequestedAt 을
 * 안 지웠다. 운영자가 "판매"를 눌러 보류(HIDDEN + publishRequestedAt)가 된 상품을
 * 마음을 바꿔 수정 폼에서 "숨김"으로 저장해도 요청 기록이 남았고, 백그라운드
 * 번역이 끝나는 순간 promoteIfReady 가 그 기록만 보고 ACTIVE 로 되살렸다 —
 * 운영자가 숨긴 상품이 손님에게 노출됐다.
 */
describe("productSaveStatusData — 숨김 저장은 판매 요청도 취소한다", () => {
  it("숨김 저장은 publishRequestedAt 을 null 로 지운다", () => {
    expect(productSaveStatusData("HIDDEN")).toEqual({
      status: "HIDDEN",
      publishRequestedAt: null,
    });
  });

  it("ACTIVE 는 게이트(requestPublish)가 정하므로 상태를 건드리지 않는다", () => {
    // 여기서 ACTIVE 를 그대로 쓰면 번역·브랜드 검증을 건너뛴 판매 전환이 된다
    const d = productSaveStatusData("ACTIVE");
    expect(d.status).toBeUndefined();
    expect(d).not.toHaveProperty("publishRequestedAt", null);
  });

  it("품절 등 다른 상태로 저장해도 대기 중인 판매 요청은 취소된다", () => {
    // 판매 요청을 남겨두면 번역 완료가 운영자 의도와 무관하게 되살린다
    expect(productSaveStatusData("SOLD_OUT")).toEqual({
      status: "SOLD_OUT",
      publishRequestedAt: null,
    });
  });
});

/**
 * "원본 유지"(운영자 복원)의 상태.
 *
 * 실사례(2026-08-27 감사): revertAssetTranslation 이 originalUrl 까지 null 로
 * 지워서 게이트가 "미번역"으로 차단했고, 복원한 상품은 판매 전환이 영영 안 됐다.
 *
 * 그렇다고 **자동 통과로 바꾸면 안 된다**. 복원은 "이 번역본이 나쁘다"는 결정이지
 * "중국어 원본을 손님에게 내보내도 좋다"는 승인이 아니다. 자동 통과시키면
 * promoteIfReady 가 그대로 ACTIVE 로 올려서, 방금 강화한 "외국어 원본 노출 금지"를
 * '원본 유지' 버튼 하나로 우회하게 된다. 그래서 **노출 차단 상태로 남기고**
 * 판매하려면 운영자의 명시적 승인을 따로 받는다 (fail-closed).
 */
describe("revertedAssetTranslation — 원본 복원은 노출 차단 상태로 남는다", () => {
  it("url·originalUrl 은 원본을 가리키고 상태는 ORIGINAL_KEPT", () => {
    expect(revertedAssetTranslation("/uploads/orig.jpg")).toEqual({
      url: "/uploads/orig.jpg",
      originalUrl: "/uploads/orig.jpg",
      translateStatus: TRANSLATE_STATUS.ORIGINAL_KEPT,
    });
  });

  it("복원본은 노출 허용이 아니다 — 중국어 원본이 자동으로 팔리면 안 된다", () => {
    const r = revertedAssetTranslation("/uploads/orig.jpg");
    expect(allowsExposure(r.translateStatus)).toBe(false);
  });

  it("복원본이 있으면 자동 승격 게이트가 막는다", () => {
    const r = revertedAssetTranslation("/uploads/orig.jpg");
    const g = productPublishGate([r], true, "루비");
    expect(g.ready).toBe(false);
    expect(g.blocking.originalKept).toBe(1);
  });

  it("보류 사유에 '원본 유지'가 보인다 — 운영자가 왜 막혔는지 알아야 한다", () => {
    const g = productPublishGate([revertedAssetTranslation("/uploads/o.jpg")], true, "루비");
    expect(gateSummary(g)).toContain("원본 유지");
  });

  it("번역 비대상(국내)은 복원본이어도 판매를 막지 않는다", () => {
    // 원문이 이미 한국어라 '외국어 원본 노출' 위험 자체가 없다
    const r = revertedAssetTranslation("/uploads/o.jpg");
    expect(productPublishGate([r], false, "루비").ready).toBe(true);
  });

  it("originalUrl 을 지우던 옛 모양은 여전히 미번역으로 차단된다", () => {
    expect(productPublishGate([{ translateStatus: null, originalUrl: null }], true, "루비").ready).toBe(false);
  });
});

/**
 * 어드민 상품 목록의 "판매 보류" 배지 카운트가 쓰는 상태 목록.
 *
 * 실사례(2026-08-27 감사): 이 목록이 게이트와 따로 관리돼 ORIGINAL_KEPT 가
 * 빠졌다. 그 상태로만 막힌 상품은 배지에 "보류"라고만 뜨고 **사유가 안 보여**
 * 운영자가 무엇을 해야 풀리는지 알 수 없었다. 목록과 게이트가 어긋나지
 * 않는지 양방향으로 못 박는다.
 */
describe("BLOCKING_TRANSLATE_STATUSES — 보류 카운트와 게이트가 어긋나지 않는다", () => {
  const withStatus = (s: string) => ({ translateStatus: s, originalUrl: "/uploads/a.jpg" });

  it("목록에 있는 상태는 전부 실제로 게이트를 막는다", () => {
    for (const s of BLOCKING_TRANSLATE_STATUSES) {
      expect(productPublishGate([withStatus(s)], true, BRAND).ready, s).toBe(false);
    }
  });

  it("게이트를 막는 모든 상태가 목록에 들어 있다 (드리프트 방지)", () => {
    for (const s of Object.values(TRANSLATE_STATUS)) {
      const blocks = !productPublishGate([withStatus(s)], true, BRAND).ready;
      expect(BLOCKING_TRANSLATE_STATUSES.includes(s), s).toBe(blocks);
    }
  });

  it("원본 유지도 보류 카운트에 잡힌다", () => {
    expect(BLOCKING_TRANSLATE_STATUSES).toContain(TRANSLATE_STATUS.ORIGINAL_KEPT);
  });

  it("노출 허용 상태는 목록에 없다", () => {
    expect(BLOCKING_TRANSLATE_STATUSES).not.toContain(TRANSLATE_STATUS.VERIFIED);
    expect(BLOCKING_TRANSLATE_STATUSES).not.toContain(TRANSLATE_STATUS.NO_FOREIGN_TEXT);
  });
});
