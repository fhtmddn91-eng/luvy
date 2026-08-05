import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import {
  BANK_ACCOUNT,
  BANK_FIELDS,
  mergeBankAccount,
  type BankAccount,
} from "@/lib/bankAccount";

/** Setting 테이블 키 접두어 */
const PREFIX = "bank_";

/**
 * 화면에 쓸 입금 계좌. 관리자가 저장한 값이 있으면 그걸, 없으면 코드 기본값.
 *
 * 조회가 실패해도 주문서는 떠야 하므로 예외를 삼키고 기본값을 돌려준다 —
 * 설정 하나 때문에 결제 화면이 500이 나면 주문을 통째로 놓친다.
 */
export const getBankAccount = cache(async (): Promise<BankAccount> => {
  try {
    const rows = await db.setting.findMany({ where: { key: { startsWith: PREFIX } } });
    const overrides: Record<string, string> = {};
    for (const r of rows) overrides[r.key.slice(PREFIX.length)] = r.value;
    return mergeBankAccount(overrides);
  } catch (e) {
    console.error("[bank] 설정 조회 실패 — 기본값 사용:", e);
    return BANK_ACCOUNT;
  }
});

export async function saveBankAccount(values: Record<string, string>): Promise<void> {
  const writes = BANK_FIELDS.map(({ key }) => {
    const value = (values[key] ?? "").trim().slice(0, 100);
    return db.setting.upsert({
      where: { key: PREFIX + key },
      create: { key: PREFIX + key, value },
      update: { value },
    });
  });
  await db.$transaction(writes);
}

/** 저장한 값을 모두 지워 코드 기본값으로 되돌린다 */
export async function resetBankAccount(): Promise<void> {
  await db.setting.deleteMany({ where: { key: { startsWith: PREFIX } } });
}
