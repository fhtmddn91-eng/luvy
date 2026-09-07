/**
 * 나이스페이 결제창 (브라우저 전용).
 *
 * SDK 는 `<script src="https://pay.nicepay.co.kr/v1/js/">` 로 전역 AUTHNICE 를 만든다.
 * requestPay 를 부르면 결제창이 뜨고, 인증이 끝나면 **나이스페이가 브라우저를
 * returnUrl 로 form POST** 시킨다 — 성공 콜백은 JS 로 오지 않는다. 실패·닫기만 fnError 로 온다.
 */
import type { NicePayWindowParams } from "@/lib/actions/order";

declare global {
  interface Window {
    AUTHNICE?: { requestPay(params: Record<string, unknown>): void };
  }
}

const SDK_SRC = "https://pay.nicepay.co.kr/v1/js/";
let loading: Promise<void> | null = null;

export function loadNicePaySdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("browser only"));
  if (window.AUTHNICE) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_SRC;
    s.async = true;
    s.onload = () => (window.AUTHNICE ? resolve() : reject(new Error("결제 모듈을 불러오지 못했습니다.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export async function openNicePayWindow(
  w: NicePayWindowParams,
  onError: (message: string) => void,
): Promise<void> {
  await loadNicePaySdk();
  window.AUTHNICE!.requestPay({
    clientId: w.clientId,
    method: "card",
    orderId: w.orderId,
    amount: w.amount,
    goodsName: w.goodsName,
    returnUrl: w.returnUrl,
    buyerName: w.buyerName,
    buyerTel: w.buyerTel,
    buyerEmail: w.buyerEmail,
    fnError: (result: { errorMsg?: string; errorCode?: string }) => {
      onError(result?.errorMsg || "결제창이 닫혔거나 오류가 났습니다. 다시 시도해주세요.");
    },
  });
}
