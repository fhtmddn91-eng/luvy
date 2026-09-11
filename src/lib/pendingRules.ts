/**
 * 버려진 카드 결제대기 주문 판정 (순수 함수).
 *
 * 실사례(2026-09-11 리뷰): 결제창을 닫고 떠난 PENDING_PAYMENT 주문은 **같은 손님이**
 * 다시 카드 결제를 시작할 때만 정리됐다. 그냥 떠나면 재고가 잠긴 채 남는다.
 * 테스트 상품(재고 1)의 취소 주문 2건이 정확히 이 경우였고, 재시도했기 때문에
 * 풀렸을 뿐이다. 회원도 결제대기 주문은 스스로 취소할 수 없다.
 *
 * 30분인 이유: 나이스페이 결제창 인증은 그 안에 끝난다. 그리고 30분이 지나 손님이
 * 뒤늦게 승인을 마쳐도 안전하다 — returnUrl 은 주문이 PENDING_PAYMENT 가 아니면
 * 승인 API 를 부르지 않고(돈이 안 나간다), 웹훅으로 승인이 와도 닫힌 주문이면
 * 즉시 환불한다(refundStrayApproval). 즉 잘못 정리해도 돈은 안 샌다.
 */

export const STALE_PENDING_MINUTES = 30;

/** 돈이 안 나간 것이 확실한 결제 상태 — 이것만 정리 대상이다 */
const NO_MONEY_OUT = ["READY", "FAILED"] as const;

export interface PendingCandidate {
  status: string;
  paymentMethod: string;
  createdAt: Date;
  /** Payment 행이 없는 주문(트랜잭션 밖 생성 시절의 잔재)도 null 로 받는다 */
  payment: { status: string } | null;
}

export function isAbandonedPending(o: PendingCandidate, now: Date): boolean {
  if (o.status !== "PENDING_PAYMENT") return false;
  if (o.paymentMethod !== "NICEPAY") return false;
  // UNCERTAIN(돈이 나갔을 수 있음)·PAID·CANCEL_FAILED 는 절대 정리하지 않는다
  if (o.payment && !(NO_MONEY_OUT as readonly string[]).includes(o.payment.status)) return false;
  const ageMs = now.getTime() - o.createdAt.getTime();
  return ageMs >= STALE_PENDING_MINUTES * 60_000;
}

/** DB 질의에 쓸 기준 시각 */
export function staleBefore(now: Date): Date {
  return new Date(now.getTime() - STALE_PENDING_MINUTES * 60_000);
}
