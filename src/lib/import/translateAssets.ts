import "server-only";
import path from "node:path";
import { db } from "@/lib/db";
import { readPublicUpload, saveImageBuffer, deleteUploadIfUnused } from "@/lib/storage";
import { translateImageAuto, hasHanzi, type TranslateOutcome, type OcrBox } from "@/lib/imageTranslate";
import { phraseMemoryFrom } from "@/lib/phraseMemory";
import { retranslateName } from "@/lib/import/translate";
import { audit } from "@/lib/audit";
import { sha256Of, lookupTranslationCache, saveTranslationCache } from "@/lib/translateCache";
import { productPublishGate, TRANSLATE_STATUS, type ReviewReason } from "@/lib/productPublishGate";
import { sourceForUrl } from "@/lib/import/sources";
import { createKeyedLock } from "@/lib/keyedLock";

/**
 * 수집 상품 이미지 속 중국어를 한국어로 바꾼다 (설계 2026-08-24 v2.1).
 *
 * 원본당 이미지 API HTTP 요청 최대 1회. 검증(VERIFIED)을 통과한 결과만 url 로
 * 나가고, 그 외에는 전부 원본 유지 + 상태·사유 기록이다 — 불확실한 이미지가
 * 손님에게 나가는 길이 없다. 같은 바이트(SHA-256)는 캐시로 재사용해 API 0회.
 */

/** CDN·모델 한도를 건드리지 않을 만큼만 동시에 */
const CONCURRENCY = 3;

/**
 * 자산 단위 선점 — 겹친 실행이 같은 자산에 유료 호출을 두 번 보내지 못하게 한다.
 * 모듈 최상단에 둬야 실행끼리 공유된다(호출마다 새로 만들면 아무것도 못 막는다).
 */
export const assetLock = createKeyedLock();

export interface AssetTranslateReport {
  verified: number;
  review: number;
  failed: number;
  skipped: number;
}

type RunResult = "verified" | "no_foreign" | "review" | "retryable" | "failed" | "skipped";

const reasonsJson = (reasons: ReviewReason[]): string => JSON.stringify(reasons).slice(0, 2000);

/**
 * 이미지 한 장 번역 실행 + 결과 저장 규칙의 단일 구현.
 * 자동 수집과 어드민 수동 버튼이 같은 규칙을 쓴다 — 저장 규칙이 갈라지면
 * 한쪽으로만 검수 대기 이미지가 노출되는 구멍이 생긴다.
 *
 * @param force 운영자 승인 재렌더 — 판정 캐시(NEEDS_REVIEW 등)를 무시하고 1회 실행
 */
