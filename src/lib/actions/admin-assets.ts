"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  saveImageUpload,
  saveImageBuffer,
  deleteImageUpload,
  deleteUploadIfUnused,
  readPublicUpload,
} from "@/lib/storage";
import {
  renderTranslatedImage,
  parseOcrBoxes,
  type OcrBox,
} from "@/lib/imageTranslate";
import { runAssetTranslation, promoteIfReady } from "@/lib/import/translateAssets";
import { sha256Of, saveTranslationCache, markCacheStale } from "@/lib/translateCache";
import { TRANSLATE_STATUS } from "@/lib/productPublishGate";
import { assetKindFor, nextThumbnail, type AssetTarget } from "@/lib/productAssets";
import { audit } from "@/lib/audit";

export type AssetFormState = { error?: string; ok?: number };

function revalidateProduct(productId: string): void {
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath(`/products/${productId}`);
}

/**
 * 썸네일(Product.image)을 자산에 맞춘다.
 *
 * 썸네일을 자산과 따로 복사해 두니 번역·삭제·순서변경 때마다 어긋났다.
 * 실제로 썸네일만 중국어로 남거나(번역 대상에서 빠짐), 자산을 지웠을 때
 * 파일이 사라져 깨진 썸네일이 생겼다(운영 데이터에서 2건 확인).
 * 규칙은 nextThumbnail 에 있다 — 대표이미지가 없는 상품의 썸네일은 건드리지 않는다.
 *
 * @param replacing 이번 작업으로 없어지는 파일 URL
 */
async function syncProductThumbnail(
  productId: string,
  replacing?: string,
): Promise<void> {
  const [product, assets] = await Promise.all([
    db.product.findUnique({ where: { id: productId }, select: { image: true } }),
    db.productAsset.findMany({
      where: { productId },
      orderBy: { sortOrder: "asc" },
      select: { url: true, kind: true },
    }),
  ]);
  if (!product) return;
  const next = nextThumbnail(product.image, assets, replacing);
  if (next === null) return;
  await db.product.update({ where: { id: productId }, data: { image: next } });
}

/** 업로드 폼의 "어느 자리에 올릴지" 값 */
function targetOf(formData: FormData): AssetTarget {
  return formData.get("target") === "MAIN" ? "MAIN" : "DETAIL";
}

/**
 * 상품 이미지 업로드 (여러 장 한 번에).
 *
 * 대표이미지(kind=MAIN)는 상세 상단 갤러리와 썸네일에, 상세페이지 이미지
 * (kind=DETAIL·GIF)는 상세 하단에 순서대로 렌더된다.
 * 대표이미지는 기존 대표이미지 **뒤에** 끼워 넣어 대표 → 상세 순서를 지킨다.
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

  const target = targetOf(formData);
  let order: number;
  if (target === "MAIN") {
    const lastMain = await db.productAsset.findFirst({
      where: { productId, kind: "MAIN" },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    order = (lastMain?.sortOrder ?? -1) + 1;
    // 뒤에 있는 상세·옵션 이미지를 밀어 자리를 만든다
    await db.productAsset.updateMany({
      where: { productId, sortOrder: { gte: order } },
      data: { sortOrder: { increment: files.length } },
    });
  } else {
    const last = await db.productAsset.aggregate({
      where: { productId },
      _max: { sortOrder: true },
    });
    order = (last._max.sortOrder ?? -1) + 1;
  }

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
        kind: assetKindFor(target, { mime: file.type, url: result.url }),
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
    summary: `${target === "MAIN" ? "대표" : "상세"} 이미지 ${saved}장 추가`,
  });
  await syncProductThumbnail(productId);
  revalidateProduct(productId);
  return { ok: saved };
}

/**
 * 이미 올린 이미지의 자리(대표 ↔ 상세)를 바꾼다.
 *
 * 예전에는 업로드가 무조건 상세로만 저장돼서, 대표이미지로 쓰려던 것도
 * 상품 상세의 갤러리·다운로드 목록에 안 잡혔다. 다시 올리지 않고 고칠 수 있어야 한다.
 */
export async function setAssetTarget(assetId: string, target: AssetTarget): Promise<void> {
  await requireAdmin();
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return;

  const kind = assetKindFor(target, { url: asset.url });
  if (kind === asset.kind) return;

  await db.productAsset.update({ where: { id: assetId }, data: { kind } });
  await audit({
    action: "ASSET_KIND",
    target: "product",
    targetId: asset.productId,
    summary: `이미지 자리 변경 (${asset.kind} → ${kind})`,
    meta: { assetId },
  });
  await syncProductThumbnail(asset.productId);
  revalidateProduct(asset.productId);
}

