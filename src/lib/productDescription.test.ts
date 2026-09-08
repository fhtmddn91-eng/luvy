/**
 * 상품 설명 — 손님에게 나갈 때 내부 메모를 걷어내는 회귀 테스트.
 *
 * 실사례(2026-09-08 점검): 수집 상품의 description 끝에 원본 1688 주소와
 * **위안화 매입 원가**가 붙어 있었고, 그 필드가 손님 상세 페이지에 그대로
 * 출력되고 있었다. 개행이 뭉개져 눈에 안 띄었을 뿐 거래처는 마진을 볼 수
 * 있었고 링크를 타고 원본에서 직접 살 수도 있었다.
 *
 * 메모를 만들어 넣는 쪽(import/translate.ts · pipeline.ts)은 운영자에게
 * 필요하므로 그대로 두고, **나가는 자리에서 거른다.**
 */
import { describe, it, expect } from "vitest";
import { publicDescription, internalNotes, hasInternalNotes } from "./productDescription";

const 원본줄 = "[원본] https://detail.1688.com/offer/912345678.html";
const 참고가줄 = "[1688 참고가] ¥12.5 ~ ¥15 (위안화 원가 — 도매가 산정용)";
const 국내참고가줄 = "[도라도라 참고가] 8,000원 ~ 9,500원 (매입가 — 도매가 산정용)";

describe("publicDescription — 손님에게 나가는 설명", () => {
  it("내부 메모가 없으면 그대로 돌려준다", () => {
    expect(publicDescription("부드러운 실리콘 재질.")).toBe("부드러운 실리콘 재질.");
  });

  it("원본 주소 줄을 걷어낸다 (거래처가 1688 에서 직접 사는 길)", () => {
    const d = `설명입니다.\n\n${원본줄}`;
    expect(publicDescription(d)).toBe("설명입니다.");
  });

  it("참고가(매입 원가) 줄을 걷어낸다 — 마진이 보이면 안 된다", () => {
    expect(publicDescription(`설명입니다.\n\n${참고가줄}`)).toBe("설명입니다.");
    expect(publicDescription(`설명입니다.\n\n${국내참고가줄}`)).toBe("설명입니다.");
  });

  it("둘 다 붙어 있는 실제 수집 상품 모양을 처리한다", () => {
    const d = `가벼운 미니 진동기.\n10단계 모드.\n\n${원본줄}\n\n${참고가줄}`;
    expect(publicDescription(d)).toBe("가벼운 미니 진동기.\n10단계 모드.");
  });

  /** 도매처 이름은 sources.ts 에서 오므로 무엇이 와도 걸러야 한다 */
  it("도매처 이름이 무엇이든 참고가 줄이면 건다", () => {
    expect(publicDescription("설명\n\n[핑크박스 참고가] 1,000원 (매입가 — 도매가 산정용)")).toBe("설명");
    expect(publicDescription("설명\n\n[처음보는곳 참고가] 무엇이든")).toBe("설명");
  });

  /** 운영자가 손으로 옮겨 적어 가운데에 있을 수도 있다 */
  it("메모가 가운데 있어도 그 줄만 빼고 앞뒤를 잇는다", () => {
    expect(publicDescription(`위 설명\n${원본줄}\n아래 설명`)).toBe("위 설명\n아래 설명");
  });

  it("앞뒤 공백과 메모를 빼고 남은 빈 줄을 정리한다", () => {
    expect(publicDescription(`  설명  \n\n\n\n${원본줄}\n\n`)).toBe("설명");
  });

  /** 메모만 있던 상품은 빈 문자열 — 화면이 빈 문단을 그리지 않게 */
  it("메모밖에 없으면 빈 문자열", () => {
    expect(publicDescription(`${원본줄}\n\n${참고가줄}`)).toBe("");
    expect(publicDescription("")).toBe("");
  });

  /**
   * [상품 정보]는 수집한 속성표(재질·크기)라 손님에게 보여줄 내용이다.
   * 대괄호로 시작한다고 싸잡아 지우면 국내 도매처 상품 설명이 통째로 날아간다.
   */
  it("[상품 정보] 속성표는 남긴다", () => {
    const d = "[상품 정보]\n재질: 실리콘\n크기: 95mm\n\n" + 원본줄;
    expect(publicDescription(d)).toBe("[상품 정보]\n재질: 실리콘\n크기: 95mm");
  });

  it("본문에 '참고가'라는 낱말이 그냥 들어 있는 줄은 지우지 않는다", () => {
    const d = "정가는 참고가로만 봐주세요.";
    expect(publicDescription(d)).toBe(d);
  });

  it("본문 중간에 있는 링크는 지우지 않는다 ([원본] 표식이 있을 때만 판단)", () => {
    const d = "자세한 사용법은 https://luvyb2b.com/support 를 보세요.";
    expect(publicDescription(d)).toBe(d);
  });

  it("깨진 값에도 터지지 않는다", () => {
    expect(publicDescription(null as unknown as string)).toBe("");
    expect(publicDescription(undefined as unknown as string)).toBe("");
  });

  it("윈도우 줄바꿈(CRLF)도 처리한다", () => {
    expect(publicDescription(`설명\r\n\r\n${원본줄}`)).toBe("설명");
  });
});

describe("internalNotes / hasInternalNotes — 관리자에게 보여줄 몫", () => {
  it("걷어낸 줄을 그대로 돌려준다 (운영자는 계속 봐야 한다)", () => {
    const d = `설명\n\n${원본줄}\n\n${참고가줄}`;
    expect(internalNotes(d)).toEqual([원본줄, 참고가줄]);
  });

  it("메모가 없으면 빈 배열", () => {
    expect(internalNotes("그냥 설명")).toEqual([]);
    expect(hasInternalNotes("그냥 설명")).toBe(false);
  });

  it("메모가 있으면 알려준다 — 관리자 폼이 안내를 띄우는 근거", () => {
    expect(hasInternalNotes(`설명\n${원본줄}`)).toBe(true);
  });

  /** 손님용과 관리자용을 합치면 원문의 알맹이가 다 남아야 한다 (빠뜨린 줄 없음) */
  it("손님용 + 내부메모 = 원문의 모든 비어있지 않은 줄", () => {
    const d = `설명 1\n설명 2\n\n${원본줄}\n\n${참고가줄}`;
    const 합 = [...publicDescription(d).split("\n"), ...internalNotes(d)].filter(Boolean).sort();
    const 원문 = d.split("\n").map((l) => l.trim()).filter(Boolean).sort();
    expect(합).toEqual(원문);
  });
});