export async function runAssetTranslation(
  asset: { id: string; url: string; originalUrl: string | null; productId: string },
  opts: { force?: boolean } = {},
): Promise<{ result: RunResult; message?: string }> {
  const sourceUrl = asset.originalUrl ?? asset.url;
  const file = await readPublicUpload(path.basename(sourceUrl));
  if (!file) {
    await db.productAsset.update({
      where: { id: asset.id },
      data: {
        translateStatus: TRANSLATE_STATUS.FAILED,
        reviewReasons: reasonsJson([{ code: "RENDER_FAILED", detail: "원본 파일을 읽을 수 없음" }]),
      },
    });
    return { result: "failed", message: "원본 파일을 읽을 수 없습니다." };
  }

  const sha = sha256Of(file.data);

  // 캐시 — 같은 바이트는 두 번 렌더하지 않는다. VERIFIED 는 파일 무결까지 확인된 것.
  const hit = await lookupTranslationCache(sha);
  if (hit?.kind === "verified") {
    if (asset.url !== sourceUrl) await deleteUploadIfUnused(asset.url, { exceptAssetId: asset.id });
    await db.productAsset.update({
      where: { id: asset.id },
      data: {
        url: `/uploads/${hit.resultFile}`,
        originalUrl: sourceUrl,
        ocrData: hit.ocrData,
        bytes: hit.data.byteLength,
        translateStatus: TRANSLATE_STATUS.VERIFIED,
        reviewReasons: null,
        candidateUrl: null,
        candidateOcr: null,
        originalSha256: sha,
      },
    });
    return { result: "verified" };
  }
  if (hit?.kind === "no_foreign") {
    await db.productAsset.update({
      where: { id: asset.id },
      data: { translateStatus: TRANSLATE_STATUS.NO_FOREIGN_TEXT, reviewReasons: null, originalSha256: sha },
    });
    return { result: "no_foreign" };
  }
  if (hit?.kind === "blocked" && !opts.force) {
    // 이미 판정이 난 그림 — 자동으로 API 를 다시 쓰지 않는다 (정책 8)
    await db.productAsset.update({
      where: { id: asset.id },
      data: {
        translateStatus: hit.status,
        reviewReasons: hit.verifyData,
        candidateUrl: hit.candidate ? `/uploads/${hit.candidate.resultFile}` : null,
        candidateOcr: hit.candidate ? hit.ocrData : null,
        originalSha256: sha,
      },
    });
    return { result: hit.status === TRANSLATE_STATUS.RETRYABLE ? "retryable" : "review", message: "이미 판정된 그림(캐시) — 운영자 승인 시에만 재실행" };
  }

  await db.productAsset.update({
    where: { id: asset.id },
    data: { translateStatus: TRANSLATE_STATUS.TRANSLATING, originalSha256: sha },
  });

  // GIF 는 승인 문구를 출발점으로 쓴다 — 자기 확정 문구 + 같은 상품 VERIFIED 그림의 문구.
  // 실측(2026-09-02): 재렌더가 매번 처음부터 번역해 승인된 "인체공학 설계"를 "인체 마스터"로 바꿨다.
  let phraseMemory: Map<string, string> | undefined;
  if (file.contentType === "image/gif") {
    const rows = await db.productAsset.findMany({
      where: { productId: asset.productId },
      select: { id: true, translateStatus: true, ocrData: true, candidateOcr: true },
    });
    phraseMemory = phraseMemoryFrom(rows, asset.id);
  }
  let outcome: TranslateOutcome;
  try {
    // 국소 폴백은 운영자 승인 재렌더(force)에서만 — 자동 흐름의 1회 원칙 유지
    outcome = await translateImageAuto(file.data, file.contentType, { safetyFallback: opts.force === true, phraseMemory });
  } catch (e) {
    outcome = { status: "FAILED", reason: e instanceof Error ? e.message : String(e) };
  }
  return storeOutcome(asset, sourceUrl, sha, outcome);
}

/** 판정 결과 → DB·파일·캐시 저장 규칙 (정책 9·10: VERIFIED 만 url 로 나간다) */
async function storeOutcome(
  asset: { id: string; url: string; productId: string },
  sourceUrl: string,
  sha: string,
  outcome: TranslateOutcome,
): Promise<{ result: RunResult; message?: string }> {
  const boxesJson = (boxes: OcrBox[]): string => JSON.stringify(boxes);

  if (outcome.status === "VERIFIED") {
    const saved = await saveImageBuffer(outcome.data, outcome.mime, 15 * 1024 * 1024);
    if (!saved.ok) {
      await db.productAsset.update({
        where: { id: asset.id },
        data: {
          translateStatus: TRANSLATE_STATUS.FAILED,
          reviewReasons: reasonsJson([{ code: "RENDER_FAILED", detail: `번역본 저장 실패: ${saved.error}` }]),
        },
      });
      return { result: "failed", message: saved.error };
    }
    if (asset.url !== sourceUrl) await deleteUploadIfUnused(asset.url, { exceptAssetId: asset.id });
    await db.productAsset.update({
      where: { id: asset.id },
      data: {
        url: saved.url,
        originalUrl: sourceUrl,
        ocrData: boxesJson(outcome.boxes),
        bytes: outcome.data.byteLength,
        translateStatus: TRANSLATE_STATUS.VERIFIED,
        reviewReasons: null,
        candidateUrl: null,
        candidateOcr: null,
      },
    });
    await saveTranslationCache({
      sha256: sha,
      status: "VERIFIED",
      ocrData: boxesJson(outcome.boxes),
      resultFile: path.basename(saved.url),
    });
    return { result: "verified" };
  }

  if (outcome.status === "NO_FOREIGN_TEXT") {
    await db.productAsset.update({
      where: { id: asset.id },
      data: { translateStatus: TRANSLATE_STATUS.NO_FOREIGN_TEXT, reviewReasons: null },
    });
    await saveTranslationCache({ sha256: sha, status: "NO_FOREIGN_TEXT" });
    return { result: "no_foreign" };
  }

  if (outcome.status === "FAILED") {
    await db.productAsset.update({
      where: { id: asset.id },
      data: {
        translateStatus: TRANSLATE_STATUS.FAILED,
        reviewReasons: reasonsJson([{ code: "RENDER_FAILED", detail: outcome.reason }]),
      },
    });
    await saveTranslationCache({ sha256: sha, status: "FAILED", verifyData: outcome.reason.slice(0, 500) });
    return { result: "failed", message: outcome.reason };
  }

  if (outcome.status === "RETRYABLE") {
    await db.productAsset.update({
      where: { id: asset.id },
      data: { translateStatus: TRANSLATE_STATUS.RETRYABLE, reviewReasons: reasonsJson(outcome.reasons) },
    });
    await saveTranslationCache({ sha256: sha, status: "RETRYABLE", verifyData: reasonsJson(outcome.reasons) });
    return { result: "retryable", message: outcome.reasons.map((r) => r.code).join(",") };
  }

  // NEEDS_REVIEW · VERIFICATION_FAILED — 후보가 있으면 보존하고 url 은 원본 유지
  const status =
    outcome.status === "VERIFICATION_FAILED" ? TRANSLATE_STATUS.VERIFICATION_FAILED : TRANSLATE_STATUS.NEEDS_REVIEW;
  let candidateUrl: string | null = null;
  if (outcome.data && outcome.mime) {
    const saved = await saveImageBuffer(outcome.data, outcome.mime, 15 * 1024 * 1024);
    if (saved.ok) candidateUrl = saved.url;
  }
  await db.productAsset.update({
    where: { id: asset.id },
    data: {
      translateStatus: status,
      reviewReasons: reasonsJson(outcome.reasons),
      candidateUrl,
      // 문구 기록은 후보 파일이 없어도 남긴다. 후보와 묶어 지웠더니 렌더 전에
      // 막힌 자산(에코 UNTRANSLATED·안전필터)에서 "문구 기록이 없어 개선 재생성을
      // 할 수 없습니다"가 떴다 — 이미 뽑아 둔 문구를 버려 복구 길만 좁힌 셈이다.
      candidateOcr: outcome.boxes.length > 0 ? boxesJson(outcome.boxes) : null,
    },
  });
  await saveTranslationCache({
    sha256: sha,
    status,
    ocrData: boxesJson(outcome.boxes),
    resultFile: candidateUrl ? path.basename(candidateUrl) : null,
    verifyData: reasonsJson(outcome.reasons),
  });
  return { result: "review", message: outcome.reasons.map((r) => r.code).join(",") };
}

