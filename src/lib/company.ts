/**
 * 사업자 정보. 전자상거래법상 표시 의무 항목이라 한 곳에서만 관리한다.
 *
 * 여기 값은 **기본값**이고, 관리자 → 설정에서 덮어쓸 수 있다(`companyInfo.ts`).
 * 화면에서는 `getCompany()` 를 쓰고, 이 파일은 설정이 비었을 때의 바닥값과
 * 표시용 순수 함수만 담당한다 (순수 모듈이라 테스트가 쉽다).
 */
export interface CompanyInfo {
  /** 상호 (개인사업자라 '(주)' 를 붙이지 않는다) */
  name: string;
  /** 대표자 */
  ceo: string;
  businessNumber: string;
  /** 통신판매업 신고번호. 비어 있으면 화면에 표시하지 않는다. */
  mailOrderNumber: string;
  address: string;
  /** 반품·교환 수취 주소 (기본은 사업장 주소) */
  returnAddress: string;
  /** 고객센터 전화. 미정이면 비워두고 이메일만 노출한다. */
  tel: string;
  email: string;
  privacyEmail: string;
  /** 개인정보 보호책임자 */
  privacyOfficer: string;
  hours: string;
}

/** 사업자등록증 기준 기본값 */
export const COMPANY: CompanyInfo = {
  name: "러비",
  ceo: "채재민",
  businessNumber: "775-62-00820",
  // 2026-07-30 남양주시(별내동) 신고 수리
  mailOrderNumber: "제2026-별내-0024호",
  address: "경기도 남양주시 별내3로 326, 1동 6층 601-C16호 (별내동, 불암타워)",
  returnAddress: "경기도 남양주시 별내3로 326, 1동 6층 601-C16호 (별내동, 불암타워)",
  tel: "",
  email: "help@luvyb2b.com",
  privacyEmail: "privacy@luvyb2b.com",
  privacyOfficer: "채재민",
  hours: "평일 10:00 ~ 17:00 (점심 12:00 ~ 13:00 / 주말·공휴일 휴무)",
};

/** 편집 가능한 항목 목록 — 관리자 폼과 저장 로직이 같은 표를 본다 */
export const COMPANY_FIELDS: { key: keyof CompanyInfo; label: string; help?: string }[] = [
  { key: "name", label: "상호" },
  { key: "ceo", label: "대표자" },
  { key: "businessNumber", label: "사업자등록번호" },
  { key: "mailOrderNumber", label: "통신판매업 신고번호", help: "비워두면 화면에 표시하지 않습니다." },
  { key: "address", label: "사업장 주소" },
  { key: "returnAddress", label: "반품·교환 주소" },
  { key: "tel", label: "고객센터 전화", help: "비워두면 이메일만 안내합니다." },
  { key: "email", label: "고객센터 이메일" },
  { key: "privacyEmail", label: "개인정보 문의 이메일" },
  { key: "privacyOfficer", label: "개인정보 보호책임자" },
  { key: "hours", label: "운영 시간" },
];

/** 푸터·약관 등에 쓰는 한 줄 사업자 정보. 비어 있는 항목은 자동으로 빠진다. */
export function companyLine(c: CompanyInfo = COMPANY): string {
  return [
    c.name,
    `대표 ${c.ceo}`,
    `사업자등록번호 ${c.businessNumber}`,
    c.mailOrderNumber && `통신판매업신고 ${c.mailOrderNumber}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 고객센터 연락처 한 줄. 전화번호가 없으면 이메일만 안내한다. */
export function contactLine(c: CompanyInfo = COMPANY): string {
  return c.tel ? `고객센터 ${c.tel}` : `고객센터 ${c.email}`;
}

/** 문의 안내 문구에 쓰는 연락 수단 (전화 우선, 없으면 이메일). */
export function contactPoint(c: CompanyInfo = COMPANY): string {
  return c.tel || c.email;
}

/**
 * 저장된 설정을 기본값 위에 얹는다.
 * 값이 없거나 빈 문자열인 항목은 기본값을 그대로 쓴다 — 단, 원래부터
 * 비워두는 게 정상인 항목(신고번호·전화)은 빈 값도 존중해야 하므로
 * "저장된 키가 존재하는가"로 판단한다.
 */
export function mergeCompany(overrides: Record<string, string>): CompanyInfo {
  const out = { ...COMPANY };
  for (const { key } of COMPANY_FIELDS) {
    const v = overrides[key];
    if (typeof v === "string") out[key] = v;
  }
  return out;
}
