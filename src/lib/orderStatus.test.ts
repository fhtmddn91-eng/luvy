import { describe, it, expect } from "vitest";
import {
  isMemberCancelable,
  isCancelReason,
  formatCancelReason,
  CANCEL_REASONS,
  MANUAL_STATUSES,
  isManualStatus,
  needsDepositConfirm,
  statusChangeRejection,
  orderStatusLabel,
  orderStatusTone,
  ORDER_STATUS,
} from "./orderStatus";

const order = (status: string, trackingNo = "") => ({ status, trackingNo });

describe("isMemberCancelable", () => {
  it("발송 전 주문은 회원이 직접 취소할 수 있다", () => {
    expect(isMemberCancelable(order("PAID"))).toBe(true);
    expect(isMemberCancelable(order("RECEIVED"))).toBe(true);
    expect(isMemberCancelable(order("PREPARING"))).toBe(true);
  });

  it("발송 이후·종료된 주문은 취소할 수 없다", () => {
    expect(isMemberCancelable(order("SHIPPED"))).toBe(false);
    expect(isMemberCancelable(order("DELIVERED"))).toBe(false);
    expect(isMemberCancelable(order("CANCELED"))).toBe(false);
    expect(isMemberCancelable(order("PAYMENT_FAILED"))).toBe(false);
  });

  it("결제 대기 주문은 회원 화면에 뜨지 않으므로 대상이 아니다", () => {
    expect(isMemberCancelable(order("PENDING_PAYMENT"))).toBe(false);
  });

  it("상태가 배송준비여도 송장이 나갔으면 취소할 수 없다", () => {
    // 운영자가 송장만 넣고 상태 반영이 늦은 경우 — 물건은 이미 떠났다
    expect(isMemberCancelable(order("PREPARING", "601234567890"))).toBe(false);
  });
});

describe("취소 사유", () => {
  it("정해진 사유만 받는다 (임의 문자열 주입 방지)", () => {
    for (const r of CANCEL_REASONS) expect(isCancelReason(r)).toBe(true);
    expect(isCancelReason("")).toBe(false);
    expect(isCancelReason("아무말")).toBe(false);
  });

  it("상세 내용이 있으면 한 줄로 합친다", () => {
    expect(formatCancelReason("단순 변심", "")).toBe("단순 변심");
    expect(formatCancelReason("단순 변심", "  ")).toBe("단순 변심");
    expect(formatCancelReason("기타", "수량 잘못 입력")).toBe("기타 — 수량 잘못 입력");
  });
});

describe("상태 라벨", () => {
  it("어드민이 지정 가능한 상태는 모두 라벨을 가진다", () => {
    for (const s of MANUAL_STATUSES) {
      expect(ORDER_STATUS[s], s).toBeDefined();
      expect(orderStatusLabel(s)).not.toBe(s);
    }
  });

  it("모르는 상태는 코드를 그대로 보여주고 기본 톤을 준다", () => {
    expect(orderStatusLabel("WEIRD")).toBe("WEIRD");
    expect(orderStatusTone("WEIRD")).toBe("bg-hairline-soft text-muted");
  });
});

describe("MANUAL_STATUSES — 취소는 목록에 없다", () => {
  it("드롭다운에 CANCELED 가 들어가지 않는다", () => {
    // 실사례: 목록에 CANCELED 가 있어서 '취소'를 골라 저장하면 상태만 바뀌고
    // 재고 복원·환불이 통째로 빠졌다. 바로 아래 붙은 '주문 취소' 버튼과 구분이 안 됐다.
    expect(MANUAL_STATUSES).not.toContain("CANCELED");
    expect(isManualStatus("CANCELED")).toBe(false);
    expect(isManualStatus("PAYMENT_FAILED")).toBe(false);
    expect(isManualStatus("PENDING_PAYMENT")).toBe(false);
  });

  it("배송 흐름 네 가지는 그대로 고를 수 있다", () => {
    for (const s of ["RECEIVED", "PREPARING", "SHIPPED", "DELIVERED"]) {
      expect(isManualStatus(s)).toBe(true);
    }
  });
});