/**
 * 번역 검증이 전부 끝난 상품을 ACTIVE 로 승격한다.
 *
 * "판매중" 요청(publishRequestedAt)이 걸려 있고 전 이미지가 노출 허용 상태일
 * 때만 승격 — 번역 중·검수 대기인 중국어 이미지가 먼저 노출되는 창을 없앤다.
 * 배포된 컨텍스트(응답 이후 백그라운드)에서 불리므로 revalidatePath 를 부르지
 * 않는다 — 상세·어드민 페이지는 쿠키 확인 때문에 항상 동적 렌더다.
 */
/**
 * 이름에 한자가 남았으면 재번역 — 수집 때 429 등으로 번역이 실패해 원문이
 * 남은 상품의 복구(실사례 2026-08-27: 월 한도로 4건 중 1건이 원문 이름 그대로).
 * 판매 시점의 최후 방어선이며, 실패해도 판매를 막지 않는다 — 이름은 좋게
 * 만드는 것이지 게이트가 아니다.
 */
export async function ensureKoreanName(productId: string): Promise<void> {
  const p = await db.product.findUnique({ where: { id: productId }, select: { name: true } });
  if (!p || !hasHanzi(p.name)) return;
  const ko = await retranslateName(p.name);
  if (!ko) return;
  await db.product.update({ where: { id: productId }, data: { name: ko } });
  await audit({
    action: "PRODUCT_UPDATE",
    target: "product",
    targetId: productId,
    summary: `상품명 재번역: ${p.name.slice(0, 40)} → ${ko}`,
    meta: { before: p.name, after: ko },
  });
}

