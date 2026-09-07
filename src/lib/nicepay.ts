import "server-only";
import {
  approveSignData,
  cancelSignData,
  netCancelSignData,
  ediDateNow,
} from "@/lib/nicepaySign";

/**
 * 나이스페이 서버 API. 돈이 실제로 움직이는 유일한 파일이다.
 *
 * 원칙 셋:
 *  1. **자동 재시도 금지.** 승인은 멱등이 아니다 — 타임아웃 났다고 다시 부르면
 *     두 번 승인될 수 있다. 응답을 못 받으면 재시도가 아니라 **망취소**다.
 *  2. **시크릿 키는 절대 로그·응답에 싣지 않는다.** Authorization 헤더를 만드는
 *     자리에서만 읽고 밖으로 내보내지 않는다.
 *  3. **모르면 실패로 친다.** 응답을 해석할 수 없으면 성공으로 넘기지 않는다.
 */

const API_BASE = process.env.NICEPAY_API_BASE ?? "https://api.nicepay.co.kr";

/** 결제창 호출용 공개 키 — 브라우저로 내려보내도 되는 값 */
export const NICEPAY_CLIENT_KEY = process.env.NICEPAY_CLIENT_KEY ?? "";

const secretKey = (): string => process.env.NICEPAY_SECRET_KEY ?? "";

/** 두 키가 모두 있어야 결제 모드로 동작한다 */
export function isNicePayConfigured(): boolean {
  return Boolean(NICEPAY_CLIENT_KEY && secretKey());
}

/** 서명 계산에 쓰려고 라우트에서 꺼내 쓴다 — 값 자체는 밖으로 나가지 않는다 */
export const nicePaySecret = secretKey;

/**
 * 승인·취소 응답의 공통 모양. resultCode "0000" 만 성공이다.
 * 나이스페이가 필드를 더 보내도 깨지지 않도록 나머지는 raw 로 보관한다.
 */
export interface NicePayResult {
  resultCode?: string;
  resultMsg?: string;
  tid?: string;
  orderId?: string;
  amount?: number;
  balanceAmt?: number;
  status?: string;
  paidAt?: string;
  cancelledTid?: string;
  payMethod?: string;
  card?: { cardName?: string; cardNum?: string } | null;
}

export type NicePayCall =
  | { ok: true; body: NicePayResult; raw: string }
  /**
   * kind 가 중요하다:
   *  · "declined" — 나이스페이가 명확히 거절했다. 돈은 안 나갔다.
   *  · "unknown"  — 응답을 못 받았다(타임아웃·네트워크). **승인됐을 수도 있다** → 망취소 대상.
   */
  | { ok: false; kind: "declined" | "unknown"; code: string; message: string; raw?: string };

const TIMEOUT_MS = 20_000;

function authHeader(): string {
  return `Basic ${Buffer.from(`${NICEPAY_CLIENT_KEY}:${secretKey()}`).toString("base64")}`;
}

async function call(path: string, body: unknown, method: "POST" | "GET" = "POST"): Promise<NicePayCall> {
  let res: Response;
  let raw: string;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json;charset=utf-8",
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    raw = await res.text();
  } catch (e) {
    // 여기가 제일 위험한 자리다 — 요청은 갔는데 답을 못 받았을 수 있다
    return {
      ok: false,
      kind: "unknown",
      code: "NETWORK",
      message: e instanceof Error ? e.message.slice(0, 200) : "network error",
    };
  }

  let parsed: NicePayResult;
  try {
    parsed = JSON.parse(raw) as NicePayResult;
  } catch {
    // 5xx HTML 에러 페이지 등 — 승인 여부를 알 수 없다
    return { ok: false, kind: res.ok ? "unknown" : "declined", code: `HTTP_${res.status}`, message: "응답을 해석할 수 없습니다.", raw: raw.slice(0, 500) };
  }

  if (parsed.resultCode === "0000") return { ok: true, body: parsed, raw };

  return {
    ok: false,
    kind: "declined",
    code: parsed.resultCode ?? `HTTP_${res.status}`,
    message: parsed.resultMsg?.slice(0, 200) ?? "결제에 실패했습니다.",
    raw,
  };
}

/**
 * 승인. 이 호출이 성공하면 **손님 카드에서 돈이 빠진다**.
 * unknown 으로 끝나면 반드시 netCancel 을 부를 것.
 */
export function approvePayment(tid: string, amount: number): Promise<NicePayCall> {
  const ediDate = ediDateNow();
  return call(`/v1/payments/${encodeURIComponent(tid)}`, {
    amount,
    ediDate,
    signData: approveSignData(tid, amount, ediDate, secretKey()),
    returnCharSet: "utf-8",
  });
}

/**
 * 승인금액 검증. 매뉴얼: resultCode 0000 이면서 isValid=false 면 **반드시 취소**해야 한다.
 * 승인 응답의 금액만 믿지 않고 한 번 더 대조하는 자리다.
 */
export async function checkAmount(tid: string, amount: number): Promise<{ valid: boolean; known: boolean }> {
  const r = await call(`/v1/check-amount/${encodeURIComponent(tid)}`, { amount });
  if (!r.ok) return { valid: false, known: false }; // 확인 못 했으면 유효하다고 하지 않는다
  const isValid = (r.body as NicePayResult & { isValid?: boolean }).isValid;
  return { valid: isValid === true, known: typeof isValid === "boolean" };
}

/** 취소·환불. cancelAmt 를 주면 부분취소, 없으면 전액취소 */
export function cancelPayment(
  tid: string,
  input: { reason: string; orderId: string; cancelAmt?: number },
): Promise<NicePayCall> {
  const ediDate = ediDateNow();
  return call(`/v1/payments/${encodeURIComponent(tid)}/cancel`, {
    reason: input.reason.slice(0, 100),
    orderId: input.orderId,
    ...(input.cancelAmt !== undefined ? { cancelAmt: input.cancelAmt } : {}),
    ediDate,
    signData: cancelSignData(tid, ediDate, secretKey()),
    returnCharSet: "utf-8",
  });
}

/**
 * 망취소 — 승인 응답을 못 받았을 때만 쓴다.
 * **유효기간 1시간**이라 승인 직후 즉시 불러야 한다. 늦으면 실패하고, 그때는
 * 거래조회로 확인한 뒤 일반 취소로 처리해야 한다.
 */
export function netCancel(npOrderId: string): Promise<NicePayCall> {
  const ediDate = ediDateNow();
  return call(`/v1/payments/netcancel`, {
    orderId: npOrderId,
    ediDate,
    signData: netCancelSignData(npOrderId, ediDate, secretKey()),
    returnCharSet: "utf-8",
  });
}

/** 거래조회 — 상점 주문번호 기준. 승인 응답 유실 대사에 쓴다 */
export function findByOrderId(npOrderId: string): Promise<NicePayCall> {
  return call(`/v1/payments/find/${encodeURIComponent(npOrderId)}`, undefined, "GET");
}

/** 거래조회 — tid 기준 */
export function findByTid(tid: string): Promise<NicePayCall> {
  return call(`/v1/payments/${encodeURIComponent(tid)}`, undefined, "GET");
}
