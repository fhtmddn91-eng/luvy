/**
 * 배송 주소 — 순수 함수 회귀 테스트.
 *
 * 실사례(2026-09-10 점검): 주소가 한 칸뿐이라 "청주" 두 글자로도 주문이 통과했다.
 * 그대로 송장이 나가면 배송이 안 된다. 우편번호·기본주소·상세주소를 나누고
 * 서버에서 다시 검사한다.
 */
import { describe, it, expect } from "vitest";
import { isValidPostcode, fullAddress, hasPostcode, pickAddress } from "./address";

describe("isValidPostcode", () => {
  it("5자리 숫자만 통과 (신 우편번호)", () => {
    expect(isValidPostcode("28000")).toBe(true);
    expect(isValidPostcode("06134")).toBe(true);
  });

  it("옛 6자리·하이픈 형식은 거부", () => {
    expect(isValidPostcode("123-456")).toBe(false);
    expect(isValidPostcode("360130")).toBe(false);
  });

  it("빈 값·글자·자릿수 부족은 거부", () => {
    expect(isValidPostcode("")).toBe(false);
    expect(isValidPostcode("2800")).toBe(false);
    expect(isValidPostcode("우편번호")).toBe(false);
    expect(isValidPostcode(null as unknown as string)).toBe(false);
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(isValidPostcode(" 28000 ")).toBe(true);
  });
});

describe("fullAddress — 화면·송장에 쓰는 한 줄", () => {
  it("셋을 갖추면 우편번호를 괄호로 앞에 둔다", () => {
    expect(
      fullAddress({ postcode: "28000", address: "충북 청주시 흥덕구 대로 1", addressDetail: "101동 202호" }),
    ).toBe("(28000) 충북 청주시 흥덕구 대로 1 101동 202호");
  });

  it("상세주소가 없으면 그 자리를 비운다 (단독주택·상가)", () => {
    expect(fullAddress({ postcode: "28000", address: "충북 청주시 대로 1", addressDetail: "" })).toBe(
      "(28000) 충북 청주시 대로 1",
    );
  });

  /**
   * 이 기능이 생기기 전 주문은 우편번호·상세주소가 빈 값이다.
   * 그걸 그대로 그리면 "() 청주" 처럼 빈 괄호가 남는다.
   */
  it("옛 주문(우편번호 없음)은 주소만 돌려준다", () => {
    expect(fullAddress({ postcode: "", address: "청주", addressDetail: "" })).toBe("청주");
  });

  it("전부 비어 있으면 빈 문자열", () => {
    expect(fullAddress({ postcode: "", address: "", addressDetail: "" })).toBe("");
  });

  it("앞뒤 공백은 정리한다", () => {
    expect(fullAddress({ postcode: " 28000 ", address: "  대로 1  ", addressDetail: " 202호 " })).toBe(
      "(28000) 대로 1 202호",
    );
  });
});

describe("hasPostcode — 옛 주문과 새 주문을 가른다", () => {
  it("우편번호가 있으면 새 주문", () => {
    expect(hasPostcode({ postcode: "28000" })).toBe(true);
  });

  it("없으면 옛 주문 — 화면에서 우편번호 줄을 그리지 않는다", () => {
    expect(hasPostcode({ postcode: "" })).toBe(false);
  });
});

/**
 * 검색 결과 → 기본주소 한 줄.
 * 참고항목(법정동·건물명)을 무조건 괄호로 붙이면 값이 없을 때 "( )" 가 남는다.
 */
describe("pickAddress — 다음 우편번호 검색 결과", () => {
  const 도로명 = {
    roadAddress: "서울 강남구 테헤란로 1",
    jibunAddress: "서울 강남구 역삼동 100",
    userSelectedType: "R" as const,
  };

  it("도로명을 고르면 참고항목을 괄호로 붙인다", () => {
    expect(pickAddress({ ...도로명, bname: "역삼동", buildingName: "아무빌딩" })).toBe(
      "서울 강남구 테헤란로 1 (역삼동, 아무빌딩)",
    );
  });

  it("참고항목이 하나만 있으면 그것만", () => {
    expect(pickAddress({ ...도로명, bname: "역삼동" })).toBe("서울 강남구 테헤란로 1 (역삼동)");
  });

  it("참고항목이 없으면 빈 괄호를 남기지 않는다", () => {
    expect(pickAddress(도로명)).toBe("서울 강남구 테헤란로 1");
    expect(pickAddress({ ...도로명, bname: "", buildingName: "  " })).toBe("서울 강남구 테헤란로 1");
  });

  it("지번을 고르면 지번 주소를 그대로 쓴다 (참고항목 안 붙임)", () => {
    expect(pickAddress({ ...도로명, userSelectedType: "J", bname: "역삼동" })).toBe(
      "서울 강남구 역삼동 100",
    );
  });
});
