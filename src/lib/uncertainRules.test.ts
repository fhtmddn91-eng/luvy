/**
 * 승인 불명 결제 판정 — 회귀 테스트.
 * 원칙 하나: **확신이 없으면 hold**. 잘못 확정하면 돈 안 받고 물건이 나가고,
 * 잘못 정리하면 돈 받고 재고를 돌려놓는다.
 */
import { describe, it, expect } from "vitest";
import { decideUncertain } from "./uncertainRules";

const paid = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  body: { status: "paid", amount: 4500, tid: "T1", balanceAmt: 4500, payMethod: "card", ...over },
  raw: "{}",
});

describe("decideUncertain — 확정(settle)", () => {
  it("승인돼 있고 금액이 맞으면 확정한다", () => {
    const d = decideUncertain(paid(), 4500);
    expect(d).toMatchObject({ action: "settle", tid: "T1", amount: 4500, method: "card" });
  });
});

describe("decideUncertain — 정리(fail): 돈이 안 나간 것이 확실할 때만", () => {
  it("거래내역 없음(U107)은 승인이 없었다는 뜻이다", () => {
    const d = decideUncertain({ ok: false, kind: "declined", code: "U107", message: "거래내역이 존재 하지 않습니다." }, 4500);
    expect(d.action).toBe("fail");
  });

  it("인증만 하고 승인 안 된 ready·failed·expired 도 정리한다", () => {
    for (const s of ["ready", "failed", "expired"]) {
      expect(decideUncertain(paid({ status: s }), 4500).action, s).toBe("fail");
    }
  });
});

describe("decideUncertain — 나이스페이 쪽 전액 취소", () => {
  it("cancelled 는 돈이 돌아간 것 — 주문만 닫는다 (환불 다시 안 부름)", () => {
    expect(decideUncertain(paid({ status: "cancelled" }), 4500).action).toBe("canceled");
    expect(decideUncertain(paid({ status: "canceled" }), 4500).action).toBe("canceled");
  });
});

describe("decideUncertain — 보류(hold): 판단할 수 없을 때", () => {
  it("조회 자체가 실패(네트워크)하면 아무것도 바꾸지 않는다", () => {
    const d = decideUncertain({ ok: false, kind: "unknown", code: "TIMEOUT", message: "" }, 4500);
    expect(d.action).toBe("hold");
    expect(d.action === "hold" && d.reason).toContain("다시 시도");
  });

  /** U116 처럼 키가 틀린 경우 — "거래가 없다"와 다르다 */
  it("인증 오류 같은 다른 거절 코드는 거래 없음으로 보지 않는다", () => {
    const d = decideUncertain({ ok: false, kind: "declined", code: "U116", message: "사용자 정보가 존재하지 않습니다." }, 4500);
    expect(d.action).toBe("hold");
  });

  /** 이게 제일 위험하다 — 다른 금액이 승인됐는데 확정하면 덜 받고 물건이 나간다 */
  it("승인은 됐는데 금액이 다르면 확정하지 않는다", () => {
    const d = decideUncertain(paid({ amount: 4000 }), 4500);
    expect(d.action).toBe("hold");
    expect(d.action === "hold" && d.reason).toContain("금액");
  });

  it("승인 뒤 일부 취소된 거래는 보류한다", () => {
    expect(decideUncertain(paid({ balanceAmt: 1000 }), 4500).action).toBe("hold");
    expect(decideUncertain(paid({ status: "partialCancelled" }), 4500).action).toBe("hold");
  });

  it("tid 없이 paid 라고 오면 보류한다 (환불할 열쇠가 없다)", () => {
    expect(decideUncertain(paid({ tid: "" }), 4500).action).toBe("hold");
  });

  it("모르는 상태값은 추측하지 않는다", () => {
    expect(decideUncertain(paid({ status: "weird" }), 4500).action).toBe("hold");
    expect(decideUncertain(paid({ status: undefined }), 4500).action).toBe("hold");
  });
});
