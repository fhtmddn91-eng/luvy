import { describe, it, expect } from "vitest";
import {
  isMemberCancelable,
  isCancelReason,
  formatCancelReason,
  CANCEL_REASONS,
  FULFILLMENT_STATUSES,
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
    for (const s of FULFILLMENT_STATUSES) {
      expect(ORDER_STATUS[s], s).toBeDefined();
      expect(orderStatusLabel(s)).not.toBe(s);
    }
  });

  it("모르는 상태는 코드를 그대로 보여주고 기본 톤을 준다", () => {
    expect(orderStatusLabel("WEIRD")).toBe("WEIRD");
    expect(orderStatusTone("WEIRD")).toBe("bg-hairline-soft text-muted");
  });
});
