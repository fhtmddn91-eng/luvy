import { describe, it, expect } from "vitest";
import {
  COMPANY,
  companyLine,
  contactLine,
  contactPoint,
  mergeCompany,
  type CompanyInfo,
} from "./company";

const base: CompanyInfo = { ...COMPANY, tel: "", mailOrderNumber: "" };

describe("companyLine", () => {
  it("신고번호가 없으면 그 항목을 빼고 만든다", () => {
    const line = companyLine(base);
    expect(line).toContain("사업자등록번호");
    expect(line).not.toContain("통신판매업신고");
  });

  it("신고번호가 있으면 붙인다", () => {
    expect(companyLine({ ...base, mailOrderNumber: "2026-남양주-0001" })).toContain(
      "통신판매업신고 2026-남양주-0001",
    );
  });
});

describe("contactLine / contactPoint", () => {
  it("전화가 없으면 이메일로 안내한다", () => {
    expect(contactLine({ ...base, email: "a@b.c" })).toBe("고객센터 a@b.c");
    expect(contactPoint({ ...base, email: "a@b.c" })).toBe("a@b.c");
  });

  it("전화가 있으면 전화를 우선한다", () => {
    expect(contactLine({ ...base, tel: "031-000-0000" })).toBe("고객센터 031-000-0000");
    expect(contactPoint({ ...base, tel: "031-000-0000" })).toBe("031-000-0000");
  });
});

describe("mergeCompany", () => {
  it("저장된 값이 없으면 기본값 그대로", () => {
    expect(mergeCompany({})).toEqual(COMPANY);
  });

  it("저장된 값이 기본값을 덮어쓴다", () => {
    expect(mergeCompany({ email: "help@example.com" }).email).toBe("help@example.com");
  });

  it("일부러 비워둔 값(전화·신고번호)도 그대로 존중한다", () => {
    // "빈 문자열이면 기본값" 으로 처리하면 전화번호를 지울 수가 없다
    expect(mergeCompany({ tel: "" }).tel).toBe("");
  });

  it("모르는 키는 무시한다", () => {
    const merged = mergeCompany({ hacked: "x" } as Record<string, string>);
    expect(merged).toEqual(COMPANY);
    expect("hacked" in merged).toBe(false);
  });
});
