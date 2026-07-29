import { describe, it, expect } from "vitest";
import { csvCell, toCsv, CSV_BOM } from "./csv";

describe("csvCell", () => {
  it("일반 값은 그대로", () => {
    expect(csvCell("홍길동")).toBe("홍길동");
    expect(csvCell(65000)).toBe("65000");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("쉼표·따옴표·줄바꿈은 따옴표로 감싼다", () => {
    expect(csvCell("서울시, 강남구")).toBe('"서울시, 강남구"');
    expect(csvCell('상품 "특대"')).toBe('"상품 ""특대"""');
    expect(csvCell("첫줄\n둘째줄")).toBe('"첫줄\n둘째줄"');
  });

  it("수식 주입을 막는다 (=,+,-,@ 시작)", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("@계정")).toBe("'@계정");
    expect(csvCell("+821012345678")).toBe("'+821012345678");
    // 하이픈 시작 (엑셀이 수식으로 해석할 수 있음)
    expect(csvCell("-감사합니다")).toBe("'-감사합니다");
  });

  it("주입 방지 문자와 쉼표가 같이 있으면 둘 다 적용", () => {
    expect(csvCell("=A1,B1")).toBe("\"'=A1,B1\"");
  });
});

describe("toCsv", () => {
  it("BOM + CRLF 로 합친다 (엑셀 한글 호환)", () => {
    const out = toCsv([
      ["주문번호", "금액"],
      ["ABC123", 65000],
    ]);
    // 문자 코드로 직접 검사 — startsWith(CSV_BOM)는 상수가 빈 문자열로 깨져도 통과해버린다
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(CSV_BOM.length).toBe(1);
    expect(out).toContain("주문번호,금액\r\nABC123,65000");
  });
});
