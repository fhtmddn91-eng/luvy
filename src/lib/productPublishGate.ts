/**
 * 판매 노출 게이트 — "기계가 깨끗하다고 확인 못 한 이미지는 손님에게 안 나간다"
 * (설계 2026-08-24 v2.1 정책 9·10).
 *
 * 순수 함수다. DB 를 읽고 상태를 바꾸는 쪽(actions / translateAssets)이 이 판정을
 * 따른다 — 판정 로직이 두 군데로 갈라지면 한쪽만 고쳐져 구멍이 난다.
 */

export const TRANSLATE_STATUS = {
  /** 번역 진행 중 — 노출 차단 */
  TRANSLATING: "TRANSLATING",
  /** 모든 검사를 실제 통과 — 노출 허용 */
  VERIFIED: "VERIFIED",
  /** 전체·분할 OCR 둘 다 외국어 0건 — 노출 허용 */
  NO_FOREIGN_TEXT: "NO_FOREIGN_TEXT",
  /** 검사는 됐는데 합격을 못 줌(잔류·새 문구·밀집 등) — 후보 보존, 노출 차단 */
  NEEDS_REVIEW: "NEEDS_REVIEW",
  /** 일시 오류(타임아웃·429·5xx) — 운영자 재시도 승인 대기, 노출 차단 */
  RETRYABLE: "RETRYABLE",
  /** 검사를 하지 못함(판독·관문 호출 실패) — 노출 차단 */
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  /** 모델/렌더 실패 — 원본 유지, 노출 차단 */
  FAILED: "FAILED",
} as const;

export type TranslateStatus = (typeof TRANSLATE_STATUS)[keyof typeof TRANSLATE_STATUS];

/** 검수 사유 코드 — reviewReasons JSON 의 code 필드 */
export type ReviewCode =
  | "LEFTOVER" // 최종 관문에서 외국어 잔존
  | "FLAGGED" // 박스 검수 불합격 (잔류·잘림·자모)
  | "NUMBER_CHANGED" // 숫자·단위·모델명 변조
  | "NEW_TEXT" // 원문에 없던 새 글자 생성
  | "PATCH_REJECTED" // 패치 경계 불합격 문구 있음
  | "OCR_DISAGREEMENT" // 교차 OCR 이 합의 못 한 문구
  | "DENSE_GRID" // 문구 30개 이상 밀집 — 자동 합격 불가
  | "MEANING_UNCERTAIN" // 의미 검수 2회 실패 (렌더 전 차단)
  | "EXPANDED_PATCH_REVIEW" // 확장 rect 패치 — 링 검증 미탐(장식 진해짐·윤곽 밀림) 위험, 육안 승인 필수
  | "UNEXPLAINED_TEXT" // 원본의 문자 영역이 번역·보존·검수 어디에도 안 잡힘 (OCR 누락 의심)
  | "LOW_CONFIDENCE_TEXT" // 작은 글자·저대비·하단 — 판독 확신이 낮아 자동 통과 불가
  | "DECOR_ALTERED" // 영문·브랜드·숫자·모델코드 장식이 소실·변형·픽셀 변화
  | "DUPLICATE_TRANSLATION" // 서로 다른 원문이 같은 번역문 — 셀 복제·매핑 사고 전조 (렌더 전 차단)
  | "UNTRACKED_PHRASE" // 번역 대상인데 렌더 결과 추적 상태가 없음 — 조용한 누락
  | "PRODUCT_CHANGED" // 제품 개수·형태·색상·구성이 원본과 다름 (전체 채택 무결성 심사)
  | "LAYOUT_SHIFTED" // 모델이 판을 다시 흘려 원본 좌표와 어긋남 — 패치 다수 거부
  | "MEANING_MISMATCH" // 원문 ↔ 최종 이미지 판독문 의미 불일치 (누락·추가·과장·성적 강화)
  | "TEXT_ALTERED" // 확정 번역문 ↔ 최종 판독문 불일치 — 모델이 문구를 임의로 바꿈
  | "SAFETY_BLOCKED" // 안전 필터 거부
  | "RATIO_MISMATCH" // 재생성 비율 불일치
  | "OUTSIDE_CHANGED" // 허용 패치 영역 밖 픽셀 변화
  | "EXTRA_TEXT" // 번역 박스 안에 기대 문구 외의 추가 문구(환각)
  | "GIF_UNVERIFIED" // GIF 재부호화 — 패치 밖 보존을 프레임 단위로 증명 못 함, 육안 확인
  | "MANUAL_EDIT" // 운영자 문구 수정 재렌더 — 육안 승인 대기
  | "TIMEOUT" // 이미지 호출 시간 초과
  | "RATE_LIMITED" // 429 (월 지출 한도 포함)
  | "AUTH_ERROR" // 401·403 — 키 문제, 재시도 전에 키부터
  | "SERVER_ERROR" // 5xx
  | "VERIFY_FAILED" // 검수 호출 자체 실패
  | "RENDER_FAILED"; // 그 외 렌더 실패

