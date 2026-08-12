import { normalizeImageUrlFor } from "./imageUrl";
import type { SourceSite } from "./sources";
import type { ImportDraft, ImportPayload, ParseResult, RawTier } from "./types";

/**
 * 국내 도매처 수집 payload → 정규화된 상품 초안.
 *
 * 1688 과 갈라놓은 이유:
 *   - 상품 식별자가 offerId(6자리 이상 숫자)가 아니라 쇼핑몰마다 다르다.
 *   - 이미지 호스트가 사이트별로 다르다(SourceSite.imageHost).
 *   - 가격이 수량 구간이 아니라 단일 매입가 하나다.
 *   - 원문이 이미 한국어라 번역 파이프라인을 타지 않는다.
 * parse1688 을 확장해 겸용으로 만들면 1688 쪽 규칙(리사이즈 접미사 제거,
 * 로고 -tps- 컷)이 국내 사이트에서 오작동한다 — 파일을 나눠 각자 단순하게 둔다.
 *
 * 외부 의존이 없는 순수 함수이므로 단위 테스트로 검증한다.
 */

/** 상품번호로 인정할 형태 — 숫자, 또는 영문·숫자·하이픈 조합의 짧은 코드 */
const PRODUCT_NO = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * sourceId 는 **도매처를 앞에 붙여 만든다** (`doradora:1234`).
 *
 * Product.sourceId 는 전역 유니크다. 쇼핑몰마다 1번부터 번호를 매기므로
 * 번호만 쓰면 도라도라 1234 번을 수집한 뒤 핑크박스 1234 번이
 * "이미 수집된 상품입니다"로 거부된다. 접두사가 이를 막는다.
 * (1688 은 offerId 가 전역 고유라 접두사 없이 그대로 쓴다 — 기존 데이터 보존)
 */
export function domesticSourceId(siteId: string, productNo: string): string {
  return `${siteId}:${productNo}`;
}

function normalizeImageList(input: unknown, site: SourceSite, limit: number): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const url = normalizeImageUrlFor(item, site.imageHost);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 가격. 국내 도매처는 수량 구간가가 아니라 매입가 하나인 경우가 대부분이라
 * tiers 가 없으면 price 한 값을 minQty 1 구간으로 환산한다.
 * (구간가를 주는 사이트가 나오면 tiers 를 그대로 쓴다)
 */
export function normalizeDomesticTiers(input: unknown, single: unknown): RawTier[] {
  const rows: RawTier[] = [];
  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const minQty = Math.floor(Number(r.minQty ?? r.begin ?? 1));
      const price = Number(r.price ?? r.unitPrice);
      if (!Number.isFinite(minQty) || !Number.isFinite(price)) continue;
      if (minQty < 1 || price <= 0) continue;
      rows.push({ minQty, price });
    }
  }
  if (rows.length === 0) {
    const p = Number(single);
    if (Number.isFinite(p) && p > 0) rows.push({ minQty: 1, price: p });
  }
  rows.sort((a, b) => a.minQty - b.minQty);
  return rows.filter((r, i) => i === 0 || r.minQty !== rows[i - 1].minQty);
}

function normalizeAttributes(input: unknown, limit = 40): { label: string; value: string }[] {
  if (!Array.isArray(input)) return [];
  const out: { label: string; value: string }[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const label = String(r.label ?? r.name ?? r.key ?? "").trim();
    const value = String(r.value ?? r.val ?? "").trim();
    if (!label || !value) continue;
    out.push({ label: label.slice(0, 60), value: value.slice(0, 200) });
    if (out.length >= limit) break;
  }
  return out;
}

export function parseDomestic(payload: ImportPayload, site: SourceSite): ParseResult {
  const ex = (payload.extracted ?? {}) as Record<string, unknown>;
  const url = String(payload.url ?? ex.url ?? "").trim();

  const productNo = String(ex.productNo ?? ex.sourceId ?? "").trim();
  if (!productNo || !PRODUCT_NO.test(productNo)) {
    return {
      ok: false,
      error: `${site.label} 상품번호를 찾지 못했습니다. 상품 상세페이지에서 북마클릿을 실행했는지 확인해주세요.`,
    };
  }

  const rawTitle = String(ex.title ?? "").trim();

  const mainImages = normalizeImageList(ex.mainImages, site, 12);
  const detailImages = normalizeImageList(ex.detailImages, site, 60).filter(
    (u) => !mainImages.includes(u),
  );
  const optionImages = normalizeImageList(ex.optionImages, site, 40).filter(
    (u) => !mainImages.includes(u) && !detailImages.includes(u),
  );

  if (mainImages.length === 0 && detailImages.length === 0) {
    return {
      ok: false,
      error:
        "이미지를 찾지 못했습니다. 상세 이미지가 모두 뜨도록 페이지를 끝까지 스크롤한 뒤 다시 실행해주세요.",
    };
  }

  const tiers = normalizeDomesticTiers(ex.tiers, ex.price);

  return {
    ok: true,
    draft: {
      source: site.id,
      sourceId: domesticSourceId(site.id, productNo),
      sourceUrl: url.slice(0, 500) || `https://${site.id}`,
      rawTitle: rawTitle.slice(0, 300),
      rawAttributes: normalizeAttributes(ex.attributes),
      mainImages,
      detailImages,
      optionImages,
      tiers,
      // 국내 도매처는 낱개 매입이 기본이라 최소수량 개념이 없다
      moq: 1,
    },
  };
}
