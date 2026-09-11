/**
 * 결제 상세 표시 (순수 함수 — 화면·테스트에서 같이 쓴다).
 *
 * 실사례(2026-09-11 리뷰): 어드민 결제 칸이 상태·수단·채널·금액 네 줄뿐이었고,
 * 그나마 상태 6개 중 4개(READY·FAILED·CANCEL_FAILED·UNCERTAIN)는 라벨이 없어
 * 영어 코드가 그대로 떴다. 수단도 나이스페이가 주는 "card"(소문자)를 CARD 표에서
 * 찾다가 못 찾아 "card" 로 보였다. 거래번호·승인시각·카드사·승인번호·영수증은
 * 응답 전문에 8000자까지 저장해 두고 한 글자도 안 보여줬다.
 *
 * 위험한 두 상태(CANCEL_FAILED·UNCERTAIN)는 사람이 즉시 손을 써야 하는 자리라
 * 라벨만으로는 부족하다 — 뭘 해야 하는지(hint)까지 함께 준다.
 */

export interface PaymentStatusMeta {
  label: string;
  tone: string;
  /** 운영자가 지금 해야 할 일. 없으면 평상 상태 */
  hint?: string;
}

export const PAYMENT_STATUS: Record<string, PaymentStatusMeta> = {
  READY: { label: "결제창 열림 (미승인)", tone: "bg-hairline-soft text-muted" },
  PAID: { label: "결제완료", tone: "border border-ink-deep text-ink-deep" },
  FAILED: { label: "결제실패", tone: "bg-hairline-soft text-muted" },
  CANCELED: { label: "취소·환불됨", tone: "bg-hairline-soft text-muted" },
  CANCEL_FAILED: {
    label: "환불 실패 — 재시도 필요",
    tone: "bg-brand-600 text-white",
    hint: "손님 돈은 아직 나이스페이에 있습니다. 아래 「환불 재시도 후 취소」를 누르세요. 계속 실패하면 나이스페이 가맹점관리자에서 거래번호로 직접 취소한 뒤 다시 누르면 반영됩니다.",
  },
  UNCERTAIN: {
    label: "승인 결과 불명 — 확인 필요",
    tone: "bg-brand-600 text-white",
    hint: "승인 응답을 못 받았고 망취소도 실패했습니다. 돈이 나갔는지 알 수 없습니다. 나이스페이 가맹점관리자에서 아래 나이스페이 주문번호로 거래를 조회한 뒤 — 승인돼 있으면 곧 웹훅으로 결제완료가 되고, 없으면 「주문 취소」로 재고를 돌려놓으세요.",
  },
};

export const paymentStatusLabel = (s: string): string => PAYMENT_STATUS[s]?.label ?? s;
export const paymentStatusTone = (s: string): string =>
  PAYMENT_STATUS[s]?.tone ?? "bg-hairline-soft text-muted";
export const paymentStatusHint = (s: string): string | undefined => PAYMENT_STATUS[s]?.hint;

/** 나이스페이 payMethod 값 → 한글. 응답은 소문자로 온다("card") */
const NICEPAY_METHOD: Record<string, string> = {
  card: "신용카드",
  vbank: "가상계좌",
  bank: "계좌이체",
  cellphone: "휴대폰",
  naverpaycard: "네이버페이 (카드)",
  naverpaypoint: "네이버페이 (포인트)",
  kakaopay: "카카오페이",
  payco: "페이코",
  samsungpay: "삼성페이",
  ssgpay: "SSG페이",
  cardandeasypay: "간편결제",
};

/** 모르는 값은 코드 그대로 — 단, 절대 undefined 를 돌려주지 않는다 */
export function paymentMethodName(method: string | null | undefined): string {
  if (!method) return "—";
  return NICEPAY_METHOD[method.toLowerCase()] ?? method;
}

/** 응답 전문(rawResponse)에서 화면에 쓸 것만 골라낸 것 */
export interface NicePayReceipt {
  cardName: string;
  /** 나이스페이가 준 그대로 — 대부분 이미 가운데가 가려져 온다 */
  cardNum: string;
  approveNo: string;
  /** 할부 개월. "00" 이면 일시불 */
  installment: string;
  receiptUrl: string;
  paidAt: Date | null;
  cancelledAt: Date | null;
  /** 취소 뒤 남은 금액 — 부분 취소 대사에 쓴다 */
  balanceAmt: number | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const date = (v: unknown): Date | null => {
  const s = str(v);
  if (!s || s === "0") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * 카드번호 가리기. 나이스페이는 보통 가려서 주지만("5310-****-****-1234"),
 * 혹시 맨 번호가 오면 앞 6·뒤 4만 남긴다 — 화면에 그대로 찍으면 안 되는 값이다.
 */
export function maskCardNum(raw: string): string {
  const s = str(raw);
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  // 이미 가려져 있으면(숫자가 12개 미만) 준 대로
  if (digits.length < 12 || s.includes("*")) return s;
  return `${digits.slice(0, 6)}${"*".repeat(digits.length - 10)}${digits.slice(-4)}`;
}

/** "00" → 일시불, "03" → 3개월 */
export function installmentLabel(quota: string): string {
  const n = Number(str(quota));
  if (!Number.isFinite(n) || n <= 0) return "일시불";
  return `${n}개월`;
}

/** 전문이 없거나 깨져 있어도 터지지 않는다 — 빈 영수증을 돌려준다 */
export function parseNicePayReceipt(raw: string | null | undefined): NicePayReceipt {
  const empty: NicePayReceipt = {
    cardName: "", cardNum: "", approveNo: "", installment: "", receiptUrl: "",
    paidAt: null, cancelledAt: null, balanceAmt: null,
  };
  if (!raw) return empty;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return empty;
  }
  if (!j || typeof j !== "object") return empty;
  const card = (j.card && typeof j.card === "object" ? j.card : {}) as Record<string, unknown>;
  const balance = typeof j.balanceAmt === "number" ? j.balanceAmt : null;
  return {
    cardName: str(card.cardName),
    cardNum: maskCardNum(str(card.cardNum)),
    approveNo: str(j.approveNo),
    installment: str(card.cardQuota),
    // 영수증 링크는 https 만 믿는다 — 전문은 외부에서 온 값이다
    receiptUrl: /^https:\/\//.test(str(j.receiptUrl)) ? str(j.receiptUrl) : "",
    paidAt: date(j.paidAt),
    cancelledAt: date(j.cancelledAt),
    balanceAmt: balance,
  };
}