export async function deleteProductAsset(assetId: string): Promise<void> {
  await requireAdmin();
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return;
  await db.productAsset.delete({ where: { id: assetId } });
  // /uploads/ 파일도 정리 — 다른 자산이 같은 파일을 쓰고 있으면 남긴다
  await deleteUploadIfUnused(asset.url);
  // 번역된 이미지면 보존해 둔 원본도 함께 정리
  if (asset.originalUrl && asset.originalUrl !== asset.url) {
    await deleteUploadIfUnused(asset.originalUrl);
  }
  await audit({
    action: "ASSET_DELETE",
    target: "product",
    targetId: asset.productId,
    summary: `상품 이미지 1장 삭제 (${asset.kind})`,
    meta: { url: asset.url },
  });
  // 지운 게 썸네일이었다면 남은 이미지로 다시 맞춘다 (깨진 썸네일 방지)
  await syncProductThumbnail(asset.productId, asset.url);
  revalidateProduct(asset.productId);
}

/* ── 이미지 속 중국어 번역 ──────────────────────────────────
 * 원본은 originalUrl 로 보존하고 url 만 번역본으로 바꾼다.
 * ocrData(문구 JSON)를 저장해 두므로, 어드민이 문구를 고치면
 * 원본에서 다시 렌더할 수 있고 언제든 원본으로 복원할 수 있다.
 */

export type TranslateState = { error?: string; ok?: boolean };

/**
 * 이미지 속 중국어를 찾아 한국어 번역본을 만든다 (자동 흐름과 같은 규칙).
 * VERIFIED 만 즉시 url 로 나가고, 검수 대기는 후보로 남는다 — 화면 배지가 알려준다.
 */
