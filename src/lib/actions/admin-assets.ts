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
import { runAssetTranslation, promoteIfReady, demoteIfUnsafe, assetLock } from "@/lib/import/translateAssets";
import { sha256Of, saveTranslationCache, markCacheStale } from "@/lib/translateCache";
import { TRANSLATE_STATUS, revertedAssetTranslation } from "@/lib/productPublishGate";
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
  // 판매 중 상품에 미번역 원본이 붙었으면 즉시 내린다 — 안 그러면 번역도 검수도
  // 안 거친 중국어 이미지가 그 순간부터 손님 화면에 뜬다
  await demoteIfUnsafe(productId);
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
  // 판매를 막고 있던 이미지를 지운 것일 수 있다 — 남은 장이 전부 통과면 되올린다.
  // (이 호출이 없어서, 실패한 1장을 지워도 상품이 "판매 보류"에 계속 남았다)
  await promoteIfReady(asset.productId);
  revalidateProduct(asset.productId);
}

/* ── 이미지 속 중국어 번역 ──────────────────────────────────
 * 원본은 originalUrl 로 보존하고 url 만 번역본으로 바꾼다.
 * ocrData(문구 JSON)를 저장해 두므로, 어드민이 문구를 고치면
 * 원본에서 다시 렌더할 수 있고 언제든 원본으로 복원할 수 있다.
 */

export type TranslateState = {
  error?: string;
  ok?: boolean;
  /**
   * 오류가 아닌 안내. "외국어 없음"·"검수 대기"는 파이프라인의 정상 판정인데
   * error 로 돌려주니 화면에 빨간 오류로 떠서 운영자가 고장으로 읽었다
   * (2026-08-28 운영 테스트). 정상 판정은 여기로, 진짜 실패만 error 로.
   */
  notice?: string;
};

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
    // 판매 중 상품을 수동 번역하면 결과가 검수 대기일 수 있다 — 그 상태로
    // 팔리고 있으면 안 되므로 내리고, 통과면 promoteIfReady 가 올린다
    await demoteIfUnsafe(asset.productId);
    await promoteIfReady(asset.productId);
    revalidateProduct(asset.productId);
    if (result === "verified") return { ok: true };
    // 아래 둘은 정상 판정이다 — error 로 주면 화면에 빨간 오류로 떠서 고장으로 읽힌다
    if (result === "no_foreign") return { ok: true, notice: "번역할 외국어 텍스트가 없습니다 (교차 확인 완료)." };
    if (result === "review") return { ok: true, notice: `검수 대기로 분류됐습니다 (${message ?? ""}) — 이미지 카드에서 확인하세요.` };
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

/**
 * 검수함의 일괄 승인 — 체크한 장들을 한 번에 승격한다.
 * 규칙은 개별 승인(approveAssetCandidate)과 완전히 같다: 후보가 있는 장만,
 * 같은 승격 경로로. 여기서 별도 로직을 만들면 승인 규칙이 두 갈래가 된다.
 */
export async function approveAssetCandidates(
  assetIds: string[],
): Promise<{ approved: number; skipped: number }> {
  await requireAdmin();
  let approved = 0;
  let skipped = 0;
  // 순차 실행 — 같은 상품의 승격(promoteIfReady)이 겹치면 조건부 갱신이 막아주지만,
  // 굳이 경쟁을 만들 이유가 없다. 검수함 규모(수십 장)에서 순차는 충분히 빠르다.
  for (const id of assetIds) {
    const r = await approveAssetCandidate(id);
    if (r.ok) approved++;
    else skipped++;
  }
  return { approved, skipped };
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
  // FAILED 는 노출 불가다 — 판매 중이었으면 내린다
  await demoteIfUnsafe(asset.productId);
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
    // 원본 유지도 허용 — 자동 재번역은 운영자 결정을 보호하려 막지만, 이 버튼을
    // 누르는 건 그 운영자의 새 결정이다. 검수함에 떠 있는데 누르면 오류가 나는
    // 막다른 길을 만들지 않는다.
    TRANSLATE_STATUS.ORIGINAL_KEPT,
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
  // 검수 대기·외국어 없음은 정상 판정 — 후보가 생겼거나 바꿀 게 없다는 뜻이다
  if (result === "review") return { ok: true, notice: `검수 대기로 분류됐습니다${message ? ` (${message})` : ""} — 후보를 확인하세요.` };
  if (result === "no_foreign") return { ok: true, notice: "번역할 외국어 텍스트가 없습니다." };
  return { error: `재렌더 결과: ${result}${message ? ` (${message})` : ""}` };
}

