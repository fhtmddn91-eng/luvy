import { describe, it, expect } from "vitest";
import { categorySetFor, keepKnown } from "./productCategories";

describe("categorySetFor", () => {
  it("대표 카테고리를 항상 첫 자리에 포함한다", () => {
    expect(categorySetFor("men", [])).toEqual(["men"]);
  });

  it("추가 카테고리를 대표 뒤에 붙인다", () => {
    expect(categorySetFor("men", ["couple-sm", "idea"])).toEqual(["men", "couple-sm", "idea"]);
  });

  it("대표를 추가로도 골랐을 때 중복 저장하지 않는다", () => {
    // 조인 테이블 기본키가 (productId, categorySlug) 라 중복이 들어오면 저장이 터진다
    expect(categorySetFor("men", ["men", "idea"])).toEqual(["men", "idea"]);
  });

  it("빈 값과 공백을 걸러낸다", () => {
    expect(categorySetFor("men", ["", "  ", "idea"])).toEqual(["men", "idea"]);
  });

  it("추가 목록 안의 중복도 하나로 접는다", () => {
    expect(categorySetFor("men", ["idea", "idea"])).toEqual(["men", "idea"]);
  });
});

describe("keepKnown", () => {
  it("존재하지 않는 카테고리를 버린다", () => {
    expect(keepKnown(["men", "ghost"], ["men", "women"])).toEqual(["men"]);
  });

  it("전부 모르는 값이면 빈 배열", () => {
    expect(keepKnown(["ghost"], ["men"])).toEqual([]);
  });
});
