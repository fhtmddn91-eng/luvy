/**
 * 상품 설명에서 **내부 메모**를 갈라내는 순수 함수 (2026-09-08).
 *
 * 수집 파이프라인은 운영자 편의로 설명 끝에 두 줄을 붙인다:
 *   [원본] https://detail.1688.com/offer/...        ← import/translate.ts
 *   [1688 참고가] ¥12.5 ~ ¥15 (위안화 원가 …)        ← import/pipeline.ts supplyPriceNote
 *
 * 문제는 그 필드가 **손님 상품 상세에 그대로 출력**되고 있었다는 것이다.
 * 개행이 뭉개져 눈에 안 띄었을 뿐, 거래처는 매입 원가를 볼 수 있었고
 * 링크를 타고 원본에서 직접 살 수도 있었다.
 *
 * 만드는 쪽을 없애지 않는 이유: 운영자가 도매가를 정할 때 실제로 쓰는 정보다.
 * 그래서 **나가는 자리에서 거른다** — 이미 등록된 상품까지 한 번에 가려지고,
 * 데이터를 건드리지 않아 되돌릴 것도 없다.
 *
 * 지우지 말아야 할 것: `[상품 정보]` 는 수집한 속성표(재질·크기)라 손님에게
 * 보여줄 내용이다. 대괄호로 시작한다고 싸잡아 지우면 국내 도매처 상품 설명이
 * 통째로 날아간다.
 */

/** `[원본] …` — 수집 원본 주소 */
const SOURCE_LINE = /^\[원본\]\s/;

/**
 * `[<도매처> 참고가] …` — 매입 원가.
 * 도매처 이름은 sources.ts 에서 오므로 무엇이 와도 걸리게 둔다.
 * 줄 맨 앞의 대괄호 안이 「… 참고가」로 끝날 때만 — 본문에 '참고가'라는
 * 낱말이 들어간 문장은 건드리지 않는다.
 */
const COST_LINE = /^\[[^\]]*참고가\]/;

const isInternal = (line: string): boolean => {
  const t = line.trim();
  return SOURCE_LINE.test(t) || COST_LINE.test(t);
};

/** 줄 단위로 가른다. CRLF 도 받는다 */
const lines = (description: string): string[] =>
  (typeof description === "string" ? description : "").split(/\r?\n/);

/**
 * 손님에게 보여줄 설명. 내부 메모 줄을 빼고, 남은 빈 줄을 정리한다.
 * 메모를 빼면서 생긴 연속 빈 줄을 그대로 두면 본문 아래에 허공이 남는다.
 */
export function publicDescription(description: string): string {
  return lines(description)
    .filter((l) => !isInternal(l))
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // 세 줄 이상 빈 줄은 한 칸으로
    .trim();
}

/** 걷어낸 줄들 — 관리자 화면에서 운영자에게는 계속 보여준다 */
export function internalNotes(description: string): string[] {
  return lines(description).map((l) => l.trim()).filter(isInternal);
}

/** 이 설명에 손님에게 안 보이는 줄이 있는가 (관리자 폼 안내용) */
export function hasInternalNotes(description: string): boolean {
  return lines(description).some(isInternal);
}
