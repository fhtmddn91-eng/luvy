/**
 * 무통장입금 계좌.
 *
 * 여기 값은 **기본값**이고, 관리자 → 설정에서 덮어쓸 수 있다(`bankAccountInfo.ts`).
 * 계좌가 바뀔 때 배포를 기다리지 않아도 되도록 company.ts 와 같은 구조로 맞췄다.
 *
 * 순수 모듈이라 테스트가 쉽다 — DB·서버 의존이 없다.
 */
export interface BankAccount {
  /** 은행명 */
  bank: string;
  /** 계좌번호 */
  number: string;
  /** 예금주 */
  holder: string;
}

/** 현재 입금 계좌 */
export const BANK_ACCOUNT: BankAccount = {
  bank: "하나은행",
  number: "724-910736-08907",
  holder: "채재민",
};

/** 편집 가능한 항목 — 관리자 폼과 저장 로직이 같은 표를 본다 */
export const BANK_FIELDS: { key: keyof BankAccount; label: string; help?: string }[] = [
  { key: "bank", label: "은행명" },
  { key: "number", label: "계좌번호", help: "하이픈(-) 포함해서 보이는 그대로 입력하세요." },
  { key: "holder", label: "예금주" },
];

/** 저장값에 빈 항목이 있으면 그 자리는 기본값으로 메운다 */
export function mergeBankAccount(overrides: Record<string, string | undefined>): BankAccount {
  const merged = { ...BANK_ACCOUNT };
  for (const { key } of BANK_FIELDS) {
    const v = overrides[key]?.trim();
    if (v) merged[key] = v;
  }
  return merged;
}

/**
 * 주문서·완료 화면에 한 줄로 보여줄 문자열.
 * 셋 중 하나라도 비면 안내를 아예 띄우지 않는 편이 낫다 → 빈 문자열을 돌려준다.
 */
export function formatBankAccount(a: BankAccount): string {
  if (!a.bank.trim() || !a.number.trim() || !a.holder.trim()) return "";
  return `${a.bank} ${a.number} (예금주: ${a.holder})`;
}
