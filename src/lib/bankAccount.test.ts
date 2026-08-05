import { describe, it, expect } from "vitest";
import {
  BANK_ACCOUNT,
  mergeBankAccount,
  formatBankAccount,
  type BankAccount,
} from "./bankAccount";

describe("bankAccount", () => {
  it("기본 계좌가 채워져 있다", () => {
    expect(BANK_ACCOUNT.bank).toBe("하나은행");
    expect(BANK_ACCOUNT.number).toBe("724-910736-08907");
    expect(BANK_ACCOUNT.holder).toBe("채재민");
  });

  it("한 줄 안내 문자열을 만든다", () => {
    expect(formatBankAccount(BANK_ACCOUNT)).toBe("하나은행 724-910736-08907 (예금주: 채재민)");
  });

  // 계좌가 반쯤 비어 있으면 "하나은행  (예금주: )" 같은 문구가 나가느니 안 띄우는 게 낫다
  it("항목이 하나라도 비면 빈 문자열을 돌려준다", () => {
    const cases: BankAccount[] = [
      { bank: "", number: "1", holder: "김" },
      { bank: "하나", number: "", holder: "김" },
      { bank: "하나", number: "1", holder: "" },
      { bank: "하나", number: "1", holder: "   " },
    ];
    for (const c of cases) expect(formatBankAccount(c)).toBe("");
  });

  it("설정값이 있으면 덮어쓴다", () => {
    const merged = mergeBankAccount({ bank: "국민은행", number: "1234-56-7890", holder: "홍길동" });
    expect(formatBankAccount(merged)).toBe("국민은행 1234-56-7890 (예금주: 홍길동)");
  });

  it("설정값이 비어 있으면 그 자리는 기본값을 쓴다", () => {
    const merged = mergeBankAccount({ bank: "국민은행", number: "  ", holder: undefined });
    expect(merged.bank).toBe("국민은행");
    expect(merged.number).toBe(BANK_ACCOUNT.number);
    expect(merged.holder).toBe(BANK_ACCOUNT.holder);
  });

  it("설정이 통째로 비어도 기본 계좌가 나온다", () => {
    expect(mergeBankAccount({})).toEqual(BANK_ACCOUNT);
  });
});
