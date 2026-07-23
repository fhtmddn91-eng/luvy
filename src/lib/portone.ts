import "server-only";
import { PaymentClient } from "@portone/server-sdk";

/** 결제창 호출에 필요한 공개 값 (클라이언트로 전달 가능). */
export const PORTONE_STORE_ID = process.env.PORTONE_STORE_ID ?? "";
export const PORTONE_CHANNEL_KEY_KCP = process.env.PORTONE_CHANNEL_KEY_KCP ?? "";

/** storeId/channelKey/secret이 모두 설정되어야 실제 결제 모드로 동작. */
export function isPortOneConfigured(): boolean {
  return Boolean(
    PORTONE_STORE_ID &&
      PORTONE_CHANNEL_KEY_KCP &&
      process.env.PORTONE_API_SECRET,
  );
}

function paymentClient() {
  return PaymentClient({ secret: process.env.PORTONE_API_SECRET ?? "" });
}

/** 포트원 결제 단건 조회. */
export async function fetchPortOnePayment(paymentId: string) {
  return paymentClient().getPayment({ paymentId });
}

/** 포트원 결제 취소. */
export async function cancelPortOnePayment(paymentId: string, reason: string) {
  return paymentClient().cancelPayment({ paymentId, reason });
}
