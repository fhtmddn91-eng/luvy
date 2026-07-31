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

/* ── 로고 ────────────────────────────────────────────
 * 업로드한 이미지가 있으면 그것을, 없으면 코드에 있는 기본 LUVY 마크를 쓴다.
 * "로고를 어떻게 바꾸나요"에 대한 답이 배포가 아니라 관리자 화면이 되도록.
 */
const KEY_LOGO = "brand_logo_url";

export const getLogoUrl = cache(async (): Promise<string> => {
  const row = await db.setting.findUnique({ where: { key: KEY_LOGO } });
  const v = row?.value?.trim() ?? "";
  // 업로드 경로만 신뢰한다 (외부 URL 을 넣어 헤더가 남의 서버를 부르게 하지 않는다)
  return v.startsWith("/uploads/") ? v : "";
});

export async function saveLogoUrl(url: string): Promise<void> {
  await db.setting.upsert({
    where: { key: KEY_LOGO },
    create: { key: KEY_LOGO, value: url },
    update: { value: url },
  });
}
