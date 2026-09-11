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
  /*
   * 같은 상태는 변경이 아니다 — 여기서 먼저 통과시킨다. 아래 "수동 지정 불가" 검사보다
   * 앞이어야 한다: 결제완료(PAID)는 수동 목록에 없어서, 드롭다운이 현재 상태를 그대로
   * 제출하면 "지정할 수 없는 상태" 오류가 났다(2026-09-11 리뷰).
   */
  if (i.to === i.from) return null;
  if (i.to === "CANCELED") {
    return "취소는 '주문 취소' 버튼으로만 처리할 수 있습니다. 재고 복원과 환불이 함께 이뤄져야 합니다.";
  }
  if (!isManualStatus(i.to)) return "이 화면에서 지정할 수 없는 상태입니다.";
  if ((TERMINAL_STATUSES as readonly string[]).includes(i.from)) {
    return `이미 종료된 주문(${orderStatusLabel(i.from)})의 상태는 되돌릴 수 없습니다.`;
  }
  /*
   * 카드 결제대기 — 돈이 아직 안 들어왔다. 무통장은 needsDepositConfirm 이 막는데
   * 카드는 관문이 없어, 결제창을 닫고 떠난 주문을 드롭다운으로 배송준비·배송완료로
   * 넘길 수 있었다(2026-09-11 리뷰). 배송완료는 적립까지 한다 — 물건이 공짜로 나간다.
   * 승인 결과 불명(Payment UNCERTAIN)도 주문은 이 상태라 같이 막힌다.
   */
  if (i.from === "PENDING_PAYMENT") {
    return "카드 결제가 아직 완료되지 않은 주문입니다. 결제가 확정되면 자동으로 결제완료가 됩니다. 결제되지 않은 주문은 '주문 취소'로 정리해주세요.";
  }
  /*
   * 결제완료 → 접수됨은 돈을 받은 주문을 "아직 안 받은" 칸으로 되돌리는 것이다.
   * 접수됨은 매출 집계(PAID_STATUSES)에서 빠지므로 카드 매출이 장부에서 사라진다.
   * 실사례(2026-09-11): 드롭다운이 결제완료 주문에서 첫 항목 '접수됨'을 기본으로
   * 보여 줘, 아무것도 안 고치고 저장만 눌러도 이 길로 들어왔다.
   */
  if (i.from === "PAID" && i.to === "RECEIVED") {
    return "결제완료 주문은 접수됨으로 되돌릴 수 없습니다. 결제를 무르려면 '결제 취소 (환불)'을 쓰세요.";
  }
  if (i.to !== i.from && needsDepositConfirm(i)) {
    return "무통장 입금이 아직 확인되지 않았습니다. '입금 확인'을 먼저 처리해주세요.";
  }
  return null;
}

/**
 * 송장을 붙일 수 있는 주문인가. null 이면 통과.
 *
 * 송장 입력에는 상태 관문이 없었다(2026-09-11 리뷰) — 취소된 주문·미결제 주문에도
 * 운송장을 붙일 수 있었고, 미결제 주문은 그 길로 '배송중'이 됐다. 배송 이후 상태는
 * 송장 정정을 위해 열어 둔다.
 */
export function shippingEntryRejection(status: string): string | null {
  if (status === "PENDING_PAYMENT") return "카드 결제가 완료되지 않은 주문에는 송장을 붙일 수 없습니다.";
  if (status === "CANCELED") return "취소된 주문에는 송장을 붙일 수 없습니다.";
  if (status === "PAYMENT_FAILED") return "결제가 실패한 주문에는 송장을 붙일 수 없습니다.";
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
