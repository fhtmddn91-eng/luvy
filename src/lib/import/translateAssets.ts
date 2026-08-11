import "server-only";
import path from "node:path";
import { db } from "@/lib/db";
import { readPublicUpload, saveImageBuffer } from "@/lib/storage";
import { ocrImage, renderTranslatedImage } from "@/lib/imageTranslate";

/**
 * 수집 직후 상품 이미지 속 중국어를 한국어로 바꾼다.
 *
 * 예전에는 운영자가 어드민에서 이미지를 한 장씩 눌러 번역했다. 상세페이지가
 * 20장 넘는 상품이 흔해서 빠뜨리는 장이 생겼고, 중국어가 남은 채로 노출된
 * 적이 있다. 수집이 끝나면 알아서 돌린다.
 *
 * 실패한 장은 원본 그대로 남긴다 — 한 장 때문에 수집 전체를 망치지 않는다.
 * 운영자는 어드민에서 그 장만 다시 번역하면 된다.
 */

/** CDN·모델 한도를 건드리지 않을 만큼만 동시에 */
const CONCURRENCY = 3;

export interface AssetTranslateReport {
  done: number;
  failed: number;
  skipped: number;
}

/** 이미지 한 장 — OCR → 번역본 렌더 → 파일 교체. 원본은 originalUrl 로 남긴다. */
async function translateOne(asset: {
  id: string;
  url: string;
  originalUrl: string | null;
}): Promise<"done" | "failed" | "skipped"> {
  // 이미 번역된 장은 건너뛴다 (재시도 시 원본을 두 번 덮지 않도록)
  if (asset.originalUrl) return "skipped";

  // 같은 원본 파일을 다른 상품에서 이미 번역했으면 그 결과를 그대로 쓴다 —
  // 1688 판매자가 돌려쓰는 배지·배너는 파일이 공유되므로(미러 캐시) 여기서
  // 걸리고, 모델 호출이 한 번도 안 나간다.
  const sibling = await db.productAsset.findFirst({
    where: { originalUrl: asset.url, NOT: { id: asset.id } },
    select: { url: true, ocrData: true, bytes: true },
  });
  if (sibling) {
    await db.productAsset.update({
      where: { id: asset.id },
      data: {
        url: sibling.url,
        originalUrl: asset.url,
        ocrData: sibling.ocrData,
        bytes: sibling.bytes,
      },
    });
    return "done";
  }

  const file = await readPublicUpload(path.basename(asset.url));
  if (!file) return "failed";

  const boxes = await ocrImage(file.data, file.contentType);
  if (boxes.length === 0) return "skipped"; // 글자가 없는 사진

  const rendered = await renderTranslatedImage(file.data, file.contentType, boxes);
  const saved = await saveImageBuffer(rendered.data, rendered.mime, 15 * 1024 * 1024);
  if (!saved.ok) return "failed";

  await db.productAsset.update({
    where: { id: asset.id },
    data: {
      url: saved.url,
      originalUrl: asset.url,
      ocrData: JSON.stringify(boxes),
      bytes: rendered.data.byteLength,
    },
  });
  return "done";
}

/**
 * 상품의 모든 이미지를 번역한다.
 * 썸네일(Product.image)이 번역 전 파일을 가리키고 있으면 번역본으로 옮긴다 —
 * 안 옮기면 목록에만 중국어 썸네일이 남는다.
 */
export async function translateProductImages(productId: string): Promise<AssetTranslateReport> {
  const report: AssetTranslateReport = { done: 0, failed: 0, skipped: 0 };
  if (!process.env.GEMINI_API_KEY) return report;

  const assets = await db.productAsset.findMany({
    where: { productId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, url: true, originalUrl: true },
  });

  for (let i = 0; i < assets.length; i += CONCURRENCY) {
    const batch = assets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (a) => {
        try {
          return await translateOne(a);
        } catch (e) {
          console.warn(`[import] 이미지 번역 실패 ${a.url}: ${e instanceof Error ? e.message : e}`);
          return "failed" as const;
        }
      }),
    );
    for (const r of results) report[r] += 1;
  }

  if (report.done > 0) {
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { image: true },
    });
    if (product?.image) {
      const moved = await db.productAsset.findFirst({
        where: { productId, originalUrl: product.image },
        select: { url: true },
      });
      // 원본 파일은 지우지 않는다 — originalUrl 이 가리키고 있어 복원에 쓴다
      if (moved) await db.product.update({ where: { id: productId }, data: { image: moved.url } });
    }
  }

  return report;
}
