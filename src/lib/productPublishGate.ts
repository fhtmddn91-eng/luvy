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
  /**
   * 운영자가 번역본을 버리고 원본을 택함 — **노출 차단**.
   * 복원은 "이 번역본이 나쁘다"는 결정이지 "외국어 원본을 손님에게 내보내도
   * 좋다"는 승인이 아니다. 자동 통과시키면 '원본 유지' 버튼 하나로 외국어 원본
   * 노출 금지가 통째로 우회된다 — 판매하려면 명시적 승인을 따로 받는다.
   */
  ORIGINAL_KEPT: "ORIGINAL_KEPT",
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
  | "UNTRANSLATED" // 외국어인데 번역이 비었거나 원문 그대로(에코) — "외국어 없음"과 절대 합치면 안 됨
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
  | "SAFETY_FALLBACK" // 안전 필터 거부 → 글자 띠 국소 편집 폴백 결과 — 이음새 육안 승인 필수
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

/**
 * 사유 코드 → 운영자용 한국어 라벨.
 *
 * 실사례(2026-08-30 피드백): 검수 카드에 "OCR_DISAGREEMENT: …" 같은 영어 코드가
 * 그대로 노출됐다. 운영자는 초보 1명이다 — 코드는 개발자용이지 화면용이 아니다.
 * Record<ReviewCode, string> 이라 새 코드를 추가하면 라벨을 안 넣으면 컴파일이
 * 안 된다 (조용한 누락 방지).
 */
export const REVIEW_CODE_LABELS: Record<ReviewCode, string> = {
  LEFTOVER: "외국어가 남아 있습니다",
  FLAGGED: "글자가 잘렸거나 깨졌을 수 있습니다",
  NUMBER_CHANGED: "숫자·규격이 원본과 달라졌습니다",
  NEW_TEXT: "원본에 없던 글자가 생겼습니다",
  PATCH_REJECTED: "글자 주변 배경이 어색할 수 있습니다",
  OCR_DISAGREEMENT: "글자 판독이 서로 달라 확인이 필요합니다",
  DENSE_GRID: "문구가 너무 많아 자동 합격이 안 됩니다",
  MEANING_UNCERTAIN: "번역 의미가 확실하지 않습니다",
  UNTRANSLATED: "번역되지 않은 문구가 있습니다",
  EXPANDED_PATCH_REVIEW: "수정 범위가 넓어 눈으로 확인이 필요합니다",
  UNEXPLAINED_TEXT: "판독되지 않은 글자 영역이 있습니다",
  LOW_CONFIDENCE_TEXT: "작은 글씨라 판독 확신이 낮습니다",
  DECOR_ALTERED: "영문·로고 장식이 달라졌을 수 있습니다",
  DUPLICATE_TRANSLATION: "서로 다른 문구가 같은 번역이 됐습니다",
  UNTRACKED_PHRASE: "일부 문구의 처리 결과를 확인하지 못했습니다",
  PRODUCT_CHANGED: "제품 모습이 원본과 달라 보입니다",
  LAYOUT_SHIFTED: "판 배치가 원본과 달라졌습니다",
  MEANING_MISMATCH: "번역 의미가 원문과 다를 수 있습니다",
  TEXT_ALTERED: "확정한 번역문과 다르게 그려졌습니다",
  SAFETY_BLOCKED: "모델이 이미지 생성을 거부했습니다",
  SAFETY_FALLBACK: "거부된 이미지를 글자 영역만 국소 편집했습니다 — 이음새를 확인해주세요",
  RATIO_MISMATCH: "이미지 비율이 원본과 다릅니다",
  OUTSIDE_CHANGED: "글자 밖 영역이 바뀌었습니다",
  EXTRA_TEXT: "번역 외의 글자가 덧붙었습니다",
  GIF_UNVERIFIED: "움직이는 이미지(GIF)라 눈으로 확인이 필요합니다",
  MANUAL_EDIT: "직접 수정한 결과 — 확인 후 승인해주세요",
  TIMEOUT: "시간이 초과됐습니다 — 재시도해주세요",
  RATE_LIMITED: "호출 한도에 걸렸습니다 — 잠시 후 재시도해주세요",
  AUTH_ERROR: "API 키 문제입니다 — 설정을 확인해주세요",
  SERVER_ERROR: "번역 서버 오류입니다 — 재시도해주세요",
  VERIFY_FAILED: "검사 과정이 실패했습니다",
  RENDER_FAILED: "이미지 생성이 실패했습니다",
};

