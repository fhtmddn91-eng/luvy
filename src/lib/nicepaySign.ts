import crypto from "node:crypto";

/**
 * 나이스페이 위변조 검증(순수 모듈 — 서버 전용 import 없음, 그래서 단위 테스트가 쉽다).
 *
 * 나이스페이는 **서버 승인 모델**이다. 결제창 인증이 끝나면 나이스페이가 returnUrl 로
 * 결과를 POST 하고, 우리가 승인 API 를 직접 불러야 돈이 빠진다. 그 사이에 오는 값
 * (금액·주문번호)은 **브라우저를 거쳐 오므로 그대로 믿으면 안 된다** — 금액을 100원으로
 * 바꿔 보내면 100원만 받고 물건이 나간다. 매뉴얼도 "금액 변조 검증 미처리로 인한 모든
 * 책임은 가맹점에 있습니다" 라고 못 박고 있다.
 *
 * 검증식은 자리 순서가 전부 다르다 (매뉴얼 기준):
 *   returnUrl signature : hex(sha256(authToken + clientId + amount + SecretKey))
 *   승인 signData       : hex(sha256(tid + amount + ediDate + SecretKey))
 *   취소 signData       : hex(sha256(tid + ediDate + SecretKey))
 *   망취소 signData     : hex(sha256(orderId + ediDate + SecretKey))
 *   웹훅 signature      : hex(sha256(tid + amount + ediDate + SecretKey))
 * 순서를 섞으면 승인이 통째로 거절된다(돈은 안 나가지만 결제가 안 된다).
 */

const sha256Hex = (s: string): string => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/** 전문생성일시 — ISO 8601. 승인·취소 요청에 그대로 실어 서명 입력으로도 쓴다 */
export const ediDateNow = (now: Date = new Date()): string => now.toISOString();

export const authSignature = (
  authToken: string,
  clientId: string,
  amount: number,
  secretKey: string,
): string => sha256Hex(`${authToken}${clientId}${amount}${secretKey}`);

export const approveSignData = (
  tid: string,
  amount: number,
  ediDate: string,
  secretKey: string,
): string => sha256Hex(`${tid}${amount}${ediDate}${secretKey}`);

export const cancelSignData = (tid: string, ediDate: string, secretKey: string): string =>
  sha256Hex(`${tid}${ediDate}${secretKey}`);

export const netCancelSignData = (orderId: string, ediDate: string, secretKey: string): string =>
  sha256Hex(`${orderId}${ediDate}${secretKey}`);

/** 웹훅 전문 검증값 — 승인 signData 와 식은 같지만 쓰이는 자리가 달라 따로 둔다 */
export const webhookSignature = (
  tid: string,
  amount: number,
  ediDate: string,
  secretKey: string,
): string => sha256Hex(`${tid}${amount}${ediDate}${secretKey}`);

/**
 * 서명 비교. 길이가 같을 때만 timingSafeEqual 을 쓴다 —
 * 길이가 다르면 예외가 나므로 먼저 걸러야 한다(그 자체가 불일치다).
 */
export function signatureMatches(expected: string, given: string): boolean {
  if (typeof given !== "string" || expected.length !== given.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(given, "utf8"));
}

export interface AuthResultParams {
  authResultCode?: string;
  authResultMsg?: string;
  tid?: string;
  clientId?: string;
  orderId?: string;
  amount?: string;
  authToken?: string;
  signature?: string;
}

export interface AuthCheckContext {
  clientKey: string;
  secretKey: string;
  /** 우리가 DB 에 저장해 둔 이 주문의 결제 예정 금액 — 진실은 이쪽이다 */
  expectedAmount: number;
  /** 우리가 만든 주문번호 */
  expectedOrderId: string;
}

export type AuthCheck =
  | { ok: true; tid: string; amount: number; authToken: string }
  /** code 는 로그·감사용, message 는 손님에게 보여줄 문장 */
  | { ok: false; code: string; message: string };

/**
 * returnUrl 로 돌아온 인증 결과 검사. **승인 API 를 부르기 전에** 여기를 통과해야 한다.
 *
 * 순서가 중요하다: 인증 성공 여부 → 우리 주문인지 → 금액이 우리 기록과 같은지 →
 * 서명이 맞는지. 금액을 서명보다 먼저 보는 이유는, 서명은 맞는데 금액이 다른 경우
 * (다른 주문의 값을 끼워 넣기)를 "위변조"가 아니라 "금액 불일치"로 정확히 남기기 위해서다.
 */
