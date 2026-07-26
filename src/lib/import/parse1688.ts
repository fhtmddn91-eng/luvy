import type { ImportDraft, ImportPayload, ParseResult, RawTier } from "./types";

/**
 * 1688 수집 payload → 정규화된 상품 초안.
 * 외부 의존이 없는 순수 함수이므로 단위 테스트로 검증한다.
 */

/**
 * 이미지 다운로드 대상 호스트 화이트리스트.
 * payload 는 외부(브라우저/붙여넣기)에서 오므로 임의 호스트를 허용하면
 * 서버가 내부망을 긁는 SSRF 통로가 된다. alicdn 계열만 허용한다.
 */
const ALLOWED_IMAGE_HOST = /(^|\.)alicdn\.com$/i;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;

/**
 * 1688 이미지 URL은 뒤에 리사이즈 접미사가 붙는다.
 *   O1CN01.jpg_220x220.jpg   → O1CN01.jpg
 *   O1CN01.gif_.webp         → O1CN01.gif   ← GIF가 정적 webp로 바뀌는 것을 되돌림
 * 접미사를 떼어 원본(애니메이션 유지)을 받는다.
 */
export function toOriginalImageUrl(raw: string): string {
  return raw.replace(/\.(jpe?g|png|gif|webp)_.*$/i, ".$1");
}

/** 프로토콜 보정 + 원본화 + 호스트 검증. 통과하지 못하면 null. */
export function normalizeImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith("//")) s = "https:" + s;
  if (s.startsWith("http://")) s = "https://" + s.slice("http://".length);
  if (!s.startsWith("https://")) return null;

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!ALLOWED_IMAGE_HOST.test(u.hostname)) return null;

  const original = toOriginalImageUrl(u.origin + u.pathname);
  if (!IMAGE_EXT.test(original)) return null;
  return original;
}

function normalizeImageList(input: unknown, limit: number): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const url = normalizeImageUrl(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

/** 상세 URL 또는 문자열에서 1688 offerId(숫자) 추출 */
export function extractOfferId(url: string): string | null {
  const m = url.match(/offer\/(\d{6,})/) ?? url.match(/(?:^|[?&])offerId=(\d{6,})/);
  return m ? m[1] : null;
}

function normalizeTiers(input: unknown): RawTier[] {
  if (!Array.isArray(input)) return [];
  const rows: RawTier[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const minQty = Math.floor(Number(r.minQty ?? r.begin ?? r.from));
    const price = Number(r.price ?? r.unitPrice ?? r.value);
    if (!Number.isFinite(minQty) || !Number.isFinite(price)) continue;
    if (minQty < 1 || price <= 0) continue;
    rows.push({ minQty, price });
  }
  // 수량 오름차순 + 같은 수량 중복 제거
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

/** 붙여넣은 HTML에서 alicdn 이미지 URL만 긁어내는 최소 폴백 */
function imagesFromHtml(html: string): string[] {
  const found = html.match(/(?:https?:)?\/\/[a-z0-9.-]*alicdn\.com\/[^\s"'<>\\)]+/gi) ?? [];
  return normalizeImageList(found, 80);
}

function titleFromHtml(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return og[1].trim();
  const t = html.match(/<title>([^<]+)<\/title>/i);
  return t ? t[1].trim() : "";
}

export function parse1688(payload: ImportPayload): ParseResult {
  const ex = (payload.extracted ?? {}) as Record<string, unknown>;

  const url = String(payload.url ?? ex.url ?? "").trim();
  const sourceId = String(ex.offerId ?? "").trim() || (url ? extractOfferId(url) : null) || "";
  if (!sourceId) {
    return { ok: false, error: "1688 상품 번호(offerId)를 찾을 수 없습니다. 상품 상세페이지 URL인지 확인해주세요." };
  }

  const hasExtracted = payload.extracted != null && typeof payload.extracted === "object";

  const rawTitle = String(ex.title ?? "").trim() || (payload.html ? titleFromHtml(payload.html) : "");

  let mainImages = normalizeImageList(ex.mainImages, 12);
  let detailImages = normalizeImageList(ex.detailImages, 60);
  const optionImages = normalizeImageList(ex.optionImages, 40);

  // 구조화 데이터가 비어 있으면 HTML에서 이미지만이라도 회수
  if (!hasExtracted || (mainImages.length === 0 && detailImages.length === 0)) {
    if (payload.html) {
      const all = imagesFromHtml(payload.html);
      if (mainImages.length === 0) mainImages = all.slice(0, 12);
      if (detailImages.length === 0) detailImages = all.slice(12);
    }
  }

  if (mainImages.length === 0 && detailImages.length === 0) {
    return { ok: false, error: "이미지를 찾지 못했습니다. 상품 상세페이지가 완전히 로딩된 뒤 다시 시도해주세요." };
  }

  const tiers = normalizeTiers(ex.tiers);
  const moqRaw = Math.floor(Number(ex.moq));
  const moq =
    Number.isFinite(moqRaw) && moqRaw >= 1 ? moqRaw : tiers.length > 0 ? tiers[0].minQty : 1;

  return {
    ok: true,
    draft: {
      source: "1688",
      sourceId,
      sourceUrl: url || `https://detail.1688.com/offer/${sourceId}.html`,
      rawTitle: rawTitle.slice(0, 300),
      rawAttributes: normalizeAttributes(ex.attributes),
      mainImages,
      detailImages,
      optionImages,
      tiers,
      moq,
    },
  };
}