/** 코드 하나 → 한국어. 모르는 코드(장래 추가분)는 안전하게 감싼다 */
export function reasonLabel(code: string): string {
  return (REVIEW_CODE_LABELS as Record<string, string>)[code] ?? `확인 필요 (${code})`;
}

/** 좌표 덤프("[205,333,235,395] h24px 대비38 · …") 판별 — 운영자에게 무의미한 기술 정보 */
const COORD_DUMP = /^\s*\[\d+,\d+,\d+,\d+\]/;

/**
 * 사유 한 건 → 운영자용 한 줄.
 *
 * 실전 검수함(2026-08-31)에서 확인된 원칙:
 *  - 좌표 덤프는 "N곳"으로 줄인다 — 어디인지는 원본·번역본을 눈으로 비교하면 보인다
 *  - 월 지출 한도 초과는 영어 원문 대신 무엇을 하면 되는지 한국어로 말한다
 *    (한도가 끝나 전부 429 로 죽었을 때 운영자가 원인을 몰라 헤맨 실사례)
 *  - 그 외 detail(문제가 된 원문 문구)은 그대로 — 코드가 아니라 단서다
 */
function reasonLine(code: string, detail?: string): string {
  if (code === "RATE_LIMITED" && detail && /monthly spending cap/i.test(detail)) {
    return "이번 달 API 지출 한도를 모두 썼습니다 — AI Studio 에서 한도를 올리거나 다음 달 1일 이후 재시도해주세요";
  }
  const label = reasonLabel(code);
  if (!detail) return label;
  if (COORD_DUMP.test(detail)) {
    const spots = detail.split("·").filter((part) => COORD_DUMP.test(part.trim())).length || 1;
    return `${label} (${spots}곳)`;
  }
  return `${label} — ${detail}`;
}

/** reviewReasons JSON → 운영자용 한국어 한 줄 */
export function reviewReasonsSummary(json: string | null | undefined): string {
  if (!json) return "";
  try {
    const arr = JSON.parse(json) as { code: string; detail?: string }[];
    return arr.map((r) => reasonLine(r.code, r.detail)).join(" · ").slice(0, 300);
  } catch {
    return json.slice(0, 200);
  }
}

/**
 * 진짜 안전필터 거부인가 — 거부 카드만 무료 직접 업로드를 먼저 권한다.
 *
 * 실측(2026-08-31, 반복 실험): PROHIBITED 거부는 재시도해도 반복 거부(2/2)지만,
 * "이미지를 반환하지 않음"(일시 미반환)은 재시도 1회에 뒤집혀 생성에 성공했다
 * (1/1). 같은 SAFETY_BLOCKED 코드라도 미반환까지 거부로 묶으면 재시도 가치가
 * 있는 장에 업로드부터 권하게 된다 — detail 문구로 가른다.
 */
export function hasSafetyRefusal(json: string | null | undefined): boolean {
  if (!json) return false;
  try {
    const arr = JSON.parse(json) as { code: string; detail?: string }[];
    return arr.some((r) => /모델 거부|PROHIBITED/i.test(r.detail ?? ""));
  } catch {
    return false;
  }
}

/**
 * 상품 저장 폼의 상태 값으로부터 실제로 쓸 status·publishRequestedAt 을 정한다.
 *
 * ACTIVE 는 여기서 쓰지 않는다(status: undefined) — 번역·브랜드 게이트를 거치는
 * requestPublish 가 ACTIVE 로 올릴지 보류할지 정한다.
 *
 * **ACTIVE 가 아닌 저장은 대기 중인 판매 요청을 반드시 취소한다.**
 * 실사례(2026-08-27 감사): 숨김 저장이 publishRequestedAt 을 남겨둬서, 판매 요청
 * 후 마음을 바꿔 숨긴 상품을 백그라운드 번역 완료 시점의 promoteIfReady 가
 * 그 기록만 보고 ACTIVE 로 되살렸다 — 운영자가 숨긴 상품이 손님에게 노출됐다.
 */
export function productSaveStatusData(formStatus: string): {
  status?: string;
  publishRequestedAt?: null;
} {
  if (formStatus === "ACTIVE") return { status: undefined };
  return { status: formStatus, publishRequestedAt: null };
}

