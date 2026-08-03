import { describe, it, expect } from "vitest";
import { fillTab, rankIds, orderByIds, isHomeMode, marginRate, DEFAULT_SECTIONS } from "./homeSections";

const p = (id: string) => ({ id });

describe("fillTab", () => {
  it("규칙으로 뽑힌 것을 먼저 쓴다", () => {
    expect(fillTab([p("a"), p("b")], [p("c")], 3).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("주문이 없어 규칙 결과가 비어도 신상품으로 채운다 — 빈 탭이 뜨면 안 된다", () => {
    expect(fillTab([], [p("c"), p("d")], 2).map((x) => x.id)).toEqual(["c", "d"]);
  });

  it("두 목록에 겹치는 상품은 한 번만 넣는다", () => {
    expect(fillTab([p("a")], [p("a"), p("b")], 5).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("정해진 개수를 넘기지 않는다", () => {
    expect(fillTab([p("a"), p("b"), p("c")], [], 2)).toHaveLength(2);
  });

  it("둘 다 비면 빈 배열", () => {
    expect(fillTab([], [], 4)).toEqual([]);
  });
});

describe("rankIds", () => {
  it("수치가 큰 순서로 정렬한다", () => {
    expect(rankIds([{ productId: "a", value: 1 }, { productId: "b", value: 9 }])).toEqual(["b", "a"]);
  });

  it("0 이하는 순위에서 뺀다 — 안 팔린 상품이 인기 탭에 오르면 안 된다", () => {
    expect(rankIds([{ productId: "a", value: 0 }, { productId: "b", value: 2 }])).toEqual(["b"]);
  });

  it("동점이면 순서가 고정된다 (새로고침마다 흔들리면 안 된다)", () => {
    const rows = [{ productId: "b", value: 5 }, { productId: "a", value: 5 }];
    expect(rankIds(rows)).toEqual(["a", "b"]);
    expect(rankIds([...rows].reverse())).toEqual(["a", "b"]);
  });
});

describe("orderByIds", () => {
  it("조회 결과를 지정한 순서대로 다시 늘어놓는다", () => {
    expect(orderByIds([p("a"), p("b"), p("c")], ["c", "a"]).map((x) => x.id)).toEqual(["c", "a"]);
  });

  it("사라진 상품 id 는 조용히 버린다", () => {
    expect(orderByIds([p("a")], ["ghost", "a"]).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("isHomeMode", () => {
  it("아는 모드만 통과시킨다", () => {
    expect(isHomeMode("AUTO_POPULAR")).toBe(true);
    expect(isHomeMode("AUTO_MARGIN")).toBe(true);
    expect(isHomeMode("MANUAL")).toBe(true);
    expect(isHomeMode("WHATEVER")).toBe(false);
  });
});

describe("marginRate", () => {
  it("소비자가 대비 남는 비율을 계산한다", () => {
    // 정가 10,000 / 도매 6,000 → 40% 마진
    expect(marginRate(10000, 6000)).toBeCloseTo(0.4);
  });

  it("비율이라 저가 상품도 공정하게 겨룬다", () => {
    // 절대액(1,600 < 8,000)으로 재면 지지만, 비율(40% > 20%)로는 이긴다
    expect(marginRate(4000, 2400)).toBeGreaterThan(marginRate(40000, 32000));
  });

  it("역마진·정가 미입력은 0 — 순위에서 빠진다", () => {
    expect(marginRate(5000, 6000)).toBe(0); // 도매가가 정가보다 비쌈
    expect(marginRate(0, 1000)).toBe(0); // 정가 미입력
    expect(marginRate(5000, 0)).toBe(0); // 도매가 없음 (티어 미입력)
  });
});

describe("DEFAULT_SECTIONS", () => {
  it("요청사항 PDF p7 의 4탭 구성과 일치한다", () => {
    expect(DEFAULT_SECTIONS.map((s) => s.label)).toEqual([
      "이번주 HOT", "입문 추천", "마진 높은 상품", "재구매 높은 상품",
    ]);
  });
});
