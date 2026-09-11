/**
 * 승인 결과 불명(UNCERTAIN) 결제를 거래조회 결과로 어떻게 처리할지 — 순수 판정.
 *
 * 승인 응답을 못 받고 망취소도 실패하면 돈이 나갔는지 알 수 없어 주문을 결제대기로
 * 둔 채 운영자를 부른다(markNicePayUncertain). 예전엔 거기서 끝이었다 — 운영자가
 * 할 수 있는 건 상태 드롭다운뿐이었고, 그건 #2 로 막혔다(2026-09-11 리뷰 #7).
 *
 * 이 함수는 나이스페이 거래조회 응답을 넷 중 하나로 가른다. **확신이 없으면 hold** 다 —
 * 잘못 확정하면 돈 안 받고 물건이 나가고, 잘못 정리하면 돈 받고 재고를 돌려놓는다.
 */

/** nicepay.ts 의 NicePayCall 과 같은 모양 — 순수 모듈이라 타입만 따로 둔다 */
export type LookupResult =
  | { ok: true; body: { status?: string; amount?: number; tid?: string; balanceAmt?: number; payMethod?: string }; raw: string }
  | { ok: false; kind: "declined" | "unknown"; code: string; message: string };

export type UncertainDecision =
  /** 승인돼 있고 금액이 맞다 → 결제완료로 확정 */
  | { action: "settle"; tid: string; amount: number; method: string | null; raw: string }
  /** 나이스페이 쪽에서 승인 뒤 전액 취소됐다 → 돈은 돌아갔다, 주문만 닫는다 */
  | { action: "canceled"; raw: string }
  /** 승인된 적이 없다(거래 없음·인증만·거절·만료) → 돈이 안 나갔다, 재고를 돌려놓는다 */
  | { action: "fail"; reason: string; raw?: string }
  /** 판단할 수 없다 → 아무것도 바꾸지 않고 사유를 보여 준다 */
  | { action: "hold"; reason: string };

/** 나이스페이 "거래내역이 존재하지 않습니다" — 승인이 없었다는 뜻 */
const NO_TRANSACTION_CODES = ["U107"];

export function decideUncertain(lookup: LookupResult, expectedAmount: number): UncertainDecision {
  if (!lookup.ok) {
    if (lookup.kind === "unknown") {
      return { action: "hold", reason: `거래조회 응답을 받지 못했습니다 (${lookup.code}). 잠시 후 다시 시도해주세요.` };
    }
    if (NO_TRANSACTION_CODES.includes(lookup.code) || lookup.code === "HTTP_404") {
      return { action: "fail", reason: "나이스페이 거래조회 결과 승인 내역 없음 — 관리자 확인" };
    }
    // 인증 오류 등 — 거래가 없다는 뜻이 아니다
    return { action: "hold", reason: `거래조회가 거절됐습니다 (${lookup.code} ${lookup.message}). 키 설정을 확인해주세요.` };
  }

  const status = (lookup.body.status ?? "").toLowerCase();
  const amount = lookup.body.amount;
  const tid = (lookup.body.tid ?? "").trim();

  if (status === "paid") {
    if (typeof amount !== "number" || amount !== expectedAmount) {
      return {
        action: "hold",
        reason: `승인은 됐는데 금액이 다릅니다 (나이스페이 ${amount ?? "?"}원 / 주문 ${expectedAmount}원). 가맹점관리자에서 확인해주세요.`,
      };
    }
    if (typeof lookup.body.balanceAmt === "number" && lookup.body.balanceAmt < amount) {
      return { action: "hold", reason: "승인 뒤 일부가 취소된 거래입니다. 금액·재고를 사람이 맞춰야 합니다." };
    }
    if (!tid) return { action: "hold", reason: "승인은 됐는데 거래번호(tid)가 없습니다. 가맹점관리자에서 확인해주세요." };
    return { action: "settle", tid, amount, method: lookup.body.payMethod ?? null, raw: lookup.raw };
  }

  if (status === "cancelled" || status === "canceled") {
    return { action: "canceled", raw: lookup.raw };
  }

  if (status === "partialcancelled") {
    return { action: "hold", reason: "승인 뒤 일부가 취소된 거래입니다. 금액·재고를 사람이 맞춰야 합니다." };
  }

  // ready(인증만)·failed·expired — 승인이 없었다. 돈이 안 나갔다.
  if (["ready", "failed", "expired"].includes(status)) {
    return { action: "fail", reason: `나이스페이 거래조회 결과 승인 없음 (${status}) — 관리자 확인`, raw: lookup.raw };
  }

  return { action: "hold", reason: `알 수 없는 거래 상태(${status || "없음"})입니다. 가맹점관리자에서 확인해주세요.` };
}
