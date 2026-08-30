import { describe, it, expect } from "vitest";
import {
  productPublishGate,
  BLOCKING_TRANSLATE_STATUSES,
  REVIEW_CODE_LABELS,
  reasonLabel,
  reviewReasonsSummary,
  hasSafetyRefusal,
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

/**
 * 운영자에게 보이는 사유는 전부 한국어여야 한다.
 *
 * 실사례(2026-08-30 피드백): 검수 카드에 "OCR_DISAGREEMENT: 舒适体验升级" 처럼
 * 영어 코드가 그대로 노출됐다. 운영자는 초보 1명이다 — 코드는 개발자용이지
 * 화면용이 아니다. 새 코드를 추가하면 라벨도 함께 추가해야 컴파일이 된다
 * (Record<ReviewCode, string> — 빠지면 tsc 오류).
 */
describe("REVIEW_CODE_LABELS — 사유 코드는 화면에서 전부 한국어", () => {
  it("모든 라벨이 비어 있지 않고 영어 코드 형태가 아니다", () => {
    for (const [code, label] of Object.entries(REVIEW_CODE_LABELS)) {
      expect(label.trim().length, code).toBeGreaterThan(0);
      expect(label, code).not.toMatch(/^[A-Z_]+$/);
      expect(label, code).toMatch(/[가-힣]/); // 한국어가 들어 있어야 한다
    }
  });

  it("reasonLabel 은 모르는 코드도 안전하게 처리한다", () => {
    expect(reasonLabel("OCR_DISAGREEMENT")).toContain("판독");
    expect(reasonLabel("UNKNOWN_FUTURE_CODE")).toBe("확인 필요 (UNKNOWN_FUTURE_CODE)");
  });

  it("reviewReasonsSummary 는 JSON 사유를 한국어 한 줄로 만든다", () => {
    const json = JSON.stringify([
      { code: "OCR_DISAGREEMENT", detail: "舒适体验升级" },
      { code: "UNTRANSLATED", detail: "防水设计" },
    ]);
    const s = reviewReasonsSummary(json);
    expect(s).toContain("판독");
    expect(s).toContain("舒适体验升级"); // 어떤 문구인지는 원문 그대로 보여준다
    expect(s).not.toContain("OCR_DISAGREEMENT"); // 코드는 숨긴다
    expect(s).not.toContain("UNTRANSLATED");
  });

  it("망가진 JSON·빈 값도 죽지 않는다", () => {
    expect(reviewReasonsSummary(null)).toBe("");
    expect(reviewReasonsSummary("")).toBe("");
    expect(reviewReasonsSummary("깨진{json")).toBe("깨진{json");
  });
});

/**
 * 사유 표시 다듬기 (2026-08-31 운영 실측).
 *
 * 실전 검수함에서 확인된 노출 문제 세 가지:
 *  1. 좌표 덤프 — "판독되지 않은 글자 영역 — [205,333,235,395] h24px 대비38 · …"
 *     운영자에게 완전히 무의미한 기술 정보가 사유의 절반을 차지했다.
 *  2. 월 지출 한도 초과가 영어 원문으로만 보였다 — 운영자가 원인을 알 수 없었다.
 *  3. 안전필터 거부 판별이 화면에 필요하다 — 거부 카드는 유료 재생성보다
 *     무료 직접 업로드를 먼저 권해야 한다.
 */
describe("reviewReasonsSummary — 좌표 덤프는 개수로 줄인다", () => {
  it("좌표 상세는 '몇 곳'으로 요약한다", () => {
    const json = JSON.stringify([
      { code: "UNEXPLAINED_TEXT", detail: "[205,333,235,395] h24px 대비38 · [538,18,553,40] h12px 대비33" },
      { code: "LOW_CONFIDENCE_TEXT", detail: "[570,853,578,865] h6px 확신0.4" },
    ]);
    const s = reviewReasonsSummary(json);
    expect(s).toContain("2곳");
    expect(s).toContain("1곳");
    expect(s).not.toContain("[205"); // 좌표는 숨긴다
    expect(s).not.toContain("h24px");
  });

  it("좌표가 아닌 상세(원문 문구)는 그대로 보여준다", () => {
    const json = JSON.stringify([{ code: "OCR_DISAGREEMENT", detail: "强震, 后庭开肛" }]);
    expect(reviewReasonsSummary(json)).toContain("强震");
  });
});

describe("reasonLine — 월 한도 초과는 한국어로 설명한다", () => {
  it("monthly spending cap 이 감지되면 전용 안내로 바꾼다", () => {
    const s = reviewReasonsSummary(
      JSON.stringify([{ code: "RATE_LIMITED", detail: "API 오류 429 (RESOURCE_EXHAUSTED | Your project has exceeded its monthly spending cap. Please go to AI Studio)" }]),
    );
    expect(s).toContain("이번 달");
    expect(s).toContain("지출 한도");
    expect(s).not.toContain("Your project"); // 영어 원문 숨김
  });

  it("일반 429 는 기존 안내 유지", () => {
    const s = reviewReasonsSummary(JSON.stringify([{ code: "RATE_LIMITED", detail: "API 오류 429" }]));
    expect(s).toContain("잠시 후 재시도");
  });
});

describe("hasSafetyRefusal — 진짜 거부만 판별한다", () => {
  it("모델 거부(PROHIBITED) 문구가 있으면 true", () => {
    expect(hasSafetyRefusal(JSON.stringify([{ code: "SAFETY_BLOCKED", detail: "모델 거부(PROHIBITED_CONTENT)" }]))).toBe(true);
    expect(hasSafetyRefusal(JSON.stringify([{ code: "RENDER_FAILED", detail: "모델 거부(PROHIBITED_CONTENT)" }]))).toBe(true);
  });

  /**
   * 실측(2026-08-31, 4회 반복 실험): "이미지를 반환하지 않음"은 거부와 다르다 —
   * 재시도 1회에 뒤집혀 이미지가 생성됐다(1/1). 반면 PROHIBITED 는 재시도해도
   * 반복 거부(2/2). 같은 SAFETY_BLOCKED 코드지만 화면 대응이 달라야 한다:
   * 미반환은 재시도 우선, 거부만 직접 업로드 우선.
   */
  it("'이미지를 반환하지 않음'(일시 미반환)은 거부가 아니다 — 재시도 가치가 있다", () => {
    expect(hasSafetyRefusal(JSON.stringify([{ code: "SAFETY_BLOCKED", detail: "이미지 모델이 이미지를 반환하지 않음" }]))).toBe(false);
  });

  it("그 외에는 false — 망가진 JSON 도 죽지 않는다", () => {
    expect(hasSafetyRefusal(JSON.stringify([{ code: "LEFTOVER", detail: "1건" }]))).toBe(false);
    expect(hasSafetyRefusal(null)).toBe(false);
    expect(hasSafetyRefusal("깨진{")).toBe(false);
  });
});
