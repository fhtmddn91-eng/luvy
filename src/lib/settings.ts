import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { SHIPPING_FEE, FREE_SHIPPING_THRESHOLD, type ShippingPolicy } from "@/lib/pricing";

/**
 * 배송비 정책 — Setting 테이블에서 읽고, 값이 없거나 깨져 있으면
 * 코드 기본값(3,000원 / 10만원 이상 무료)으로 동작한다.
 * 설정이 잘못 저장돼도 결제가 멈추지는 않아야 하기 때문이다.
 */
const KEY_FEE = "shipping_fee";
const KEY_FREE = "free_shipping_threshold";

function toNonNegativeInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export const getShippingPolicy = cache(async (): Promise<ShippingPolicy> => {
  const rows = await db.setting.findMany({ where: { key: { in: [KEY_FEE, KEY_FREE] } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    fee: toNonNegativeInt(map.get(KEY_FEE), SHIPPING_FEE),
    freeThreshold: toNonNegativeInt(map.get(KEY_FREE), FREE_SHIPPING_THRESHOLD),
  };
});

export async function saveShippingPolicy(policy: ShippingPolicy): Promise<void> {
  await db.$transaction([
    db.setting.upsert({
      where: { key: KEY_FEE },
      create: { key: KEY_FEE, value: String(policy.fee) },
      update: { value: String(policy.fee) },
    }),
    db.setting.upsert({
      where: { key: KEY_FREE },
      create: { key: KEY_FREE, value: String(policy.freeThreshold) },
      update: { value: String(policy.freeThreshold) },
    }),
  ]);
}
