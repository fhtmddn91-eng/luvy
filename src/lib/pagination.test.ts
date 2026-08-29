/**
 * 목록 페이지네이션 계산 (어드민 상품 목록 등).
 *
 * 실사례(2026-08-31 피드백): 수집 상품이 늘어 목록이 한 페이지에 전부 떠서,
 * 상품을 하나 등록하고 돌아올 때마다 하염없이 스크롤해야 했다.
 */
import { describe, it, expect } from "vitest";
import { paginate, pageWindow, PER_PAGE_CHOICES } from "./pagination";

describe("paginate — 안전한 페이지 계산", () => {
  it("정상 계산: 95개를 20개씩이면 5페이지, 3페이지의 skip 은 40", () => {
    const p = paginate(95, 3, 20);
    expect(p).toEqual({ page: 3, pages: 5, skip: 40, take: 20 });
  });

  it("범위 밖 페이지는 끝으로 붙인다 — 삭제로 개수가 줄어도 빈 화면이 안 된다", () => {
    expect(paginate(95, 99, 20).page).toBe(5);
    expect(paginate(95, 0, 20).page).toBe(1);
    expect(paginate(95, -3, 20).page).toBe(1);
  });

  it("숫자가 아니거나 소수면 1페이지로", () => {
    expect(paginate(95, Number.NaN, 20).page).toBe(1);
    expect(paginate(95, 2.7, 20).page).toBe(2); // 내림 — 주소를 손으로 고쳐도 안전
  });

  it("0개여도 1페이지 1장으로 산다 (빈 목록 화면)", () => {
    expect(paginate(0, 1, 20)).toEqual({ page: 1, pages: 1, skip: 0, take: 20 });
  });

  it("허용되지 않은 페이지 크기는 기본값으로 — 주소 조작으로 10000개를 못 당긴다", () => {
    expect(paginate(95, 1, 10000).take).toBe(PER_PAGE_CHOICES[0]);
    expect(paginate(95, 1, 7).take).toBe(PER_PAGE_CHOICES[0]);
    expect(paginate(95, 1, Number.NaN).take).toBe(PER_PAGE_CHOICES[0]);
  });

  it("페이지 크기 선택지는 요구 범위(20~50) 안이다", () => {
    for (const c of PER_PAGE_CHOICES) {
      expect(c).toBeGreaterThanOrEqual(20);
      expect(c).toBeLessThanOrEqual(50);
    }
  });
});

describe("pageWindow — 표시할 페이지 번호", () => {
  it("적으면 전부", () => {
    expect(pageWindow(3, 1)).toEqual([1, 2, 3]);
  });
  it("많으면 현재 주변만 — 양끝은 항상 포함", () => {
    expect(pageWindow(20, 10)).toEqual([1, 8, 9, 10, 11, 12, 20]);
  });
  it("맨 앞·맨 뒤에서도 중복 없이", () => {
    expect(pageWindow(20, 1)).toEqual([1, 2, 3, 20]);
    expect(pageWindow(20, 20)).toEqual([1, 18, 19, 20]);
  });
});
