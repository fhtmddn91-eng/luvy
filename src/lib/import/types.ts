/** 1688 등 외부 소스에서 수집한 상품 초안. 파서와 저장 로직의 경계 타입. */

export interface RawTier {
  minQty: number;
  /** 원본 통화(CNY) 단가 */
  price: number;
}

export interface ImportDraft {
  /** SourceSite.id — "1688" 또는 국내 도매처 id */
  source: string;
  /**
   * 재수집 중복 방지 키(Product.sourceId, 전역 유니크).
   * 1688 은 offerId 그대로, 국내 도매처는 `사이트id:상품번호` —
   * 쇼핑몰마다 1번부터 번호를 매겨 접두사 없이는 서로 충돌한다.
   */
  sourceId: string;
  sourceUrl: string;
  /** 원문(중국어) 상품명 */
  rawTitle: string;
  /** 원문 속성/스펙 (번역 대상) */
  rawAttributes: { label: string; value: string }[];
  /** 대표 이미지 URL (원격) */
  mainImages: string[];
  /** 상세페이지 이미지 URL (원격, GIF 포함) */
  detailImages: string[];
  /** 옵션(색상·사이즈) 썸네일 URL */
  optionImages: string[];
  /** 수량별 단가 (CNY) */
  tiers: RawTier[];
  /** 최소 주문 수량 */
  moq: number;
}

/** 수집 payload — 북마클릿이 보내거나 관리자가 붙여넣는 원시 데이터 */
export interface ImportPayload {
  url?: string;
  /**
   * 북마클릿이 판별한 도매처 id. URL 로도 판별하지만, 쿼리형 주소나
   * 서브도메인 때문에 URL 판별이 빗나갈 때의 보조 수단이다.
   * 서버는 이 값을 **등록된 도매처 목록과 대조한 뒤에만** 신뢰한다.
   */
  site?: string;
  /** 북마클릿이 페이지에서 뽑아낸 구조화 데이터 */
  extracted?: unknown;
  /** 붙여넣은 페이지 HTML (fallback) */
  html?: string;
}

export type ParseResult =
  | { ok: true; draft: ImportDraft }
  | { ok: false; error: string };
