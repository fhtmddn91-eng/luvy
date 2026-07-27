/**
 * 사업자 정보. 전자상거래법상 표시 의무 항목이므로 한 곳에서만 관리한다.
 * (사업자등록증 기준 — 값이 바뀌면 여기만 고치면 전 페이지에 반영된다)
 */
export const COMPANY = {
  /** 상호 (개인사업자라 '(주)' 를 붙이지 않는다) */
  name: "러비",
  /** 대표자 */
  ceo: "채재민",
  businessNumber: "775-62-00820",
  /** 통신판매업 신고번호. 신고 후 채워넣을 것 — 비어 있으면 화면에 표시하지 않는다. */
  mailOrderNumber: "",
  address: "경기도 남양주시 별내3로 326, 1동 6층 601-C16호 (별내동, 불암타워)",
  /** 반품·교환 수취 주소 (기본은 사업장 주소) */
  returnAddress: "경기도 남양주시 별내3로 326, 1동 6층 601-C16호 (별내동, 불암타워)",
  /** 고객센터 전화. 미정이면 비워두고 이메일만 노출한다. */
  tel: "",
  email: "help@luvyb2b.com",
  privacyEmail: "privacy@luvyb2b.com",
  /** 개인정보 보호책임자 */
  privacyOfficer: "채재민",
  hours: "평일 10:00 ~ 17:00 (점심 12:00 ~ 13:00 / 주말·공휴일 휴무)",
} as const;

/** 푸터·약관 등에 쓰는 한 줄 사업자 정보. 비어 있는 항목은 자동으로 빠진다. */
export function companyLine(): string {
  return [
    COMPANY.name,
    `대표 ${COMPANY.ceo}`,
    `사업자등록번호 ${COMPANY.businessNumber}`,
    COMPANY.mailOrderNumber && `통신판매업신고 ${COMPANY.mailOrderNumber}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 고객센터 연락처 한 줄. 전화번호가 없으면 이메일만 안내한다. */
export function contactLine(): string {
  return COMPANY.tel ? `고객센터 ${COMPANY.tel}` : `고객센터 ${COMPANY.email}`;
}

/** 문의 안내 문구에 쓰는 연락 수단 (전화 우선, 없으면 이메일). */
export const CONTACT_POINT: string = COMPANY.tel || COMPANY.email;