/**
 * 백그라운드 재생성 — 시작만 하고 즉시 응답한다 (2026-08-31 실측 대응).
 *
 * 재생성은 30초~2분 걸리는데, 서버 액션 응답을 그 시간 동안 붙잡으면 프록시가
 * 연결을 끊는다. 화면엔 "요청이 끊겼습니다"가 뜨지만 서버는 완주하고 기록해서,
 * 운영자가 결과를 못 보고 또 눌러 이중 과금될 위험이 있었다(반복 실험으로 확인).
 *
 * 그래서: ① 잠금을 먼저 선점해 겹침을 끊고 ② 진행 표시(TRANSLATING)를 응답
 * 전에 박아 화면 폴링이 상태를 따라가게 한 뒤 ③ 실제 실행은 뒤에서 돌린다.
 * 백그라운드에서는 revalidatePath 를 부르면 안 된다 — 응답이 끝난 분리된
 * 컨텍스트라 Next 가 예외를 던진다(translateOnPublish 의 실측 주석 참고).
 */
export async function startAssetRerender(assetId: string): Promise<TranslateState> {
  await requireAdmin();
  if (!process.env.GEMINI_API_KEY) return { error: "GEMINI_API_KEY 미설정 — 번역을 쓸 수 없습니다." };
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return { error: "이미지를 찾을 수 없습니다." };
  // 진행 중 검사가 허용 목록보다 먼저다 — 진행 표시(TRANSLATING)는 허용 목록에
  // 없어서, 순서를 바꾸면 겹쳐 누른 두 번째가 "불가" 오류로 보인다
  if (asset.translateStatus === TRANSLATE_STATUS.TRANSLATING) {
    return { ok: true, notice: "이미 진행 중입니다 — 잠시 후 자동으로 갱신됩니다." };
  }
  const allowed = [
    TRANSLATE_STATUS.RETRYABLE,
    TRANSLATE_STATUS.NEEDS_REVIEW,
    TRANSLATE_STATUS.VERIFICATION_FAILED,
    TRANSLATE_STATUS.FAILED,
    TRANSLATE_STATUS.ORIGINAL_KEPT,
  ] as string[];
  if (!allowed.includes(asset.translateStatus ?? "")) {
    return { error: "다시 만들기는 실패·검수 대기 이미지에서만 가능합니다." };
  }

  // 잠금은 응답 전에 선점한다 — 백그라운드로 미루면 두 번 누른 사이에 둘 다 시작된다
  if (!assetLock.tryAcquire(asset.id)) {
    return { ok: true, notice: "이미 진행 중입니다 — 잠시 후 자동으로 갱신됩니다." };
  }

  try {
    if (asset.candidateUrl) await deleteUploadIfUnused(asset.candidateUrl, { exceptAssetId: asset.id });
    // 진행 표시를 먼저 박는다 — 응답 직후 화면이 "다시 만드는 중"을 보여줄 수 있게
    await db.productAsset.update({
      where: { id: asset.id },
      data: { translateStatus: TRANSLATE_STATUS.TRANSLATING },
    });
    await audit({
      action: "ASSET_TRANSLATE",
      target: "product",
      targetId: asset.productId,
      summary: `재렌더 시작 (${asset.kind})`,
      meta: { assetId, cost: "image-http-1 (≈$0.067 추정)" },
    });
  } catch (e) {
    assetLock.release(asset.id);
    throw e;
  }

  void (async () => {
    const { result, message } = await runAssetTranslation(asset, { force: true });
    await audit({
      action: "ASSET_TRANSLATE",
      target: "product",
      targetId: asset.productId,
      summary: `재렌더 완료 (${asset.kind}) → ${result}`,
      meta: { assetId, result, ...(message ? { message } : {}) },
    });
    if (result === "verified") await syncProductThumbnail(asset.productId, asset.url);
    await demoteIfUnsafe(asset.productId);
    await promoteIfReady(asset.productId);
  })()
    .catch(async (e) => {
      // 어떤 예외로 끝나도 진행 표시에 갇히면 안 된다 — 실패로 착지시킨다
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[재렌더] 백그라운드 실패 ${assetId}: ${msg}`);
      await db.productAsset
        .update({
          where: { id: asset.id },
          data: {
            translateStatus: TRANSLATE_STATUS.FAILED,
            reviewReasons: JSON.stringify([{ code: "RENDER_FAILED", detail: msg.slice(0, 300) }]),
          },
        })
        .catch(() => {});
    })
    .finally(() => assetLock.release(asset.id));

  revalidateProduct(asset.productId);
  return { ok: true, notice: "다시 만들기 시작 — 보통 1~2분 걸립니다. 이 화면에서 자동으로 갱신됩니다." };
}

/** 지시 재생성의 백그라운드판 — 검증은 응답 전에, 렌더는 뒤에서 */
export async function startAssetRegenerateWithHint(
  assetId: string,
  _prev: TranslateState,
  formData: FormData,
): Promise<TranslateState> {
  await requireAdmin();
  if (!process.env.GEMINI_API_KEY) return { error: "GEMINI_API_KEY 미설정 — 번역을 쓸 수 없습니다." };

  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return { error: "이미지를 찾을 수 없습니다." };
  if (asset.translateStatus === TRANSLATE_STATUS.TRANSLATING) {
    return { ok: true, notice: "이미 진행 중입니다 — 잠시 후 자동으로 갱신됩니다." };
  }

  const hint = String(formData.get("hint") ?? "").trim().slice(0, 300);
  if (!hint) return { error: "무엇을 고쳐야 하는지 지시를 적어주세요." };
  const raw = asset.ocrData ?? asset.candidateOcr;
  if (!raw) {
    return { error: "번역 문구 기록이 없어 개선 재생성을 할 수 없습니다. '다시 만들기'를 먼저 쓰세요." };
  }
  const sourceUrl = asset.originalUrl ?? asset.url;
  const file = await readPublicUpload(path.basename(sourceUrl));
  if (!file) return { error: "원본 파일을 읽을 수 없습니다." };
  let boxes: OcrBox[];
  try {
    boxes = parseOcrBoxes(JSON.parse(raw));
  } catch {
    return { error: "번역 문구 기록을 읽을 수 없습니다." };
  }
  if (boxes.length === 0) return { error: "다시 만들 문구가 없습니다." };

  if (!assetLock.tryAcquire(asset.id)) {
    return { ok: true, notice: "이미 진행 중입니다 — 잠시 후 자동으로 갱신됩니다." };
  }

  try {
    await db.productAsset.update({
      where: { id: asset.id },
      data: { translateStatus: TRANSLATE_STATUS.TRANSLATING },
    });
    await audit({
      action: "ASSET_TRANSLATE",
      target: "product",
      targetId: asset.productId,
      summary: `개선 지시 재생성 시작 (${asset.kind})`,
      meta: { assetId, hint, cost: "image-http-1 (≈$0.067 추정)" },
    });
  } catch (e) {
    assetLock.release(asset.id);
    throw e;
  }

  void (async () => {
    const rendered = await renderTranslatedImage(file.data, file.contentType, boxes, { hint });
    const saved = await saveImageBuffer(rendered.data, rendered.mime, 15 * 1024 * 1024);
    if (!saved.ok) throw new Error(`후보 저장 실패: ${saved.error}`);
    if (asset.candidateUrl) await deleteUploadIfUnused(asset.candidateUrl, { exceptAssetId: asset.id });
    await db.productAsset.update({
      where: { id: asset.id },
      data: {
        translateStatus: TRANSLATE_STATUS.NEEDS_REVIEW,
        reviewReasons: JSON.stringify([{ code: "MANUAL_EDIT", detail: `개선 지시 재생성: ${hint}` }]),
        candidateUrl: saved.url,
        candidateOcr: JSON.stringify(boxes),
      },
    });
    await audit({
      action: "ASSET_TRANSLATE",
      target: "product",
      targetId: asset.productId,
      summary: `개선 지시 재생성 완료 → 후보 생성 (${asset.kind})`,
      meta: { assetId, hint },
    });
    await demoteIfUnsafe(asset.productId);
  })()
    .catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[지시 재생성] 백그라운드 실패 ${assetId}: ${msg}`);
      await db.productAsset
        .update({
          where: { id: asset.id },
          data: {
            // 문구 기록(candidateOcr)은 남긴다 — 지시를 고쳐 다시 시도할 수 있게
            translateStatus: TRANSLATE_STATUS.NEEDS_REVIEW,
            reviewReasons: JSON.stringify([{ code: "RENDER_FAILED", detail: msg.slice(0, 300) }]),
            candidateOcr: raw,
          },
        })
        .catch(() => {});
    })
    .finally(() => assetLock.release(asset.id));

  revalidateProduct(asset.productId);
  return { ok: true, notice: "다시 만들기 시작 — 보통 1~2분 걸립니다. 이 화면에서 자동으로 갱신됩니다." };
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

