/**
 * 등급별 적립 포인트 계산 (운영자 요청서 3번, 2026-09-05) — 순수 함수.
 *
 * 적립률은 **만분율**(100 = 1%)로 저장한다. 0.5% 같은 소수 % 를 부동소수로 들고
 * 다니면 123,456원 × 0.005 처럼 원 단위에서 오차가 튀고, 회수할 때 액수가
 * 어긋난다. 정수로 곱하고 마지막에 한 번만 나눈다.
 */

/** 기준액 × 적립률(만분율), 원 미만 버림. 음수·깨진 값은 0 */
export function pointsFor(baseWon: number, rateBp: number): number {
  if (!Number.isFinite(baseWon) || !Number.isFinite(rateBp)) return 0;
  if (baseWon <= 0 || rateBp <= 0) return 0;
  return Math.floor((baseWon * rateBp) / 10_000);
}

/**
 * 설정 폼의 % 입력 → 만분율. 0~100, 소수 둘째 자리까지. 아니면 null.
 * 문자열로 자릿수를 검사한다 — 0.1+0.2 류의 부동소수 판정을 피하려고.
 */
export function parseRatePercent(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bp <= 10_000 ? bp : null;
}

/** 만분율 → 화면 % ("1", "0.5", "2.75") */
export function formatRatePercent(rateBp: number): string {
  return String(rateBp / 100);
}

/* ── 결제 시 사용 (2026-09-05 규칙) ─────────────────────────────────────── */

export interface PointUsePolicy {
  /** 이 액수 이상부터 쓸 수 있다 (0 = 제한 없음) */
  minUse: number;
  /** 이 단위의 배수로만 (1 = 제한 없음) */
  unit: number;
}

export type PointUseCheck = { ok: true; amount: number } | { ok: false; error: string };

const p = (n: number) => `${n.toLocaleString("ko-KR")}P`;

/**
 * 주문서 포인트 사용 검사. 폼 값은 조작할 수 있으므로 서버가 다시 돌린다.
 * 규칙 순서는 손님이 고칠 수 있는 것부터: 정수 → 단위 → 최소 → 잔액 → 총액.
 * 총액(배송비 포함)을 넘는 사용은 거부 — 포인트로 거스름돈을 만들지 않는다.
 */
export function validatePointUse(input: {
  requested: number;
  balance: number;
  orderTotal: number;
  minUse: number;
  unit: number;
}): PointUseCheck {
  const { requested, balance, orderTotal } = input;
  const unit = Math.max(1, Math.floor(input.unit));
  const minUse = Math.max(0, Math.floor(input.minUse));
  if (!Number.isInteger(requested) || requested < 0) return { ok: false, error: "포인트는 0 이상의 정수로 입력해주세요." };
  if (requested === 0) return { ok: true, amount: 0 };
  if (requested % unit !== 0) return { ok: false, error: `포인트는 ${p(unit)} 단위로 쓸 수 있습니다.` };
  if (requested < minUse) return { ok: false, error: `포인트는 ${p(minUse)} 이상부터 쓸 수 있습니다.` };
  if (requested > balance) return { ok: false, error: `보유 잔액(${p(balance)})보다 많이 쓸 수 없습니다.` };
  if (requested > orderTotal) return { ok: false, error: `결제 금액(${orderTotal.toLocaleString("ko-KR")}원)보다 많이 쓸 수 없습니다.` };
  return { ok: true, amount: requested };
}

/** 「전액 사용」이 채울 값 — 잔액·총액 중 작은 쪽을 단위로 내림, 최소 미만이면 0 */
export function maxPointUse(input: { balance: number; orderTotal: number; minUse: number; unit: number }): number {
  const unit = Math.max(1, Math.floor(input.unit));
  const cap = Math.max(0, Math.min(input.balance, input.orderTotal));
  const amount = Math.floor(cap / unit) * unit;
  return amount >= Math.max(0, input.minUse) ? amount : 0;
}

/** 적립 기준액 — 포인트로 산 부분엔 적립하지 않는다 */
export function accrualBase(subtotal: number, pointsUsed: number): number {
  return Math.max(0, subtotal - pointsUsed);
}

/** 결제금액 = 상품 + 배송비 − 포인트 (0 미만은 0) */
export function orderTotalAfterPoints(subtotal: number, shippingFee: number, pointsUsed: number): number {
  return Math.max(0, subtotal + shippingFee - pointsUsed);
}
