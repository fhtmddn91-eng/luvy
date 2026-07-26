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

export const orderStatusLabel = (s: string): string => ORDER_STATUS[s]?.label ?? s;
export const orderStatusTone = (s: string): string =>
  ORDER_STATUS[s]?.tone ?? "bg-hairline-soft text-muted";