/**
 * 운영자가 고친 이미지를 직접 올린다 — 모델 실패와 무관한 복구 바닥.
 *
 * 재생성은 실패할 수 있고 비용도 든다. 어떤 실패 유형이든 확실히 복구되는
 * 수단이 하나는 있어야 운영자가 막히지 않는다(이미지 API 호출 0회).
 *
 * 올린 파일은 **후보로만** 들어간다 — url·originalUrl 은 손대지 않는다.
 * 승인해야 손님용으로 승격되고, 그때 approveAssetCandidate 가 원본 보존까지 맡는다.
 */
export async function uploadAssetCandidate(
  assetId: string,
  _prev: TranslateState,
  formData: FormData,
): Promise<TranslateState> {
  await requireAdmin();
  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return { error: "이미지를 찾을 수 없습니다." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "올릴 이미지를 선택해주세요." };
  // GIF 는 이번 범위 밖 — 프레임 합성 규칙이 따로 있어 정지 이미지와 섞으면 안 된다
  if (file.type === "image/gif") return { error: "GIF 는 직접 업로드를 지원하지 않습니다." };

  // 크기·MIME·매직바이트 검증은 saveImageUpload 안에서 한다 (file.type 은 위조 가능)
  const saved = await saveImageUpload(file);
  if (!saved.ok) return { error: saved.error };

  // 이전 후보는 정리 — 후보는 항상 한 장만 남긴다
  if (asset.candidateUrl) await deleteUploadIfUnused(asset.candidateUrl, { exceptAssetId: asset.id });

  await db.productAsset.update({
    where: { id: asset.id },
    data: {
      // url·originalUrl 불변 — 승인 전까지 손님에게 나가는 그림은 그대로다
      translateStatus: TRANSLATE_STATUS.NEEDS_REVIEW,
      reviewReasons: JSON.stringify([
        { code: "MANUAL_EDIT", detail: "운영자 직접 업로드 — 육안 확인 후 승인" },
      ]),
      candidateUrl: saved.url,
      // 우리가 만든 그림이 아니라 문구 좌표를 알 수 없다. 승인 시 ocrData 는 비워진다
      candidateOcr: null,
    },
  });

  await audit({
    action: "ASSET_TRANSLATE",
    target: "product",
    targetId: asset.productId,
    summary: `수정본 직접 업로드 → 후보 생성 (${asset.kind})`,
    meta: { assetId, bytes: file.size, mime: file.type },
  });
  // 검수 대기가 되었으니 판매 중이었으면 내린다
  await demoteIfUnsafe(asset.productId);
  revalidateProduct(asset.productId);
  return { ok: true };
}

