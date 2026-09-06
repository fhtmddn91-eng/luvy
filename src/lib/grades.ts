/**
 * 구매금액 자동 승급 판정 (2026-09-05 규칙) — 순수 함수.
 *
 * **올라가기만 하고 내려가지 않는다.** 강등은 불만의 1순위라 뺐다.
 * 기준(threshold)이 0 인 상위 등급은 자동으로 주지 않는다 — "수동 전용" 등급으로 쓴다.
 */

export interface GradeRule {
  code: string;
  /** 누적 결제확인 구매금액 기준. 0 = 자동 승급 없음(가장 낮은 등급 제외) */
  threshold: number;
  sortOrder: number;
}

const rank = (grades: GradeRule[], code: string): number | null => {
  const g = grades.find((x) => x.code === code);
  return g ? g.sortOrder : null;
};

/** 기준 ≤ 구매금액인 등급 중 가장 높은(sortOrder 큰) 것. 기준을 못 넘기면 가장 낮은 등급 */
export function gradeFor(spent: number, grades: GradeRule[]): string {
  const sorted = [...grades].sort((a, b) => a.sortOrder - b.sortOrder);
  let best = sorted[0]?.code ?? "BASIC";
  for (const g of sorted) {
    if (g === sorted[0]) continue;
    if (g.threshold > 0 && spent >= g.threshold) best = g.code;
  }
  return best;
}

/** 현재보다 높을 때만 바뀐다. 모르는 코드는 그대로 */
export function promotedGrade(current: string, target: string, grades: GradeRule[]): string {
  const cur = rank(grades, current);
  const next = rank(grades, target);
  if (cur === null || next === null) return current;
  return next > cur ? target : current;
}
