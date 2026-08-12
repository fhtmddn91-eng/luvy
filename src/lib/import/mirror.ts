import "server-only";
import { db } from "@/lib/db";
import { saveImageBuffer } from "@/lib/storage";
import { sniffImage } from "@/lib/imageSniff";
import { normalizeImageUrlFor } from "./imageUrl";
import { normalizeImageUrl } from "./parse1688";

/**
 * 원격 이미지 → 로컬 미러링.
 *
 * 1688 상세 HTML은 봇 차단(X5Sec)이, 국내 도매처는 로그인 벽이 걸려 서버에서
 * 페이지를 못 읽지만, 이미지는 인증 없이 응답하므로 서버에서 직접 받을 수 있다.
 */

/**
 * 도매처별로 달라지는 것 — 허용 이미지 호스트와 리퍼러.
 *
 * 생략하면 1688(alicdn) 기준으로 동작한다. 기본값을 1688 로 둔 이유는
 * 이 함수의 호출부가 원래 1688 전용이었기 때문 — 국내 도매처를 붙이면서
 * 기본 동작이 바뀌면 기존 경로가 조용히 달라진다.
 */
export interface MirrorOptions {
  /** SourceSite.imageHost — SSRF 화이트리스트 */
  imageHost?: RegExp;
  /** 이미지 서버가 리퍼러를 보는 경우가 있어 원문 도메인을 넣어준다 */
  referer?: string;
}

const MIRROR_MAX_BYTES = 8 * 1024 * 1024; // 8MB — 상세 이미지·GIF는 원본이 큼

/** 매직 바이트 판별 결과 → 저장용 MIME. pdf 는 이미지가 아니므로 제외 */
const MIME_BY_KIND: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};
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

async function fetchOne(
  rawUrl: string,
  opts: MirrorOptions,
): Promise<MirroredImage | { error: string }> {
  // 미러링 직전에 한 번 더 화이트리스트를 통과시킨다(SSRF 방어의 마지막 관문)
  const url = opts.imageHost
    ? normalizeImageUrlFor(rawUrl, opts.imageHost)
    : normalizeImageUrl(rawUrl);
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
        Referer: opts.referer ?? "https://detail.1688.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };

    // 형식 판정은 헤더가 아니라 **내용(매직 바이트)** 으로 한다.
    // 레드그룹 이미지 서버(speedgabia)는 멀쩡한 GIF 를 Content-Type: text/plain
    // 으로 보낸다(실측 goods_m136_1858_L.img) — 헤더만 믿으면 전량 실패한다.
    // 반대로 헤더가 image/* 라도 내용이 아니면 saveImageBuffer 가 거른다.
    const buf = Buffer.from(await res.arrayBuffer());
    const kind = sniffImage(buf);
    const mime = kind ? MIME_BY_KIND[kind] : null;
    if (!mime) {
      const header = (res.headers.get("content-type") ?? "unknown").split(";")[0].trim();
      return { error: `이미지가 아님 (${header})` };
    }

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
export async function mirrorImages(
  urls: string[],
  opts: MirrorOptions = {},
): Promise<MirrorReport> {
  const images: MirroredImage[] = [];
  const failures: { sourceUrl: string; reason: string }[] = [];

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((u) => fetchOne(u, opts)));
    results.forEach((r, idx) => {
      if ("error" in r) failures.push({ sourceUrl: batch[idx], reason: r.error });
      else images.push(r);
    });
  }

  return { images, failures };
}