export function checkAuthResult(p: AuthResultParams, ctx: AuthCheckContext): AuthCheck {
  if (p.authResultCode !== "0000") {
    return {
      ok: false,
      code: `AUTH_${p.authResultCode ?? "EMPTY"}`,
      message: p.authResultMsg?.trim() || "카드 인증에 실패했습니다.",
    };
  }
  if (!p.tid || !p.authToken || !p.signature || !p.clientId) {
    return { ok: false, code: "AUTH_MISSING_FIELD", message: "결제 인증 정보가 올바르지 않습니다." };
  }
  if (p.clientId !== ctx.clientKey) {
    return { ok: false, code: "AUTH_CLIENT_MISMATCH", message: "결제 정보가 올바르지 않습니다." };
  }
  if (p.orderId !== ctx.expectedOrderId) {
    return { ok: false, code: "AUTH_ORDER_MISMATCH", message: "주문 정보가 일치하지 않습니다." };
  }

  // amount 는 문자열로 온다. 숫자 이외가 섞이면 Number() 가 조용히 NaN·0 을 만들 수 있어
  // 형식부터 본다 ("1000원", " 1000", "1e3" 같은 값을 통과시키지 않는다)
  if (!/^\d{1,12}$/.test(p.amount ?? "")) {
    return { ok: false, code: "AUTH_AMOUNT_FORMAT", message: "결제 금액이 올바르지 않습니다." };
  }
  const amount = Number(p.amount);
  if (amount !== ctx.expectedAmount) {
    return { ok: false, code: "AUTH_AMOUNT_MISMATCH", message: "결제 금액이 주문과 다릅니다." };
  }

  const expected = authSignature(p.authToken, p.clientId, amount, ctx.secretKey);
  if (!signatureMatches(expected, p.signature)) {
    return { ok: false, code: "AUTH_SIGNATURE", message: "결제 정보 검증에 실패했습니다." };
  }

  return { ok: true, tid: p.tid, amount, authToken: p.authToken };
}

export interface WebhookParams {
  resultCode?: string;
  tid?: string;
  orderId?: string;
  amount?: number | string;
  status?: string;
  ediDate?: string;
  signature?: string;
}

export type WebhookCheck =
  | { ok: true; tid: string; orderId: string; amount: number; status: string }
  | { ok: false; code: string };

/**
 * 웹훅 전문 검사. 매뉴얼: "signature 와 금액을 확인한 뒤 비즈니스 로직을 처리해야 한다".
 *
 * 웹훅은 인터넷 아무나 때릴 수 있는 공개 주소로 들어온다. 서명을 안 보면
 * "이 주문 결제됐다"는 가짜 전문 한 방으로 물건이 나간다.
 */
export function checkWebhook(p: WebhookParams, secretKey: string): WebhookCheck {
  if (!p.tid || !p.orderId || !p.ediDate || !p.signature) {
    return { ok: false, code: "HOOK_MISSING_FIELD" };
  }
  const raw = typeof p.amount === "number" ? String(p.amount) : (p.amount ?? "");
  if (!/^\d{1,12}$/.test(raw)) return { ok: false, code: "HOOK_AMOUNT_FORMAT" };
  const amount = Number(raw);

  const expected = webhookSignature(p.tid, amount, p.ediDate, secretKey);
  if (!signatureMatches(expected, p.signature)) return { ok: false, code: "HOOK_SIGNATURE" };

  return { ok: true, tid: p.tid, orderId: p.orderId, amount, status: p.status ?? "" };
}

/**
 * 나이스페이 주문번호. 상점 거래 고유번호(최대 64byte)이고 **재사용할 수 없다**.
 *
 * 주문 id 를 그대로 쓰지 않는 이유: 결제가 실패한 주문을 손님이 다시 시도하면 같은
 * 주문번호로 재호출하게 되는데 나이스페이가 거부한다. 시도마다 접미사를 붙인다.
 */
export const nicePayOrderId = (orderId: string, attempt: number): string =>
  `luvy-${orderId}-${attempt}`;

/** 상품명에서 나이스페이가 금지한 문자(" 와 |)를 '-' 로 바꾼다 */
export const safeGoodsName = (name: string, max = 40): string =>
  name.replace(/["|]/g, "-").slice(0, max);
