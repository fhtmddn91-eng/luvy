"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  saveImageUpload,
  saveImageBuffer,
  deleteImageUpload,
  readPublicUpload,
} from "@/lib/storage";
import { ocrImage, renderTranslatedImage, parseOcrBoxes, type OcrBox } from "@/lib/imageTranslate";
import { audit } from "@/lib/audit";

export type AssetFormState = { error?: string; ok?: number };

function revalidateProduct(productId: string): void {
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath(`/products/${productId}`);
}

/**
 * 상세페이지 이미지/GIF 업로드 (여러 장 한 번에).
 * GIF 는 kind=GIF, 나머지는 kind=DETAIL 로 저장되어 상품 상세 하단에 순서대로 렌더된다.
 */
export async function addProductAssets(
  productId: string,
  _prev: AssetFormState,
  formData: FormData,
): Promise<AssetFormState> {
  await requireAdmin();

  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) return { error: "상품을 찾을 수 없습니다." };

  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "업로드할 파일을 선택해주세요." };
  if (files.length > 30) return { error: "한 번에 30장까지 올릴 수 있습니다." };

  const last = await db.productAsset.aggregate({
    where: { productId },
    _max: { sortOrder: true },
  });
  let order = (last._max.sortOrder ?? -1) + 1;

  let saved = 0;
  for (const file of files) {
    const result = await saveImageUpload(file);
    if (!result.ok) {
      // 일부만 실패해도 이미 저장된 것은 남긴다 — 몇 번째 파일이 왜 안 됐는지 알려준다
      return {
        error: `'${file.name}' 업로드 실패: ${result.error}${saved > 0 ? ` (앞의 ${saved}장은 저장됨)` : ""}`,
        ok: saved || undefined,
      };
    }
    await db.productAsset.create({
      data: {
        productId,
        kind: file.type === "image/gif" ? "GIF" : "DETAIL",
        url: result.url,
        bytes: file.size,
        sortOrder: order++,
      },
    });
    saved++;
  }

  await audit({
    action: "ASSET_ADD",
    target: "product",
    targetId: productId,
    summary: `상세 이미지 ${saved}장 추가`,
  });
  revalidateProduct(productId);
  return { ok: saved };
}

export async function deleteProductAsset(assetId: string): Promise<void> {
  await requireAdmin();
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return;
  await db.productAsset.delete({ where: { id: assetId } });
  // /uploads/ 파일도 정리 (1688 수집분 등 다른 경로면 deleteImageUpload 가 무시)
  await deleteImageUpload(asset.url);
  // 번역된 이미지면 보존해 둔 원본도 함께 정리
  if (asset.originalUrl && asset.originalUrl !== asset.url) {
    await deleteImageUpload(asset.originalUrl);
  }
  await audit({
    action: "ASSET_DELETE",
    target: "product",
    targetId: asset.productId,
    summary: `상세 이미지 1장 삭제 (${asset.kind})`,
    meta: { url: asset.url },
  });
  revalidateProduct(asset.productId);
}

/* ── 이미지 속 중국어 번역 ──────────────────────────────────
 * 원본은 originalUrl 로 보존하고 url 만 번역본으로 바꾼다.
 * ocrData(문구 JSON)를 저장해 두므로, 어드민이 문구를 고치면
 * 원본에서 다시 렌더할 수 있고 언제든 원본으로 복원할 수 있다.
 */

export type TranslateState = { error?: string; ok?: boolean };

/** 번역/재렌더 공통 마무리 — 새 파일 저장, 옛 번역본 정리, DB 갱신 */
async function swapTranslatedFile(
  asset: { id: string; url: string; productId: string },
  sourceUrl: string,
  rendered: { data: Buffer; mime: string },
  boxes: OcrBox[],
): Promise<TranslateState> {
  const saved = await saveImageBuffer(rendered.data, rendered.mime, 15 * 1024 * 1024);
  if (!saved.ok) return { error: `번역본 저장 실패: ${saved.error}` };

  // 이전 번역본 파일 정리 (원본은 남긴다)
  if (asset.url !== sourceUrl) await deleteImageUpload(asset.url);

  await db.productAsset.update({
    where: { id: asset.id },
    data: {
      url: saved.url,
      originalUrl: sourceUrl,
      ocrData: JSON.stringify(boxes),
      bytes: rendered.data.byteLength,
    },
  });
  // 대표 썸네일이 이 이미지를 쓰고 있으면 함께 교체
  await db.product.updateMany({
    where: { id: asset.productId, image: { in: [sourceUrl, asset.url] } },
    data: { image: saved.url },
  });
  return { ok: true };
}