export async function translateProductAsset(assetId: string): Promise<TranslateState> {
  await requireAdmin();
  if (!process.env.GEMINI_API_KEY) return { error: "GEMINI_API_KEY 미설정 — 번역을 쓸 수 없습니다." };

  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return { error: "이미지를 찾을 수 없습니다." };

  try {
    const { result, message } = await runAssetTranslation(asset);
    await audit({
      action: "ASSET_TRANSLATE",
      target: "product",
      targetId: asset.productId,
      summary: `이미지 번역 (${asset.kind}) → ${result}`,
      meta: { assetId, result, ...(message ? { message } : {}) },
    });
    if (result === "verified") await syncProductThumbnail(asset.productId, asset.url);
    await promoteIfReady(asset.productId);
    revalidateProduct(asset.productId);
    if (result === "verified") return { ok: true };
    if (result === "no_foreign") return { error: "번역할 외국어 텍스트가 없습니다 (교차 확인 완료)." };
    if (result === "review") return { error: `검수 대기로 분류됐습니다 (${message ?? ""}) — 이미지 카드에서 후보를 확인하세요.` };
    if (result === "retryable") return { error: `일시 오류(${message ?? ""}) — 이미지 카드에서 재시도를 승인하세요.` };
    return { error: `번역 실패: ${message ?? "원인 미상"}` };
  } catch (e) {
    return { error: `번역 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 검수 대기 후보를 승인 — 후보가 url 로 승격되고 캐시도 VERIFIED 로 갱신된다 */
export async function approveAssetCandidate(assetId: string): Promise<TranslateState> {
  await requireAdmin();
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset?.candidateUrl) return { error: "승인할 후보가 없습니다." };

  const sourceUrl = asset.originalUrl ?? asset.url;
  const candidate = await readPublicUpload(path.basename(asset.candidateUrl));
  if (!candidate) return { error: "후보 파일을 읽을 수 없습니다." };

  if (asset.url !== sourceUrl) await deleteUploadIfUnused(asset.url, { exceptAssetId: asset.id });
  await db.productAsset.update({
    where: { id: asset.id },
    data: {
      url: asset.candidateUrl,
      originalUrl: sourceUrl,
      ocrData: asset.candidateOcr,
      bytes: candidate.data.byteLength,
      translateStatus: TRANSLATE_STATUS.VERIFIED,
      reviewReasons: null,
      candidateUrl: null,
      candidateOcr: null,
      reviewedAt: new Date(),
    },
  });
  // 운영자 승인 = 사람 검증 — 같은 바이트의 다른 자산도 이 결과를 재사용한다
  const original = await readPublicUpload(path.basename(sourceUrl));
  if (original) {
    await saveTranslationCache({
      sha256: sha256Of(original.data),
      status: "VERIFIED",
      ocrData: asset.candidateOcr,
      resultFile: path.basename(asset.candidateUrl),
      verifyData: JSON.stringify({ approvedBy: "operator", at: new Date().toISOString() }),
    });
  }
  await syncProductThumbnail(asset.productId, asset.url);
  await audit({
    action: "ASSET_TRANSLATE",
    target: "product",
    targetId: asset.productId,
    summary: `번역 후보 승인 (${asset.kind})`,
    meta: { assetId },
  });
  await promoteIfReady(asset.productId);
  revalidateProduct(asset.productId);
  return { ok: true };
}

/** 검수 대기 후보를 거부 — 원본 유지, 후보 파일 삭제, 같은 그림 캐시도 재사용 금지 */
export async function rejectAssetCandidate(assetId: string): Promise<TranslateState> {
  await requireAdmin();
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset?.candidateUrl) return { error: "거부할 후보가 없습니다." };

  await deleteUploadIfUnused(asset.candidateUrl, { exceptAssetId: asset.id });
  await db.productAsset.update({
    where: { id: asset.id },
    data: {
      translateStatus: TRANSLATE_STATUS.FAILED,
      reviewReasons: JSON.stringify([{ code: "RENDER_FAILED", detail: "운영자 거부" }]),
      candidateUrl: null,
      candidateOcr: null,
      reviewedAt: new Date(),
    },
  });
  if (asset.originalSha256) await markCacheStale(asset.originalSha256, "운영자 거부 · 후보 삭제");
  await audit({
    action: "ASSET_TRANSLATE",
    target: "product",
    targetId: asset.productId,
    summary: `번역 후보 거부 (${asset.kind}) — 원본 유지`,
    meta: { assetId },
  });
  revalidateProduct(asset.productId);
  return { ok: true };
}

/**
 * 운영자 승인 재렌더 — 이미지 API HTTP 1회를 명시적으로 추가 실행한다 (정책 6).
 * RETRYABLE(일시 오류)·검수 대기·실패 장에서만. 판정 캐시를 무시하고 다시 돌린다.
 */
export async function approveAssetRerender(assetId: string): Promise<TranslateState> {
  await requireAdmin();
  if (!process.env.GEMINI_API_KEY) return { error: "GEMINI_API_KEY 미설정 — 번역을 쓸 수 없습니다." };
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return { error: "이미지를 찾을 수 없습니다." };
  const allowed = [
    TRANSLATE_STATUS.RETRYABLE,
    TRANSLATE_STATUS.NEEDS_REVIEW,
    TRANSLATE_STATUS.VERIFICATION_FAILED,
    TRANSLATE_STATUS.FAILED,
  ] as string[];
  if (!allowed.includes(asset.translateStatus ?? "")) {
    return { error: "재렌더 승인은 실패·검수 대기 이미지에서만 가능합니다." };
  }

  // 이전 후보 파일 정리 — 새 실행이 새 후보를 만든다
  if (asset.candidateUrl) await deleteUploadIfUnused(asset.candidateUrl, { exceptAssetId: asset.id });

  const { result, message } = await runAssetTranslation(asset, { force: true });
  await audit({
    action: "ASSET_TRANSLATE",
    target: "product",
    targetId: asset.productId,
    summary: `운영자 승인 재렌더 (${asset.kind}) → ${result}`,
    meta: { assetId, result, cost: "image-http-1 (≈$0.067 추정)" },
  });
  if (result === "verified") await syncProductThumbnail(asset.productId, asset.url);
  await promoteIfReady(asset.productId);
  revalidateProduct(asset.productId);
  if (result === "verified") return { ok: true };
  return { error: `재렌더 결과: ${result}${message ? ` (${message})` : ""}` };
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
    // 폼 저장이 곧 "이미지 API 1회 승인"이다. 결과는 바로 나가지 않고 후보로
    // 떠서 운영자가 눈으로 확인한 뒤 승인해야 url 로 승격된다 (정책 2·6 —
    // 수동 지시 렌더는 우리가 글자를 그리므로 기계 검수가 아니라 육안 승인).
    const rendered = await renderTranslatedImage(file.data, file.contentType, edited);
    const saved = await saveImageBuffer(rendered.data, rendered.mime, 15 * 1024 * 1024);
    if (!saved.ok) return { error: `후보 저장 실패: ${saved.error}` };
    if (asset.candidateUrl) await deleteUploadIfUnused(asset.candidateUrl, { exceptAssetId: asset.id });
    await db.productAsset.update({
      where: { id: asset.id },
      data: {
        translateStatus: TRANSLATE_STATUS.NEEDS_REVIEW,
        reviewReasons: JSON.stringify([{ code: "MANUAL_EDIT", detail: "문구 수정 재렌더 — 육안 확인 후 승인" }]),
        candidateUrl: saved.url,
        candidateOcr: JSON.stringify(edited),
      },
    });

    await audit({
      action: "ASSET_TRANSLATE",
      target: "product",
      targetId: asset.productId,
      summary: `이미지 번역 문구 수정 → 후보 생성 (${asset.kind})`,
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
  if (asset.url !== asset.originalUrl) {
    await deleteUploadIfUnused(asset.url, { exceptAssetId: asset.id });
  }
  if (asset.candidateUrl) await deleteUploadIfUnused(asset.candidateUrl, { exceptAssetId: asset.id });

  await db.productAsset.update({
    where: { id: assetId },
    data: {
      url: asset.originalUrl,
      originalUrl: null,
      ocrData: null,
      bytes: original?.data.byteLength ?? asset.bytes,
      // 운영자가 의도적으로 원본을 택한 것 — 상태 기록을 비워 legacy 취급(노출 허용)
      translateStatus: null,
      reviewReasons: null,
      candidateUrl: null,
      candidateOcr: null,
      reviewedAt: new Date(),
    },
  });
  await syncProductThumbnail(asset.productId, asset.url);
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
  // 첫 대표이미지가 바뀌었을 수 있다
  await syncProductThumbnail(productId);
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