export async function promoteIfReady(productId: string): Promise<boolean> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { status: true, publishRequestedAt: true, sourceUrl: true, brand: true },
  });
  if (!product?.publishRequestedAt) return false;
  const needsTranslation = sourceForUrl(product.sourceUrl)?.translate === true;
  const assets = await db.productAsset.findMany({
    where: { productId },
    select: { translateStatus: true, originalUrl: true },
  });
  // 브랜드가 아직 "미정"이면 번역이 끝나도 승격하지 않는다 — 안 그러면 보류가
  // 자동 승격으로 새어 손님 화면에 "미정" 브랜드가 뜬다
  const gate = productPublishGate(assets, needsTranslation, product.brand);
  if (!gate.ready) return false;
  // 조건부 갱신 — 게이트를 보는 사이에 운영자가 상품을 숨겨(판매 요청 취소)
  // 버렸으면 승격하지 않는다. 읽고→검사→쓰기로 하면 그 취소를 덮어써서
  // 숨긴 상품이 손님에게 다시 뜬다. 번역은 장당 십수 초 × 수십 장이라
  // 그 사이 운영자 조작과 겹칠 창이 실제로 넓다.
  const claimed = await db.product.updateMany({
    where: { id: productId, publishRequestedAt: { not: null } },
    data: { status: "ACTIVE", publishRequestedAt: null },
  });
  if (claimed.count !== 1) return false;
  console.log(`[publish] 번역 검증 완료 — ${productId} 판매중으로 자동 승격`);
  // 승격 = 손님 노출 — 수집 때 번역이 실패한 원문 이름이 남았으면 여기서 복구
  await ensureKoreanName(productId).catch(() => {});
  return true;
}

/**
 * 판매 중(ACTIVE) 상품의 이미지가 노출 불가 상태가 되면 즉시 숨김으로 내린다.
 *
 * 실사례(2026-08-27 감사): 노출 게이트가 **판매 전환 시점에만** 돌았다. 이미
 * ACTIVE 인 상품에 원본 이미지를 추가하거나 수동 번역을 걸면(TRANSLATING →
 * NEEDS_REVIEW) 그 사이 중국어 원본이 손님에게 그대로 보이는데 상품은 ACTIVE 로
 * 남았다 — 승격만 있고 강등이 없었던 탓이다.
 *
 * 내릴 때 판매 요청(publishRequestedAt)을 남기므로, 번역·검수가 끝나면
 * promoteIfReady 가 자동으로 되올린다. 운영자가 다시 누를 필요가 없다.
 * 이미 숨김인 상품은 건드리지 않는다 — 의도적으로 숨긴 상품을 판매 대기로
 * 바꿔 놓으면 번역이 끝나는 순간 제멋대로 팔리기 시작한다.
 */
export async function demoteIfUnsafe(productId: string): Promise<boolean> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { status: true, sourceUrl: true, brand: true },
  });
  if (product?.status !== "ACTIVE") return false;

  const needsTranslation = sourceForUrl(product.sourceUrl)?.translate === true;
  const assets = await db.productAsset.findMany({
    where: { productId },
    select: { translateStatus: true, originalUrl: true },
  });
  if (productPublishGate(assets, needsTranslation, product.brand).ready) return false;

  // 조건부 갱신 — 이미 누가 내렸으면(다른 요청) 판매 요청을 덧쓰지 않는다
  const claimed = await db.product.updateMany({
    where: { id: productId, status: "ACTIVE" },
    data: { status: "HIDDEN", publishRequestedAt: new Date() },
  });
  if (claimed.count !== 1) return false;
  console.log(`[publish] 노출 불가 이미지 발생 — ${productId} 판매 보류로 강등`);
  return true;
}

/**
 * 상품의 모든 이미지를 번역한다.
 * 썸네일(Product.image)이 번역 전 파일을 가리키고 있으면 번역본으로 옮긴다 —
 * 안 옮기면 목록에만 중국어 썸네일이 남는다.
 */