/**
 * 운영자 개선 지시를 얹어 AI 로 다시 만든다 (이미지 API 1회 ≈ $0.067).
 *
 * "재렌더 승인"과 다른 점은 지시를 실어 보낸다는 것뿐이다 — 같은 조건으로
 * 다시 돌리면 대개 같은 결과가 나오므로, 무엇이 잘못됐는지 알려줘야 한다.
 * 결과는 후보로만 남는다(자동 게시 금지). 원본에서 다시 그리므로 원본은 불변.
 */
export async function regenerateAssetWithHint(
  assetId: string,
  _prev: TranslateState,
  formData: FormData,
): Promise<TranslateState> {
  await requireAdmin();
  if (!process.env.GEMINI_API_KEY) return { error: "GEMINI_API_KEY 미설정 — 번역을 쓸 수 없습니다." };

  const asset = await db.productAsset.findUnique({ where: { id: assetId } });
  if (!asset) return { error: "이미지를 찾을 수 없습니다." };
  if (asset.translateStatus === TRANSLATE_STATUS.TRANSLATING) {
    return { ok: true, notice: "이미 진행 중입니다 — 잠시 후 자동으로 갱신됩니다." };
  }

  const hint = String(formData.get("hint") ?? "").trim().slice(0, 300);
  if (!hint) return { error: "무엇을 고쳐야 하는지 지시를 적어주세요." };

  // 문구 좌표가 있어야 재생성 프롬프트를 만든다. 검수 대기 자산은 candidateOcr 에,
  // 검증된 자산은 ocrData 에 들어 있다.
  const raw = asset.ocrData ?? asset.candidateOcr;
  if (!raw) {
    return { error: "번역 문구 기록이 없어 개선 재생성을 할 수 없습니다. '재렌더 승인'을 먼저 쓰세요." };
  }
  // 원본에서 다시 그린다 — 번역본 위에 덧그리면 오차가 쌓인다
  const sourceUrl = asset.originalUrl ?? asset.url;
  const file = await readPublicUpload(path.basename(sourceUrl));
  if (!file) return { error: "원본 파일을 읽을 수 없습니다." };

  let boxes: OcrBox[];
  try {
    boxes = parseOcrBoxes(JSON.parse(raw));
  } catch {
    return { error: "번역 문구 기록을 읽을 수 없습니다." };
  }
  if (boxes.length === 0) return { error: "다시 만들 문구가 없습니다." };

  try {
    const rendered = await renderTranslatedImage(file.data, file.contentType, boxes, { hint });
    const saved = await saveImageBuffer(rendered.data, rendered.mime, 15 * 1024 * 1024);
    if (!saved.ok) return { error: `후보 저장 실패: ${saved.error}` };
    if (asset.candidateUrl) await deleteUploadIfUnused(asset.candidateUrl, { exceptAssetId: asset.id });

    await db.productAsset.update({
      where: { id: asset.id },
      data: {
        // url·originalUrl 불변 — 승인 전까지 노출되지 않는다
        translateStatus: TRANSLATE_STATUS.NEEDS_REVIEW,
        reviewReasons: JSON.stringify([
          { code: "MANUAL_EDIT", detail: `개선 지시 재생성: ${hint}` },
        ]),
        candidateUrl: saved.url,
        candidateOcr: JSON.stringify(boxes),
      },
    });

    await audit({
      action: "ASSET_TRANSLATE",
      target: "product",
      targetId: asset.productId,
      summary: `개선 지시 재생성 → 후보 생성 (${asset.kind})`,
      meta: { assetId, hint, cost: "image-http-1 (≈$0.067 추정)" },
    });
    await demoteIfUnsafe(asset.productId);
    revalidateProduct(asset.productId);
    return { ok: true };
  } catch (e) {
    return { error: `개선 재생성 실패: ${e instanceof Error ? e.message : String(e)}` };
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
      // 운영자가 의도적으로 원본을 택한 것 — legacy 취급(노출 허용)으로 남긴다.
      // originalUrl 까지 지우면 게이트가 "미번역"으로 보고 이 상품은 판매 전환이
      // 영영 안 된다 (revertedAssetTranslation 주석의 실사례)
      ...revertedAssetTranslation(asset.originalUrl),
      ocrData: null,
      bytes: original?.data.byteLength ?? asset.bytes,
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
  // 복원 자체는 노출 허용이지만, 같은 상품의 다른 이미지가 검수 대기일 수 있다
  await demoteIfUnsafe(asset.productId);
  await promoteIfReady(asset.productId);
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