/** 이미지 속 중국어를 찾아 한국어로 덮어쓴 번역본을 만든다 */
export async function translateProductAsset(assetId: string): Promise<TranslateState> {
  await requireAdmin();
  if (!process.env.GEMINI_API_KEY) return { error: "GEMINI_API_KEY 미설정 — 번역을 쓸 수 없습니다." };

  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return { error: "이미지를 찾을 수 없습니다." };

  const sourceUrl = asset.originalUrl ?? asset.url;
  const file = await readPublicUpload(path.basename(sourceUrl));
  if (!file) return { error: "원본 파일을 읽을 수 없습니다." };

  try {
    const boxes = await ocrImage(file.data, file.contentType);
    if (boxes.length === 0) return { error: "번역할 중국어 텍스트를 찾지 못했습니다." };

    const rendered = await renderTranslatedImage(file.data, file.contentType, boxes);
    const result = await swapTranslatedFile(asset, sourceUrl, rendered, boxes);
    if (result.error) return result;

    await audit({
      action: "ASSET_TRANSLATE",
      target: "product",
      targetId: asset.productId,
      summary: `이미지 번역 (${asset.kind}, 문구 ${boxes.length}개)`,
      meta: { assetId, url: sourceUrl },
    });
    revalidateProduct(asset.productId);
    return { ok: true };
  } catch (e) {
    return { error: `번역 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 어드민이 고친 문구로 원본에서 다시 렌더한다. 빈 문구 = 그 항목은 번역 안 함 */
export async function updateAssetTranslation(
  assetId: string,
  _prev: TranslateState,
  formData: FormData,
): Promise<TranslateState> {
  await requireAdmin();

  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset?.originalUrl || !asset.ocrData) return { error: "번역된 이미지가 아닙니다." };

  const boxes = parseOcrBoxes(JSON.parse(asset.ocrData));
  // 폼에서 항목별 문구·처리방식·위치·크기·굵기를 받아 덮어쓴다.
  // (검증은 renderTranslatedImage 앞에서 parseOcrBoxes 가 다시 한다)
  const numOr = (v: FormDataEntryValue | null, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const edited: OcrBox[] = boxes.map((b, i) => {
    const ko = formData.get(`ko-${i}`);
    const mode = String(formData.get(`mode-${i}`) ?? "translate");
    const weight = String(formData.get(`weight-${i}`) ?? "");
    return {
      ...b,
      ko: typeof ko === "string" ? ko.trim().slice(0, 200) : b.ko,
      mode: mode === "keep" || mode === "erase" ? mode : "translate",
      dx: numOr(formData.get(`dx-${i}`), 0),
      dy: numOr(formData.get(`dy-${i}`), 0),
      scale: numOr(formData.get(`scale-${i}`), 1),
      ...(weight ? { weight: weight as OcrBox["weight"] } : {}),
    };
  });
  const willRender = edited.some(
    (b) => (b.mode === "translate" && b.ko) || b.mode === "erase",
  );
  if (!willRender) return { error: "번역하거나 지울 문구가 없습니다. 원본 복원을 쓰세요." };

  const file = await readPublicUpload(path.basename(asset.originalUrl));
  if (!file) return { error: "원본 파일을 읽을 수 없습니다." };

  try {
    const rendered = await renderTranslatedImage(file.data, file.contentType, edited);
    const result = await swapTranslatedFile(asset, asset.originalUrl, rendered, edited);
    if (result.error) return result;

    await audit({
      action: "ASSET_TRANSLATE",
      target: "product",
      targetId: asset.productId,
      summary: `이미지 번역 문구 수정 (${asset.kind})`,
      meta: { assetId },
    });
    revalidateProduct(asset.productId);
    return { ok: true };
  } catch (e) {
    return { error: `재렌더 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 번역을 버리고 원본 이미지로 되돌린다 */
export async function revertAssetTranslation(assetId: string): Promise<void> {
  await requireAdmin();
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset?.originalUrl) return;

  const original = await readPublicUpload(path.basename(asset.originalUrl));
  if (asset.url !== asset.originalUrl) await deleteImageUpload(asset.url);

  await db.productAsset.update({
    where: { id: assetId },
    data: {
      url: asset.originalUrl,
      originalUrl: null,
      ocrData: null,
      bytes: original?.data.byteLength ?? asset.bytes,
    },
  });
  await db.product.updateMany({
    where: { id: asset.productId, image: asset.url },
    data: { image: asset.originalUrl },
  });
  await audit({
    action: "ASSET_TRANSLATE",
    target: "product",
    targetId: asset.productId,
    summary: `이미지 번역 원본 복원 (${asset.kind})`,
    meta: { assetId },
  });
  revalidateProduct(asset.productId);
}

/**
 * 드래그로 옮긴 순서를 통째로 저장한다.
 *
 * 화살표 한 칸 이동은 20~30장을 옮길 때 클릭이 너무 많다. 클라이언트가 정렬한
 * id 순서를 그대로 받아 0부터 다시 매긴다 — 같은 상품의 자산만 반영하므로
 * 남의 상품 자산 id 를 섞어 보내도 무시된다.
 */
export async function reorderProductAssets(
  productId: string,
  orderedIds: string[],
): Promise<{ error?: string; ok?: boolean }> {
  await requireAdmin();

  const assets = await db.productAsset.findMany({
    where: { productId },
    select: { id: true },
  });
  const own = new Set(assets.map((a) => a.id));
  const next = orderedIds.filter((id) => own.has(id));
  if (next.length !== assets.length) {
    return { error: "이미지 목록이 바뀌었습니다. 새로고침 후 다시 시도해주세요." };
  }

  await db.$transaction(
    next.map((id, i) =>
      db.productAsset.update({ where: { id }, data: { sortOrder: i } }),
    ),
  );
  revalidateProduct(productId);
  return { ok: true };
}

/** 상세 이미지 순서 한 칸 이동 — 이웃과 sortOrder 를 맞바꾼다 */
export async function moveProductAsset(assetId: string, dir: "up" | "down"): Promise<void> {
  await requireAdmin();
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return;

  const siblings = await db.productAsset.findMany({
    where: { productId: asset.productId },
    orderBy: { sortOrder: "asc" },
  });
  const i = siblings.findIndex((a) => a.id === assetId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= siblings.length) return;

  await db.$transaction([
    db.productAsset.update({ where: { id: siblings[i].id }, data: { sortOrder: siblings[j].sortOrder } }),
    db.productAsset.update({ where: { id: siblings[j].id }, data: { sortOrder: siblings[i].sortOrder } }),
  ]);
  revalidateProduct(asset.productId);
}