export async function translateProductImages(productId: string): Promise<AssetTranslateReport> {
  const report: AssetTranslateReport = { verified: 0, review: 0, failed: 0, skipped: 0 };
  if (!process.env.GEMINI_API_KEY) return report;

  const assets = await db.productAsset.findMany({
    where: { productId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, url: true, originalUrl: true, productId: true, translateStatus: true, ocrData: true, bytes: true },
  });

  // 배치(N장씩 Promise.all)는 매 배치가 가장 느린 장을 기다린다 — 풀 방식은
  // (선점 잠금은 모듈 최상단 assetLock — 실행끼리 공유해야 의미가 있다)
  // 슬롯이 빌 때마다 다음 장을 바로 당긴다(운영 신고: 상품당 10분+).
  let next = 0;
  const results: RunResult[] = [];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, assets.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= assets.length) return;
        const a = assets[i];
        try {
          // 이미 판정이 끝난 장은 건너뛴다 — VERIFIED 재호출 금지 (정책 8).
          // legacy(상태 null + 번역본 있음)도 그대로 둔다.
          //
          // 검수·실패 판정(NEEDS_REVIEW·VERIFICATION_FAILED·RETRYABLE·FAILED)도
          // 자동 경로에서는 건드리지 않는다. 판정 캐시가 막아 주긴 하지만 그건
          // (sha256, pipelineVersion) 키가 살아 있을 때뿐이다 — 파이프라인 버전을
          // 올리면 전 캐시가 미스가 되고, 그 상태에서 운영자가 "판매"를 누를 때마다
          // 검수 대기 이미지가 통째로 유료 재렌더된다(장당 ~₩100). 재실행은 설계대로
          // 운영자 승인(approveAssetRerender → force)뿐이다.
          // TRANSLATING 은 판정이 아니라 중단된 흔적이므로 다시 돌린다.
          //
          // ORIGINAL_KEPT 도 건너뛴다 — 운영자가 "이 번역본 대신 원본을 쓰겠다"고
          // 내린 결정이라 자동 재번역이 그걸 덮으면 안 된다. 목록에서 빠져 있던
          // 탓에 "판매"를 누를 때마다 다시 돌아 결정이 뒤집히고 유료 호출까지
          // 나갔다(2026-08-27 감사).
          const judged: (string | null)[] = [
            TRANSLATE_STATUS.VERIFIED,
            TRANSLATE_STATUS.NO_FOREIGN_TEXT,
            TRANSLATE_STATUS.NEEDS_REVIEW,
            TRANSLATE_STATUS.VERIFICATION_FAILED,
            TRANSLATE_STATUS.RETRYABLE,
            TRANSLATE_STATUS.FAILED,
            TRANSLATE_STATUS.ORIGINAL_KEPT,
          ];
          if (judged.includes(a.translateStatus) || (a.translateStatus === null && a.originalUrl !== null)) {
            results[i] = "skipped";
            continue;
          }
          // 같은 원본 파일을 다른 자산에서 이미 검증 완료했으면 그대로 잇는다 (API 0회)
          const sibling = await db.productAsset.findFirst({
            where: {
              originalUrl: a.originalUrl ?? a.url,
              translateStatus: TRANSLATE_STATUS.VERIFIED,
              NOT: { id: a.id },
            },
            select: { url: true, ocrData: true, bytes: true, originalSha256: true },
          });
          if (sibling) {
            await db.productAsset.update({
              where: { id: a.id },
              data: {
                url: sibling.url,
                originalUrl: a.originalUrl ?? a.url,
                ocrData: sibling.ocrData,
                bytes: sibling.bytes,
                translateStatus: TRANSLATE_STATUS.VERIFIED,
                originalSha256: sibling.originalSha256,
              },
            });
            results[i] = "verified";
            continue;
          }
          // 이 자산을 원자적으로 선점한다. 백그라운드 번역이 도는 중에 운영자가
          // "판매"를 다시 누르면 2차 실행이 겹치는데, 위 건너뛰기 목록은
          // TRANSLATING 을 일부러 제외하므로(중단 흔적 재개) 1차가 작업 중인
          // 자산을 2차가 또 집는다 — 1차 결과는 아직 캐시에 없어 미스가 나고
          // 같은 원본에 유료 호출이 두 번 나간다(30장이면 ~$2).
          const claim = await assetLock.run(a.id, () => runAssetTranslation(a));
          if (!claim.ran) {
            results[i] = "skipped";
            continue;
          }
          results[i] = claim.value.result;
        } catch (e) {
          console.warn(`[import] 이미지 번역 실패 ${a.url}: ${e instanceof Error ? e.message : e}`);
          results[i] = "failed";
        }
      }
    }),
  );
  for (const r of results) {
    if (r === "verified") report.verified += 1;
    else if (r === "review" || r === "retryable") report.review += 1;
    else if (r === "failed") report.failed += 1;
    else report.skipped += 1;
  }

  if (report.verified > 0) {
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { image: true },
    });
    if (product?.image) {
      const moved = await db.productAsset.findFirst({
        where: { productId, originalUrl: product.image, translateStatus: TRANSLATE_STATUS.VERIFIED },
        select: { url: true },
      });
      // 원본 파일은 지우지 않는다 — originalUrl 이 가리키고 있어 복원에 쓴다
      if (moved) await db.product.update({ where: { id: productId }, data: { image: moved.url } });
    }
  }

  // 판매 전환 요청이 걸려 있으면 검증 완료 여부를 보고 승격한다
  await promoteIfReady(productId);

  return report;
}
