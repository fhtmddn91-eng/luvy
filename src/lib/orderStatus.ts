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

/** 어드민에서 수동으로 지정 가능한 배송 상태 흐름. */
export const FULFILLMENT_STATUSES = ["RECEIVED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELED"] as const;

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
