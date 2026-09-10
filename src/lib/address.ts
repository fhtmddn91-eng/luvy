/**
 * 배송 주소 (순수 함수 — 브라우저·서버·테스트에서 같이 쓴다).
 *
 * 실사례(2026-09-10 점검): 주소가 한 칸뿐이라 **"청주" 두 글자로도 주문이
 * 통과**했다. 그대로 송장이 나가면 배송이 안 된다. 그래서 우편번호·기본주소를
 * 검색으로만 채우게 하고, 서버에서 우편번호 자릿수를 다시 검사한다.
 *
 * 저장 구조:
 *   Order.postcode       우편번호 5자리 (검색으로만 들어온다)
 *   Order.address        기본주소 — 도로명/지번 (검색으로만)
 *   Order.addressDetail  동·호수 — 손님이 직접 입력, 없을 수 있다
 *
 * 이 기능 전 주문은 postcode·addressDetail 이 빈 값이다. 화면이 그걸 그대로
 * 그리면 "() 청주" 처럼 빈 괄호가 남으므로 `fullAddress` 가 비운 자리를 접는다.
 */

export interface AddressParts {
  postcode: string;
  address: string;
  addressDetail: string;
}

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** 신 우편번호(5자리 숫자)만 받는다. 옛 6자리·하이픈 형식은 거부 */
export function isValidPostcode(raw: string): boolean {
  return /^\d{5}$/.test(trim(raw));
}

/** 우편번호가 채워진 주문인가 — 옛 주문과 가르는 기준 */
export function hasPostcode(a: { postcode: string }): boolean {
  return isValidPostcode(a.postcode);
}

/** 화면·송장에 쓰는 한 줄. 비어 있는 조각은 자리째 뺀다 */
export function fullAddress(a: Partial<AddressParts>): string {
  const postcode = trim(a.postcode);
  const head = isValidPostcode(postcode) ? `(${postcode})` : "";
  return [head, trim(a.address), trim(a.addressDetail)].filter(Boolean).join(" ");
}

/** 다음 우편번호 서비스가 돌려주는 값 중 우리가 쓰는 것만 */
export interface PostcodePick {
  roadAddress: string;
  jibunAddress: string;
  /** 손님이 도로명(R)을 골랐는지 지번(J)을 골랐는지 */
  userSelectedType: "R" | "J";
  /** 법정동/법정리 — 도로명 주소의 참고항목 */
  bname?: string;
  /** 건물명 — 아파트면 참고항목에 넣는다 */
  buildingName?: string;
}

/**
 * 검색 결과를 기본주소 한 줄로 만든다.
 *
 * 손님이 고른 쪽(도로명/지번)을 그대로 쓰고, 도로명이면 참고항목(법정동·건물명)을
 * 괄호로 덧붙인다 — "서울 강남구 테헤란로 1 (역삼동, 아무빌딩)".
 * 참고항목이 없으면 빈 괄호 "( )" 가 남지 않게 통째로 뺀다.
 */
export function pickAddress(data: PostcodePick): string {
  if (data.userSelectedType === "J") return trim(data.jibunAddress);
  const extra = [data.bname, data.buildingName].map(trim).filter(Boolean);
  const road = trim(data.roadAddress);
  return extra.length > 0 ? `${road} (${extra.join(", ")})` : road;
}