export interface ReviewReason {
  code: ReviewCode;
  detail: string;
}

/** 노출(판매·VERIFIED 취급)이 허용되는 상태 — null 은 legacy(구 파이프라인·국내) */
export function allowsExposure(status: string | null): boolean {
  return status === null || status === TRANSLATE_STATUS.VERIFIED || status === TRANSLATE_STATUS.NO_FOREIGN_TEXT;
}

/**
 * 수집 파이프라인이 넣는 브랜드 자리표시자 — **실제 브랜드가 아니다**.
 * 1688·국내 도매처 수집 상품은 브랜드를 모르는 채로 들어오는데, 폼 검증이
 * 브랜드를 필수로 요구해서 빈 문자열 대신 이 값을 넣어 왔다. 그 결과
 * 손님 화면(브랜드관·상품 상세)에 "미정"이 브랜드 하나로 노출됐다 —
 * 브랜드관은 상품 많은 순 정렬이라 수집분이 맨 앞 최대 카드로 떴다.
 * 이 값은 "브랜드 없음"으로 취급한다: 노출도 판매 전환도 막는다.
 */
export const PLACEHOLDER_BRAND = "미정";

/** 손님에게 보여줄 수 없는 브랜드인가 (자리표시자·빈 값) */
export function isPlaceholderBrand(brand: string | null | undefined): boolean {
  const b = (brand ?? "").trim();
  return b === "" || b === PLACEHOLDER_BRAND;
}

export interface GateAsset {
  translateStatus: string | null;
  /** null 이면 미번역 원본 */
  originalUrl: string | null;
}

export interface GateResult {
  ready: boolean;
  blocking: {
    translating: number;
    review: number; // NEEDS_REVIEW + VERIFICATION_FAILED
    retryable: number;
    failed: number;
    /** 번역 대상인데 아직 안 돌린 장 (originalUrl·상태 둘 다 없음) */
    untranslated: number;
    /** 브랜드가 자리표시자("미정")·빈 값 — 운영자가 입력해야 풀린다 */
    brandMissing: number;
  };
}

/**
 * 상품을 ACTIVE 로 내보내도 되는가.
 * needsTranslation=false(국내 도매처·수동 등록)면 번역 검사는 건너뛴다 — 원문이 한국어다.
 * 번역 대상 소스는 전 장이 노출 허용 상태여야 한다. legacy(원본 교체됐고 상태
 * null)는 허용 — 기존 판매 상품을 한꺼번에 숨기지 않는다(v1 결정).
 *
 * 브랜드 검사는 소스와 무관하게 항상 한다 — "미정"은 1688·국내 도매처 수집분
 * **양쪽 모두**에 붙기 때문이다. brand 를 필수 인자로 둔 이유: 선택 인자로 두면
 * 호출부 하나가 빠뜨려도 조용히 통과한다(번역 게이트가 그렇게 새는 걸 이미 겪었다).
 */
export function productPublishGate(assets: GateAsset[], needsTranslation: boolean, brand: string | null | undefined): GateResult {
  const blocking = { translating: 0, review: 0, retryable: 0, failed: 0, untranslated: 0, brandMissing: 0 };
  if (isPlaceholderBrand(brand)) blocking.brandMissing = 1;
  if (!needsTranslation) return { ready: blocking.brandMissing === 0, blocking };
  for (const a of assets) {
    const s = a.translateStatus;
    if (s === TRANSLATE_STATUS.TRANSLATING) blocking.translating++;
    else if (s === TRANSLATE_STATUS.NEEDS_REVIEW || s === TRANSLATE_STATUS.VERIFICATION_FAILED) blocking.review++;
    else if (s === TRANSLATE_STATUS.RETRYABLE) blocking.retryable++;
    else if (s === TRANSLATE_STATUS.FAILED) blocking.failed++;
    else if (s === null && a.originalUrl === null) blocking.untranslated++;
    // VERIFIED · NO_FOREIGN_TEXT · legacy(null + originalUrl 있음) → 통과
  }
  const ready = Object.values(blocking).every((n) => n === 0);
  return { ready, blocking };
}

/** 어드민 배지용 요약문 — "번역 중 2 · 검수 1" */
export function gateSummary(g: GateResult): string {
  if (g.ready) return "";
  const parts: string[] = [];
  if (g.blocking.untranslated) parts.push(`미번역 ${g.blocking.untranslated}`);
  if (g.blocking.translating) parts.push(`번역 중 ${g.blocking.translating}`);
  if (g.blocking.review) parts.push(`검수 ${g.blocking.review}`);
  if (g.blocking.retryable) parts.push(`재시도 대기 ${g.blocking.retryable}`);
  if (g.blocking.failed) parts.push(`실패 ${g.blocking.failed}`);
  if (g.blocking.brandMissing) parts.push("브랜드 미정");
  return parts.join(" · ");
}
