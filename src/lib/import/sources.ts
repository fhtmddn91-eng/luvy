/**
 * 수집 대상 도매처 목록.
 *
 * 1688 하나만 있을 때는 규칙이 코드 곳곳에 흩어져 있었다(이미지 호스트 화이트리스트,
 * 번역 여부, 통화). 국내 도매처가 들어오면서 "사이트마다 다른 것"을 여기 한곳에 모은다 —
 * 새 도매처를 붙일 때 고쳐야 할 곳이 이 파일 하나면 되도록.
 *
 * 국내 도매처는 이미 한국어라 번역 파이프라인을 태우지 않는다(translate: false).
 * 상품명·설명 번역도, 이미지 속 글자 번역도 건너뛴다 — 수집이 훨씬 빠르고 비용도 안 든다.
 */

export interface SourceSite {
  /** draft.source 에 저장되는 값. 상품 중복 판정 키의 일부 */
  id: string;
  /** 관리자 화면에 보여줄 이름 */
  label: string;
  /** 이 사이트인지 판별 (location.hostname 기준) */
  host: RegExp;
  /**
   * 관리자 화면에 보여줄 대표 도메인.
   * host 정규식에서 역산하면 표기가 깨지므로(`(^|\.)` 같은 문법이 섞여 나온다)
   * 보여줄 문자열은 따로 적는다.
   */
  domain: string;
  /**
   * 이미지 다운로드를 허용할 호스트.
   * payload 는 외부에서 오므로 아무 호스트나 받으면 서버가 내부망을 긁는
   * SSRF 통로가 된다. 사이트별로 실제 이미지가 올라오는 호스트만 연다.
   */
  imageHost: RegExp;
  /** 중국어 번역 파이프라인(상품명·설명·이미지)을 태울지 */
  translate: boolean;
  /** 수집한 가격의 통화 — 설명에 남기는 참고가 표기에 쓴다 */
  currency: "CNY" | "KRW";
}

/**
 * 국내 도매처 3곳(도라도라·핑크박스·러브몰)은 모두 Cafe24 로 만들어져 있어
 * 상세페이지 구조가 같다 — 북마클릿 어댑터 하나로 셋을 커버한다.
 * Cafe24 는 이미지를 자기 CDN(cafe24img.com 등)에 올리지만, 쇼핑몰 도메인에
 * 직접 올라간 이미지도 흔해서 각 사이트 도메인도 함께 연다.
 */
export const SOURCES: SourceSite[] = [
  {
    id: "1688",
    label: "1688",
    domain: "1688.com",
    host: /(^|\.)1688\.com$/i,
    imageHost: /(^|\.)alicdn\.com$/i,
    translate: true,
    currency: "CNY",
  },
  {
    id: "doradora",
    label: "도라도라",
    domain: "doradora.kr",
    host: /(^|\.)doradora\.kr$/i,
    imageHost: /(^|\.)(doradora\.kr|cafe24img\.com|cafe24\.com)$/i,
    translate: false,
    currency: "KRW",
  },
  {
    id: "pinkbox",
    label: "핑크박스",
    domain: "pinkboxb2b.com",
    host: /(^|\.)pinkboxb2b\.com$/i,
    imageHost: /(^|\.)(pinkboxb2b\.com|cafe24img\.com|cafe24\.com)$/i,
    translate: false,
    currency: "KRW",
  },
  {
    id: "lovemall",
    label: "러브몰",
    domain: "0625.co.kr",
    host: /(^|\.)0625\.co\.kr$/i,
    imageHost: /(^|\.)(0625\.co\.kr|cafe24img\.com|cafe24\.com)$/i,
    translate: false,
    currency: "KRW",
  },
  {
    id: "ribos",
    label: "리보스",
    domain: "oxox.co.kr",
    host: /(^|\.)oxox\.co\.kr$/i,
    // 대표이미지는 admin.oxox.co.kr, 상세이미지는 rebossshop.cafe24.com 에 있다
    // (실측 K-579). cafe24 를 안 열면 상세이미지가 전부 버려진다.
    imageHost: /(^|\.)(oxox\.co\.kr|cafe24img\.com|cafe24\.com)$/i,
    translate: false,
    currency: "KRW",
  },
  {
    id: "redgroup",
    label: "레드그룹",
    domain: "redgroup.co.kr",
    host: /(^|\.)redgroup\.co\.kr$/i,
    // 이미지가 자기 서버가 아니라 가비아 웹하드(redlove.speedgabia.com)에 있다
    // (실측 gcode=1858 — 대표는 .img 확장자, 상세는 /products/*.jpg)
    imageHost: /(^|\.)(redgroup\.co\.kr|speedgabia\.com)$/i,
    translate: false,
    currency: "KRW",
  },
];

const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

/** 호스트명으로 도매처 찾기 — 등록되지 않은 사이트면 null */
export function sourceForHost(hostname: string): SourceSite | null {
  const h = hostname.trim().toLowerCase();
  return SOURCES.find((s) => s.host.test(h)) ?? null;
}

/** draft.source 값으로 도매처 찾기 */
export function sourceById(id: string): SourceSite | null {
  return BY_ID.get(id) ?? null;
}

/**
 * URL 로 도매처 찾기. 파싱 실패나 미등록 사이트는 null —
 * 호출부에서 "지원하지 않는 사이트"로 처리해 임의 호스트 수집을 막는다.
 */
export function sourceForUrl(url: string): SourceSite | null {
  try {
    return sourceForHost(new URL(url).hostname);
  } catch {
    return null;
  }
}
