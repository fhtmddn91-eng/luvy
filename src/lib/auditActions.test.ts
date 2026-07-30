import { describe, it, expect } from "vitest";
import {
  AUDIT_ACTIONS,
  AUDIT_GROUPS,
  auditLabel,
  isCritical,
  actionsForGroup,
  type AuditAction,
} from "./auditActions";

describe("감사 로그 동작 표", () => {
  it("모든 동작에 한글 라벨이 있다", () => {
    for (const [code, label] of Object.entries(AUDIT_ACTIONS)) {
      expect(label, code).toBeTruthy();
      expect(label, code).not.toBe(code);
    }
  });

  it("모든 동작이 정확히 한 그룹에 속한다 (조회 화면에서 누락·중복 방지)", () => {
    const all = Object.keys(AUDIT_ACTIONS) as AuditAction[];
    const grouped = AUDIT_GROUPS.flatMap((g) => g.actions);
    expect(new Set(grouped).size, "그룹 간 중복").toBe(grouped.length);
    for (const a of all) expect(grouped, `${a} 가 어느 그룹에도 없음`).toContain(a);
    expect(grouped.length).toBe(all.length);
  });

  it("모르는 코드는 코드 자체를 보여준다", () => {
    expect(auditLabel("MEMBER_APPROVE")).toBe("회원 승인");
    expect(auditLabel("WHAT_IS_THIS")).toBe("WHAT_IS_THIS");
  });

  it("돈·권한이 걸린 동작은 중요 표시된다", () => {
    expect(isCritical("ORDER_CANCEL_ADMIN")).toBe(true);
    expect(isCritical("MEMBER_TEMP_PASSWORD")).toBe(true);
    expect(isCritical("ADMIN_PASSWORD")).toBe(true);
    expect(isCritical("ORDER_STATUS")).toBe(false);
  });

  it("그룹 필터가 코드 목록을 돌려준다", () => {
    expect(actionsForGroup("member")).toContain("MEMBER_APPROVE");
    expect(actionsForGroup("order")).toContain("ORDER_CANCEL_MEMBER");
    // 없는 그룹이면 빈 배열 (전체 조회로 떨어지게)
    expect(actionsForGroup("nope")).toEqual([]);
  });
});