/**
 * 운영자가 "원본 유지"를 택했을 때 자산에 쓸 상태.
 *
 * **노출은 차단한다(fail-closed).** 복원은 "이 번역본이 나쁘다"는 결정이지
 * "중국어 원본을 손님에게 내보내도 좋다"는 승인이 아니다 — 통과시키면
 * promoteIfReady 가 ACTIVE 로 올려서 외국어 원본 노출 금지가 우회된다.
 *
 * 다만 originalUrl 은 남긴다. 실사례(2026-08-27 감사): 복원이 originalUrl 까지
 * null 로 지워서 게이트가 이걸 "미번역"과 구분하지 못했고, 어드민 화면에도
 * 왜 막혔는지가 안 보였다. ORIGINAL_KEPT 로 사유를 분명히 남긴다.
 */
export function revertedAssetTranslation(originalUrl: string): {
  url: string;
  originalUrl: string;
  translateStatus: string;
} {
  return { url: originalUrl, originalUrl, translateStatus: TRANSLATE_STATUS.ORIGINAL_KEPT };
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
    /** 운영자가 원본을 택한 장 — 외국어가 남아 있을 수 있어 명시적 판매 승인 필요 */
    originalKept: number;
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
  const blocking = { translating: 0, review: 0, retryable: 0, failed: 0, untranslated: 0, originalKept: 0, brandMissing: 0 };
  if (isPlaceholderBrand(brand)) blocking.brandMissing = 1;
  if (!needsTranslation) return { ready: blocking.brandMissing === 0, blocking };
  for (const a of assets) {
    const s = a.translateStatus;
    if (s === TRANSLATE_STATUS.TRANSLATING) blocking.translating++;
    else if (s === TRANSLATE_STATUS.NEEDS_REVIEW || s === TRANSLATE_STATUS.VERIFICATION_FAILED) blocking.review++;
    else if (s === TRANSLATE_STATUS.ORIGINAL_KEPT) blocking.originalKept++;
    else if (s === TRANSLATE_STATUS.RETRYABLE) blocking.retryable++;
    else if (s === TRANSLATE_STATUS.FAILED) blocking.failed++;
    else if (s === null && a.originalUrl === null) blocking.untranslated++;
    // VERIFIED · NO_FOREIGN_TEXT · legacy(null + originalUrl 있음) → 통과
  }
  const ready = Object.values(blocking).every((n) => n === 0);
  return { ready, blocking };
}

/**
 * 판매 노출을 막는 번역 상태 전부 — 어드민 "판매 보류" 배지의 카운트 기준.
 *
 * 게이트와 따로 관리하면 어긋난다. 실사례(2026-08-27 감사): 어드민 목록이
 * 이 배열을 직접 적어 두는 바람에 ORIGINAL_KEPT 가 빠졌고, 그 상태로만 막힌
 * 상품은 배지에 사유 없이 "보류"로만 떠서 무엇을 해야 풀리는지 알 수 없었다.
 * productPublishGate 와 양방향 일치를 테스트로 못 박는다.
 */
export const BLOCKING_TRANSLATE_STATUSES: string[] = [
  TRANSLATE_STATUS.TRANSLATING,
  TRANSLATE_STATUS.NEEDS_REVIEW,
  TRANSLATE_STATUS.VERIFICATION_FAILED,
  TRANSLATE_STATUS.RETRYABLE,
  TRANSLATE_STATUS.FAILED,
  TRANSLATE_STATUS.ORIGINAL_KEPT,
];

/**
 * 번역 검수함이 다루는 상태 — 운영자가 지금 할 일이 있는 것만.
 * BLOCKING 에서 TRANSLATING 만 뺀 것이다(진행 중이라 할 일이 없다).
 */
export const REVIEWABLE_TRANSLATE_STATUSES: string[] = BLOCKING_TRANSLATE_STATUSES.filter(
  (s) => s !== TRANSLATE_STATUS.TRANSLATING,
);

/** 어드민 배지용 요약문 — "번역 중 2 · 검수 1" */
export function gateSummary(g: GateResult): string {
  if (g.ready) return "";
  const parts: string[] = [];
  if (g.blocking.untranslated) parts.push(`미번역 ${g.blocking.untranslated}`);
  if (g.blocking.translating) parts.push(`번역 중 ${g.blocking.translating}`);
  if (g.blocking.review) parts.push(`검수 ${g.blocking.review}`);
  if (g.blocking.retryable) parts.push(`재시도 대기 ${g.blocking.retryable}`);
  if (g.blocking.failed) parts.push(`실패 ${g.blocking.failed}`);
  if (g.blocking.originalKept) parts.push(`원본 유지 ${g.blocking.originalKept}`);
  if (g.blocking.brandMissing) parts.push("브랜드 미정");
  return parts.join(" · ");
}
