import "server-only";
import { db } from "@/lib/db";
import { saveImageBuffer } from "@/lib/storage";
import { normalizeImageUrl } from "./parse1688";

/**
 * 원격 이미지(alicdn) → 로컬 미러링.
 *
 * 1688 상세 HTML은 봇 차단(X5Sec)이 걸려 서버에서 못 읽지만,
 * 이미지 CDN은 인증 없이 응답하므로 이미지/GIF는 서버에서 직접 받을 수 있다.
 */

const MIRROR_MAX_BYTES = 8 * 1024 * 1024; // 8MB — 상세 이미지·GIF는 원본이 큼
const FETCH_TIMEOUT_MS = 20_000;
/** 한 번에 너무 많이 병렬로 때리면 CDN이 막으므로 소규모로 나눠 처리 */
const CONCURRENCY = 4;

export interface MirroredImage {
  sourceUrl: string;
  /** 로컬 경로 (/uploads/..) */
  url: string;
  bytes: number;
}

export interface MirrorReport {
  images: MirroredImage[];
  /** 실패한 원본 URL과 사유 — 조용히 삼키지 않고 관리자에게 보여준다 */
  failures: { sourceUrl: string; reason: string }[];
}

async function fetchOne(rawUrl: string): Promise<MirroredImage | { error: string }> {
  // 미러링 직전에 한 번 더 화이트리스트를 통과시킨다(SSRF 방어의 마지막 관문)
  const url = normalizeImageUrl(rawUrl);
  if (!url) return { error: "허용되지 않은 이미지 주소" };

  // 같은 원격 이미지를 이미 받아뒀으면 재사용 — 1688 판매자는 배지·배너를
  // 여러 상품에 돌려쓰므로 다운로드·저장이 상품 수만큼 중복되는 걸 막는다.
  // (이미 번역까지 된 파일이면 번역 재사용은 translateAssets 쪽에서 이어진다)
  const cached = await db.storedFile.findFirst({
    where: { sourceUrl: url },
    select: { name: true, bytes: true },
  });
  if (cached) return { sourceUrl: url, url: `/uploads/${cached.name}`, bytes: cached.bytes };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        // CDN이 리퍼러를 보는 경우가 있어 원문 도메인을 넣어준다
        Referer: "https://detail.1688.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };

    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!mime.startsWith("image/")) return { error: `이미지가 아님 (${mime || "unknown"})` };

    const buf = Buffer.from(await res.arrayBuffer());
    const saved = await saveImageBuffer(buf, mime, MIRROR_MAX_BYTES, url);
    if (!saved.ok) return { error: saved.error };

    return { sourceUrl: url, url: saved.url, bytes: buf.byteLength };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: ctrl.signal.aborted ? "시간 초과" : msg };
  } finally {
    clearTimeout(timer);
  }
}

/** 여러 이미지를 소규모 배치로 미러링. 일부 실패해도 나머지는 계속 진행한다. */
export async function mirrorImages(urls: string[]): Promise<MirrorReport> {
  const images: MirroredImage[] = [];
  const failures: { sourceUrl: string; reason: string }[] = [];

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(fetchOne));
    results.forEach((r, idx) => {
      if ("error" in r) failures.push({ sourceUrl: batch[idx], reason: r.error });
      else images.push(r);
    });
  }

  return { images, failures };
}
