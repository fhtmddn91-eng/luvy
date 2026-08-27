export interface StatusMeta {
  label: string;
  tone: string;
}

/**
 * 주문 상태 라벨/색상.
 * 모노크롬 기조 — 진행중은 아웃라인, 완료는 블랙 채움, 종료·실패는 연회색.
 */
export const ORDER_STATUS: Record<string, StatusMeta> = {
  PENDING_PAYMENT: { label: "결제대기", tone: "bg-hairline-soft text-muted" },
  PAID: { label: "결제완료", tone: "border border-ink-deep text-ink-deep" },
  RECEIVED: { label: "접수됨", tone: "border border-ink-deep text-ink-deep" },
  PREPARING: { label: "배송준비", tone: "border border-ink-deep text-ink-deep" },
  SHIPPED: { label: "배송중", tone: "bg-ink-soft text-white" },
  DELIVERED: { label: "배송완료", tone: "bg-ink-deep text-white" },
  CANCELED: { label: "취소", tone: "bg-hairline-soft text-muted" },
  PAYMENT_FAILED: { label: "결제실패", tone: "bg-hairline-soft text-muted" },
};

/**
 * 어드민 '상태 변경' 에서 수동으로 지정 가능한 값.
 *
 * **CANCELED 는 여기 없다.** 예전엔 들어 있어서 드롭다운에서 '취소'를 고르면
 * 상태만 바뀌고 재고 복원도 환불도 안 됐다 — 바로 아래 붙어 있는 '주문 취소'
 * 버튼과 생김새가 같아 어느 쪽을 눌렀는지도 남지 않았다. 취소는 재고·환불을
 * 함께 처리하는 cancelOrderCore 한 경로로만 간다.
 */
export const MANUAL_STATUSES = ["RECEIVED", "PREPARING", "SHIPPED", "DELIVERED"] as const;

export const isManualStatus = (s: string): boolean =>
  (MANUAL_STATUSES as readonly string[]).includes(s);

/** 되돌릴 수 없는 종료 상태 */
const TERMINAL_STATUSES = ["CANCELED", "PAYMENT_FAILED"] as const;

export interface StatusChangeInput {
  from: string;
  to: string;
  /** paymentMethods.ts 의 value. 무통장이면 입금 확인을 거쳐야 접수를 벗어난다 */
  paymentMethod: string;
  /** 무통장 입금 확인 시각. null 이면 아직 돈이 안 들어온 것으로 본다 */
  depositConfirmedAt: Date | null;
}

/**
 * 무통장 주문이 '접수됨'을 벗어나려면 입금 확인을 거쳐야 하는가.
 *
 * 판정을 **RECEIVED 를 떠날 때만** 한다. 이미 배송준비 이상으로 가 있는 주문은
 * 이 기능이 생기기 전에 운영자가 통장을 보고 넘긴 것들이라, 여기서 막으면
 * 기존 주문의 송장 입력이 통째로 잠긴다.
 */
export function needsDepositConfirm(i: {
  from: string;
  paymentMethod: string;
  depositConfirmedAt: Date | null;
}): boolean {
  return i.from === "RECEIVED" && i.paymentMethod === "BANK_TRANSFER" && i.depositConfirmedAt === null;
}

/**
 * 상태 변경을 거부할 이유. null 이면 통과.
 *
 * UI 에서 감추는 것만으로는 부족해서 서버에서 같은 판단을 한다 — 서버 액션은
 * 폼 값을 그대로 받으므로 화면에 없는 값도 들어올 수 있다.
 */
export function statusChangeRejection(i: StatusChangeInput): string | null {
  if (i.to === "CANCELED") {
    return "취소는 '주문 취소' 버튼으로만 처리할 수 있습니다. 재고 복원과 환불이 함께 이뤄져야 합니다.";
  }
  if (!isManualStatus(i.to)) return "이 화면에서 지정할 수 없는 상태입니다.";
  if ((TERMINAL_STATUSES as readonly string[]).includes(i.from)) {
    return `이미 종료된 주문(${orderStatusLabel(i.from)})의 상태는 되돌릴 수 없습니다.`;
  }
  if (i.to !== i.from && needsDepositConfirm(i)) {
    return "무통장 입금이 아직 확인되지 않았습니다. '입금 확인'을 먼저 처리해주세요.";
  }
  return null;
}

/**
 * 회원이 직접 취소할 수 있는 상태. 발송 이후에는 취소가 아니라 반품 절차라
 * 고객센터를 거치게 한다.
 */
export const MEMBER_CANCELABLE_STATUSES = ["PAID", "RECEIVED", "PREPARING"] as const;

export interface CancelableOrder {
  status: string;
  trackingNo: string;
}

export function isMemberCancelable(order: CancelableOrder): boolean {
  // 상태가 늦게 반영됐더라도 송장이 나갔으면 이미 물건이 떠난 것으로 본다.
  if (order.trackingNo !== "") return false;
  return (MEMBER_CANCELABLE_STATUSES as readonly string[]).includes(order.status);
}

/** 회원이 고를 수 있는 취소 사유. */
export const CANCEL_REASONS = [
  "단순 변심",
  "주문 실수 (수량·상품)",
  "배송이 너무 늦어짐",
  "다른 상품으로 재주문",
  "기타",
] as const;

export const isCancelReason = (r: string): boolean =>
  (CANCEL_REASONS as readonly string[]).includes(r);

/** 사유 + 상세 메모를 한 줄로 합친다. (상세는 선택) */
export function formatCancelReason(reason: string, detail: string): string {
  const trimmed = detail.trim();
  return trimmed ? `${reason} — ${trimmed}` : reason;
}

export const orderStatusLabel = (s: string): string => ORDER_STATUS[s]?.label ?? s;
export const orderStatusTone = (s: string): string =>
  ORDER_STATUS[s]?.tone ?? "bg-hairline-soft text-muted";
