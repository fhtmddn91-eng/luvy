/**
 * 전화번호 표기 (순수 함수 — 브라우저·서버·테스트에서 같이 쓴다).
 *
 * 배송 연락처는 택배 송장에 그대로 실린다. 손님이 쓴 대로 저장하면
 * "01012345678" 과 "010-1234-5678" 이 섞여 남는다. 입력할 때 자동으로 붙여
 * 한 가지 꼴로 모은다.
 *
 * **입력 도중에도 자연스러워야 한다.** 다 치고 나서 한 번에 모양이 바뀌면
 * 커서가 튀고 손님이 자기가 뭘 지웠는지 모른다. 그래서 자릿수가 덜 찼을 때도
 * 그 시점까지의 모양으로 끊는다.
 */

/** 숫자만 남긴다 */
export function onlyDigits(raw: string): string {
  return typeof raw === "string" ? raw.replace(/\D/g, "") : "";
}

/** 대표번호 15xx·16xx·18xx·19xx (0으로 시작하지 않고 8자리) */
const REP = /^1[5-9]\d\d/;

/**
 * 가운데 자리를 항상 4로 끊는 번호.
 * 010 은 전부 11자리라 치는 도중에도 010-1234 가 자연스럽다.
 * 070(인터넷전화)·050(안심번호)도 같다.
 * 011·016 같은 옛 번호는 10자리(3-3-4)라 여기 넣으면 안 된다.
 */
const ALWAYS_FOUR = /^(010|070|050)/;

/** 국제표기(+82 10-…)를 국내 표기로 되돌린다 — 연락처 붙여넣기에서 흔하다 */
function toDomestic(digits: string): string {
  if (digits.startsWith("82") && !digits.startsWith("820")) return `0${digits.slice(2)}`;
  if (digits.startsWith("820")) return digits.slice(2);
  return digits;
}

/** 하이픈을 붙인 표기. 자릿수가 덜 찼으면 그 시점까지의 모양으로 돌려준다 */
export function formatPhone(raw: string): string {
  const d = toDomestic(onlyDigits(raw)).slice(0, 11);
  if (!d) return "";

  // 대표번호는 국번이 없다 (1588-1234)
  if (!d.startsWith("0") && REP.test(d)) {
    const rep = d.slice(0, 8);
    return rep.length <= 4 ? rep : `${rep.slice(0, 4)}-${rep.slice(4)}`;
  }

  const head = d.startsWith("02") ? 2 : 3;
  if (d.length <= head) return d;

  /*
   * 가운데 자리: 010·070·050 은 항상 4.
   * 나머지는 전체 길이로 가른다 — 043-123-4567(10자리)와 031-1234-5678(11자리)이
   * 둘 다 있어서, 다 치기 전에는 3으로 두고 넘어가면 4로 바꾼다.
   */
  const mid = ALWAYS_FOUR.test(d) ? 4 : d.length > head + 7 ? 4 : 3;
  const rest = d.slice(head);
  if (rest.length <= mid) return `${d.slice(0, head)}-${rest}`;
  return `${d.slice(0, head)}-${rest.slice(0, mid)}-${rest.slice(mid)}`;
}

/**
 * 서버 검증. 폼 값은 조작할 수 있다 —
 * 지금까지는 "비어 있지만 않으면" 통과해서 "ㅁㄴㅇㄹ" 도 주문이 됐다.
 *
 * 배송 연락처이므로 **0으로 시작하는 국내 번호**만 받는다. 대표번호(1588…)로는
 * 배송 기사가 손님에게 연락할 수 없다.
 */
export function isValidPhone(raw: string): boolean {
  const d = toDomestic(onlyDigits(raw));
  return d.startsWith("0") && d.length >= 9 && d.length <= 11;
}
