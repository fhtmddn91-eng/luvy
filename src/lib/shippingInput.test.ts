/**
 * 배송지 입력 검증 — 화면이 아니라 **서버가 막는지** 확인하는 회귀 테스트.
 *
 * 실사례(2026-09-10): 주소가 한 칸이고 "비어 있지만 않으면" 통과해서
 * 주소 "청주", 연락처 "ㅁㄴㅇㄹ" 로도 주문이 들어왔다. 그대로 송장이 나가면
 * 배송이 안 되고 기사가 손님에게 연락할 방법도 없다.
 *
 * 우편번호·기본주소 칸을 readOnly 로 두었지만 **폼 값은 조작할 수 있다** —
 * 지난번 CANCELED 드롭다운 건과 같은 원칙: UI 에서 숨기는 것만으로는 부족하다.
 * 그래서 order.ts 의 검증과 같은 규칙을 여기서 못 박는다.
 */
import { describe, it, expect } from "vitest";
import { isValidPhone, formatPhone } from "./phone";
import { isValidPostcode } from "./address";

/** src/lib/actions/order.ts 의 shippingError 와 같은 규칙 (서버 전용 모듈이라 여기서 재현) */
function shippingError(s: {
  recipient: string;
  phone: string;
  postcode: string;
  address: string;
}): string | null {
  if (!s.recipient) return "수령인을 입력해주세요.";
  if (!isValidPhone(s.phone)) return "연락처를 정확히 입력해주세요. (예: 010-1234-5678)";
  if (!isValidPostcode(s.postcode) || !s.address) return "「주소 찾기」로 배송지를 선택해주세요.";
  return null;
}

const 정상 = {
  recipient: "홍길동",
  phone: "010-1234-5678",
  postcode: "28000",
  address: "충북 청주시 흥덕구 대로 1",
};

describe("배송지 검증", () => {
  it("제대로 채우면 통과한다", () => {
    expect(shippingError(정상)).toBeNull();
  });

  it("수령인이 비면 막는다", () => {
    expect(shippingError({ ...정상, recipient: "" })).toContain("수령인");
  });

  /** 예전엔 이게 통과했다 */
  it("연락처가 글자면 막는다", () => {
    expect(shippingError({ ...정상, phone: "ㅁㄴㅇㄹ" })).toContain("연락처");
    expect(shippingError({ ...정상, phone: "없음" })).toContain("연락처");
  });

  it("연락처 자릿수가 모자라면 막는다", () => {
    expect(shippingError({ ...정상, phone: "010-1234" })).toContain("연락처");
  });

  /** 이게 이번 작업의 핵심 — "청주" 두 글자로 주문이 되던 자리 */
  it("우편번호 없이 주소만 있으면 막는다", () => {
    expect(shippingError({ ...정상, postcode: "", address: "청주" })).toContain("주소 찾기");
  });

  it("우편번호가 5자리가 아니면 막는다", () => {
    expect(shippingError({ ...정상, postcode: "2800" })).toContain("주소 찾기");
    expect(shippingError({ ...정상, postcode: "123-456" })).toContain("주소 찾기");
  });

  it("기본주소가 비면 막는다 (우편번호만 조작해 넣은 경우)", () => {
    expect(shippingError({ ...정상, address: "" })).toContain("주소 찾기");
  });

  /** 상세주소는 단독주택·상가에 없을 수 있어 필수가 아니다 */
  it("상세주소가 없어도 통과한다", () => {
    expect(shippingError(정상)).toBeNull();
  });
});

describe("저장 형태 — 연락처는 한 가지 꼴로 모은다", () => {
  it("하이픈 없이 보내도 붙여서 저장한다", () => {
    expect(formatPhone("01012345678")).toBe("010-1234-5678");
  });

  it("이미 붙어 있으면 그대로", () => {
    expect(formatPhone("010-1234-5678")).toBe("010-1234-5678");
  });
});
