/**
 * 구매금액 자동 승급 판정 (2026-09-05 규칙) — 올라가기만 하고 내려가지 않는다.
 */
import { describe, it, expect } from "vitest";
import { gradeFor, promotedGrade } from "./grades";

const grades = [
  { code: "BASIC", threshold: 0, sortOrder: 0 },
  { code: "SILVER", threshold: 3_000_000, sortOrder: 1 },
  { code: "GOLD", threshold: 10_000_000, sortOrder: 2 },
];

describe("gradeFor — 누적 구매금액이 기준 이상인 가장 높은 등급", () => {
  it("기준 미만이면 가장 낮은 등급", () => {
    expect(gradeFor(0, grades)).toBe("BASIC");
    expect(gradeFor(2_999_999, grades)).toBe("BASIC");
  });
  it("기준과 같으면 그 등급 (이상)", () => {
    expect(gradeFor(3_000_000, grades)).toBe("SILVER");
    expect(gradeFor(10_000_000, grades)).toBe("GOLD");
  });
  it("기준이 0 으로 꺼진 상위 등급은 자동으로 주지 않는다 — 수동 전용 등급", () => {
    const g = [grades[0], { code: "SILVER", threshold: 0, sortOrder: 1 }, grades[2]];
    expect(gradeFor(1_000_000, g)).toBe("BASIC");
  });
  it("기준 순서가 뒤집혀 있어도(낮은 등급이 더 큰 기준) 더 높은 등급을 준다", () => {
    const g = [grades[0], { code: "SILVER", threshold: 20_000_000, sortOrder: 1 }, grades[2]];
    expect(gradeFor(12_000_000, g)).toBe("GOLD");
  });
});

describe("promotedGrade — 현재보다 높을 때만 바뀐다", () => {
  it("올라가면 새 등급", () => {
    expect(promotedGrade("BASIC", "GOLD", grades)).toBe("GOLD");
  });
  it("같거나 낮으면 현재 유지 (강등 없음)", () => {
    expect(promotedGrade("GOLD", "SILVER", grades)).toBe("GOLD");
    expect(promotedGrade("SILVER", "SILVER", grades)).toBe("SILVER");
  });
  it("모르는 등급 코드는 그대로 둔다", () => {
    expect(promotedGrade("VIP_OLD", "GOLD", grades)).toBe("VIP_OLD");
  });
});