describe("statusChangeRejection — 서버에서도 막는다", () => {
  const card = { paymentMethod: "NICEPAY", depositConfirmedAt: new Date() };
  const bankUnpaid = { paymentMethod: "BANK_TRANSFER", depositConfirmedAt: null };
  const bankPaid = { paymentMethod: "BANK_TRANSFER", depositConfirmedAt: new Date() };

  it("CANCELED 로의 변경은 UI 에 없어도 서버가 거부한다", () => {
    // 서버 액션은 폼 값을 그대로 받으므로 화면에서 지운 값도 들어올 수 있다
    const why = statusChangeRejection({ from: "RECEIVED", to: "CANCELED", ...card });
    expect(why).toContain("주문 취소");
  });

  it("목록에 없는 임의 상태도 거부한다", () => {
    expect(statusChangeRejection({ from: "RECEIVED", to: "PAID", ...card })).not.toBeNull();
    expect(statusChangeRejection({ from: "RECEIVED", to: "아무말", ...card })).not.toBeNull();
    expect(statusChangeRejection({ from: "RECEIVED", to: "", ...card })).not.toBeNull();
  });

  it("종료된 주문은 되살릴 수 없다", () => {
    expect(statusChangeRejection({ from: "CANCELED", to: "PREPARING", ...card })).toContain("종료된");
    expect(statusChangeRejection({ from: "PAYMENT_FAILED", to: "RECEIVED", ...card })).toContain("종료된");
  });

  it("무통장 미입금 주문은 접수됨을 벗어날 수 없다", () => {
    const why = statusChangeRejection({ from: "RECEIVED", to: "PREPARING", ...bankUnpaid });
    expect(why).toContain("입금");
    expect(statusChangeRejection({ from: "RECEIVED", to: "SHIPPED", ...bankUnpaid })).toContain("입금");
    expect(statusChangeRejection({ from: "RECEIVED", to: "DELIVERED", ...bankUnpaid })).toContain("입금");
  });

  it("입금 확인이 끝난 무통장 주문은 자유롭게 진행한다", () => {
    expect(statusChangeRejection({ from: "RECEIVED", to: "PREPARING", ...bankPaid })).toBeNull();
  });

  it("무통장이 아니면 입금 확인을 요구하지 않는다", () => {
    expect(statusChangeRejection({ from: "RECEIVED", to: "PREPARING", ...card })).toBeNull();
  });

  it("같은 상태로 다시 저장하는 것은 막지 않는다", () => {
    // 운영자가 실수로 그대로 저장했을 때 오류를 띄울 이유가 없다
    expect(statusChangeRejection({ from: "RECEIVED", to: "RECEIVED", ...bankUnpaid })).toBeNull();
  });

  it("이미 배송준비 이상인 옛 주문은 입금 확인 기록이 없어도 진행할 수 있다", () => {
    // 이 기능이 생기기 전 주문은 depositConfirmedAt 이 전부 null 이다.
    // RECEIVED 를 떠날 때만 검사하지 않으면 기존 주문의 송장 입력이 통째로 잠긴다.
    expect(statusChangeRejection({ from: "PREPARING", to: "SHIPPED", ...bankUnpaid })).toBeNull();
    expect(statusChangeRejection({ from: "SHIPPED", to: "DELIVERED", ...bankUnpaid })).toBeNull();
  });
});

describe("needsDepositConfirm", () => {
  it("무통장 + 미확인 + 접수됨 일 때만 true", () => {
    expect(needsDepositConfirm({ from: "RECEIVED", paymentMethod: "BANK_TRANSFER", depositConfirmedAt: null })).toBe(true);
    expect(needsDepositConfirm({ from: "RECEIVED", paymentMethod: "BANK_TRANSFER", depositConfirmedAt: new Date() })).toBe(false);
    expect(needsDepositConfirm({ from: "RECEIVED", paymentMethod: "NICEPAY", depositConfirmedAt: null })).toBe(false);
    expect(needsDepositConfirm({ from: "PREPARING", paymentMethod: "BANK_TRANSFER", depositConfirmedAt: null })).toBe(false);
  });
});
