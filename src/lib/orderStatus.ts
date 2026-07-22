export interface StatusMeta {
  label: string;
  tone: string;
}

/** 주문 상태 라벨/색상. 결제 단계 상태는 포트원 연동에서 사용. */
export const ORDER_STATUS: Record<string, StatusMeta> = {
  PENDING_PAYMENT: { label: "결제대기", tone: "bg-line text-muted" },
  PAID: { label: "결제완료", tone: "bg-brand-50 text-brand-600" },
  RECEIVED: { label: "접수됨", tone: "bg-brand-50 text-brand-600" },
  PREPARING: { label: "배송준비", tone: "bg-brand-100 text-brand-700" },
  SHIPPED: { label: "배송중", tone: "bg-brand-200 text-brand-700" },
  DELIVERED: { label: "배송완료", tone: "bg-brand-500 text-white" },
  CANCELED: { label: "취소", tone: "bg-line text-muted" },
  PAYMENT_FAILED: { label: "결제실패", tone: "bg-line text-muted" },
};

/** 어드민에서 수동으로 지정 가능한 배송 상태 흐름. */
export const FULFILLMENT_STATUSES = ["RECEIVED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELED"] as const;

export const orderStatusLabel = (s: string): string => ORDER_STATUS[s]?.label ?? s;
export const orderStatusTone = (s: string): string => ORDER_STATUS[s]?.tone ?? "bg-line text-muted";
