/**
 * 전화번호 하이픈 — 순수 함수 회귀 테스트.
 *
 * 배송 연락처는 택배 송장에 그대로 실린다. 지금까지는 손님이 쓴 그대로 저장돼
 * "01012345678" 과 "010-1234-5678" 이 섞여 있었다. 입력할 때 자동으로 붙여
 * 한 가지 꼴로 모은다.
 *
 * 입력 **도중**에도 자연스러워야 한다 — 다 치고 나서 한 번에 바뀌면 커서가 튀고
 * 사용자가 자기가 뭘 지웠는지 모른다.
 */
import { describe, it, expect } from "vitest";
import { formatPhone, isValidPhone, onlyDigits } from "./phone";

describe("formatPhone — 휴대폰", () => {
  it("010 은 3-4-4 로 끊는다", () => {
    expect(formatPhone("01012345678")).toBe("010-1234-5678");
  });

  it("이미 하이픈이 있어도 같은 결과 (두 번 넣어도 안전)", () => {
    expect(formatPhone("010-1234-5678")).toBe("010-1234-5678");
    expect(formatPhone("010 1234 5678")).toBe("010-1234-5678");
  });

  /** 입력 도중 — 010-123 이 아니라 010-1234 로 끊겨야 손에 익은 모양이 된다 */
  it("치는 도중에도 자연스럽게 끊긴다", () => {
    expect(formatPhone("0")).toBe("0");
    expect(formatPhone("010")).toBe("010");
    expect(formatPhone("0101")).toBe("010-1");
    expect(formatPhone("0101234")).toBe("010-1234");
    expect(formatPhone("01012345")).toBe("010-1234-5");
  });

  it("011·016 같은 옛 번호는 10자리 3-3-4", () => {
    expect(formatPhone("0111234567")).toBe("011-123-4567");
    expect(formatPhone("0161234567")).toBe("016-123-4567");
  });

  it("11자리로 들어온 옛 번호는 3-4-4", () => {
    expect(formatPhone("01712345678")).toBe("017-1234-5678");
  });
});

describe("formatPhone — 유선", () => {
  it("서울 02 는 국번이 두 자리", () => {
    expect(formatPhone("021234567")).toBe("02-123-4567");
    expect(formatPhone("0212345678")).toBe("02-1234-5678");
  });

  it("치는 도중 02 도 자연스럽다", () => {
    expect(formatPhone("02")).toBe("02");
    expect(formatPhone("021")).toBe("02-1");
    expect(formatPhone("02123")).toBe("02-123");
    expect(formatPhone("021234")).toBe("02-123-4");
  });

  it("지역번호 3자리", () => {
    expect(formatPhone("0431234567")).toBe("043-123-4567");
    expect(formatPhone("0311234567")).toBe("031-123-4567");
    expect(formatPhone("03112345678")).toBe("031-1234-5678");
  });

  it("인터넷전화 070 은 3-4-4", () => {
    expect(formatPhone("07012345678")).toBe("070-1234-5678");
    expect(formatPhone("0701234")).toBe("070-1234");
  });
});

describe("formatPhone — 대표번호", () => {
  it("1588 류는 4-4", () => {
    expect(formatPhone("15881234")).toBe("1588-1234");
    expect(formatPhone("16881234")).toBe("1688-1234");
    expect(formatPhone("1588")).toBe("1588");
    expect(formatPhone("158812")).toBe("1588-12");
  });
});

describe("formatPhone — 이상한 입력", () => {
  it("빈 값·숫자 없음은 빈 문자열", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone("전화번호")).toBe("");
    expect(formatPhone("---")).toBe("");
  });

  /** 붙여넣기로 길게 들어와도 번호 길이를 넘기지 않는다 */
  it("11자리를 넘으면 잘라낸다", () => {
    expect(formatPhone("010123456789999")).toBe("010-1234-5678");
  });

  it("깨진 값에도 터지지 않는다", () => {
    expect(formatPhone(null as unknown as string)).toBe("");
    expect(formatPhone(undefined as unknown as string)).toBe("");
  });

  it("국가번호를 붙여 넣으면 0으로 시작하는 국내 번호로 바꾼다", () => {
    expect(formatPhone("+82 10-1234-5678")).toBe("010-1234-5678");
    expect(formatPhone("821012345678")).toBe("010-1234-5678");
  });
});

describe("onlyDigits", () => {
  it("숫자만 남긴다", () => {
    expect(onlyDigits("010-1234-5678")).toBe("01012345678");
    expect(onlyDigits("")).toBe("");
  });
});

/**
 * 서버 검증 — 폼 값은 조작할 수 있다.
 * 지금까지는 "비어 있지만 않으면" 통과해서 "ㅁㄴㅇㄹ" 도 주문이 됐다.
 */
describe("isValidPhone — 서버가 다시 검사한다", () => {
  it("정상 번호는 통과", () => {
    expect(isValidPhone("010-1234-5678")).toBe(true);
    expect(isValidPhone("02-123-4567")).toBe(true);
    expect(isValidPhone("043-123-4567")).toBe(true);
    expect(isValidPhone("070-1234-5678")).toBe(true);
  });

  it("하이픈이 없어도 자릿수만 맞으면 통과 (저장은 붙여서 한다)", () => {
    expect(isValidPhone("01012345678")).toBe(true);
  });

  it("0으로 시작하지 않으면 거부 — 배송 연락처로 대표번호는 받지 않는다", () => {
    expect(isValidPhone("1588-1234")).toBe(false);
  });

  it("너무 짧거나 길면 거부", () => {
    expect(isValidPhone("0101234")).toBe(false);
    expect(isValidPhone("010123456789")).toBe(false);
  });

  it("빈 값·글자는 거부", () => {
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone("없음")).toBe(false);
    expect(isValidPhone("ㅁㄴㅇㄹ")).toBe(false);
  });
});
