export interface StatusMeta {
  label: string;
  tone: string;
}

/**
 * 주문 상태 라벨/색상. 결제 단계 상태는 포트원 연동에서 사용.
 * 톤은 절제된 팔레트로 통일 — 완료/확정만 진한 잉크, 진행중은 로즈, 종료·실패는 회색.
 */
export const ORDER_STATUS: Record<string, StatusMeta> = {
  PENDING_PAYMENT: { label: "결제대기", tone: "bg-hairline-soft text-muted" },
  PAID: { label: "결제완료", tone: "bg-brand-50 text-brand-600" },
  RECEIVED: { label: "접수됨", tone: "bg-brand-50 text-brand-600" },
  PREPARING: { label: "배송준비", tone: "bg-brand-100 text-brand-700" },
  SHIPPED: { label: "배송중", tone: "bg-brand-200 text-brand-700" },
  DELIVERED: { label: "배송완료", tone: "bg-ink-deep text-white" },
  CANCELED: { label: "취소", tone: "bg-hairline-soft text-muted" },
  PAYMENT_FAILED: { label: "결제실패", tone: "bg-hairline-soft text-muted" },
};

/** 어드민에서 수동으로 지정 가능한 배송 상태 흐름. */
export const FULFILLMENT_STATUSES = ["RECEIVED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELED"] as const;

export const orderStatusLabel = (s: string): string => ORDER_STATUS[s]?.label ?? s;
export const orderStatusTone = (s: string): string =>
  ORDER_STATUS[s]?.tone ?? "bg-hairline-soft text-muted";
