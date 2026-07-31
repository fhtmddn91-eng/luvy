import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { COMPANY, COMPANY_FIELDS, mergeCompany, type CompanyInfo } from "@/lib/company";

/** Setting 테이블 키 접두어 */
const PREFIX = "company_";

/**
 * 화면에 쓸 사업자 정보. 관리자가 저장한 값이 있으면 그걸, 없으면 코드 기본값.
 *
 * 조회가 실패해도 화면(푸터·약관)은 떠야 하므로 예외를 삼키고 기본값을 돌려준다 —
 * 설정 하나 때문에 전 페이지가 500이 나면 안 된다.
 */
export const getCompany = cache(async (): Promise<CompanyInfo> => {
  try {
    const rows = await db.setting.findMany({ where: { key: { startsWith: PREFIX } } });
    const overrides: Record<string, string> = {};
    for (const r of rows) overrides[r.key.slice(PREFIX.length)] = r.value;
    return mergeCompany(overrides);
  } catch (e) {
    console.error("[company] 설정 조회 실패 — 기본값 사용:", e);
    return COMPANY;
  }
});

export async function saveCompany(values: Record<string, string>): Promise<void> {
  const writes = COMPANY_FIELDS.map(({ key }) => {
    const value = (values[key] ?? "").trim().slice(0, 200);
    return db.setting.upsert({
      where: { key: PREFIX + key },
      create: { key: PREFIX + key, value },
      update: { value },
    });
  });
  await db.$transaction(writes);
}

/** 저장한 값을 모두 지워 코드 기본값으로 되돌린다 */
export async function resetCompany(): Promise<void> {
  await db.setting.deleteMany({ where: { key: { startsWith: PREFIX } } });
}
