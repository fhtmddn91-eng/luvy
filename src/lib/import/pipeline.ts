import "server-only";
import { db } from "@/lib/db";
import { parse1688 } from "./parse1688";
import { mirrorImages } from "./mirror";
import { translateDraft } from "./translate";
import type { ImportPayload } from "./types";

/**
 * 수집 파이프라인: payload → 파싱 → 이미지 미러링 → AI 번역 → 상품 초안 생성.
 * 생성된 상품은 항상 HIDDEN — 가격은 사람이 확정해야 하므로 자동 판매 전환하지 않는다.
 */

/** CNY 단가는 참고용으로만 쓰고, 원화 판매가는 관리자가 직접 넣는다. */
const PLACEHOLDER_TIER = { minQty: 1, unitPrice: 0 };

export interface ImportOutcome {
  ok: boolean
  productId?: string;
  jobId: string;
  message: string;
  detail?: {
    koTitle: string;
    translated: boolean;
    translateNote?: string;
    mainCount: number;
    detailCount: number;
    gifCount: number;
    failures: { sourceUrl: string; reason: string }[];
  };
}

export async function runImport(payload: ImportPayload): Promise<ImportOutcome> {
  const parsed = parse1688(payload);

  if (!parsed.ok) {
    const job = await db.importJob.create({
      data: {
        sourceId: "unknown",
        sourceUrl: String(payload.url ?? ""),
        status: "FAILED",
        error: parsed.error,
      },
    });
    return { ok: false, jobId: job.id, message: parsed.error };
  }

  const draft = parsed.draft;

  // 같은 1688 상품을 두 번 등록하지 않는다
  const existing = await db.product.findUnique({ where: { sourceId: draft.sourceId } });
  if (existing) {
    const job = await db.importJob.create({
      data: {
        sourceId: draft.sourceId,
        sourceUrl: draft.sourceUrl,
        status: "FAILED",
        rawTitle: draft.rawTitle,
        error: "이미 수집된 상품입니다.",
        productId: existing.id,
      },
    });
    return {
      ok: false,
      jobId: job.id,
      productId: existing.id,
      message: `이미 수집된 상품입니다: ${existing.name}`,
    };
  }

  const job = await db.importJob.create({
    data: {
      sourceId: draft.sourceId,
      sourceUrl: draft.sourceUrl,
      rawTitle: draft.rawTitle,
      status: "PENDING",
    },
  });

  try {
    // 이미지 미러링과 번역은 서로 독립이라 동시에 진행한다
    const [mainReport, detailReport, optionReport, translation] = await Promise.all([
      mirrorImages(draft.mainImages),
      mirrorImages(draft.detailImages),
      mirrorImages(draft.optionImages),
      translateDraft(draft),
    ]);

    const failures = [
      ...mainReport.failures,
      ...detailReport.failures,
      ...optionReport.failures,
    ];

    if (mainReport.images.length === 0 && detailReport.images.length === 0) {
      const reason =
        failures[0]?.reason ?? "이미지를 한 장도 내려받지 못했습니다.";
      await db.importJob.update({
        where: { id: job.id },
        data: { status: "FAILED", error: `이미지 미러링 실패: ${reason}` },
      });
      return { ok: false, jobId: job.id, message: `이미지 미러링 실패: ${reason}` };
    }

    const gifCount = [...mainReport.images, ...detailReport.images].filter((i) =>
      i.url.endsWith(".gif"),
    ).length;

    // 번역이 찍어준 카테고리가 실제로 있는 것인지 확인한다.
    // 없는 slug 를 그대로 쓰면 조인 테이블 저장이 FK 로 터져 수집 전체가 실패한다.
    const guessed = translation.categorySlug || "idea";
    const known = await db.category.findUnique({ where: { slug: guessed }, select: { slug: true } });
    const categorySlug = known?.slug ?? (await db.category.findFirst({ orderBy: { sortOrder: "asc" }, select: { slug: true } }))?.slug;

    const product = await db.product.create({
      data: {
        name: translation.name,
        brand: "미정",
        categorySlug: categorySlug ?? guessed,
        // 카테고리를 못 찾으면 링크 없이 만든다 — 상품은 어차피 HIDDEN 이고
        // 운영자가 가격을 넣을 때 카테고리도 함께 고르게 된다
        ...(categorySlug ? { categories: { create: [{ categorySlug }] } } : {}),
        description: translation.description,
        image: mainReport.images[0]?.url ?? detailReport.images[0]?.url ?? "",
        basePrice: 0,
        status: "HIDDEN", // 가격 확정 전까지 노출 금지
        sourceUrl: draft.sourceUrl,
        sourceId: draft.sourceId,
        priceTiers: { create: [PLACEHOLDER_TIER] },
        assets: {
          create: [
            ...mainReport.images.map((i, idx) => ({
              kind: "MAIN",
              url: i.url,
              bytes: i.bytes,
              sortOrder: idx,
            })),
            ...detailReport.images.map((i, idx) => ({
              kind: i.url.endsWith(".gif") ? "GIF" : "DETAIL",
              url: i.url,
              bytes: i.bytes,
              sortOrder: idx,
            })),
            ...optionReport.images.map((i, idx) => ({
              kind: "OPTION",
              url: i.url,
              bytes: i.bytes,
              sortOrder: idx,
            })),
          ],
        },
      },
    });

    await db.importJob.update({
      where: { id: job.id },
      data: {
        status: "DONE",
        koTitle: translation.name,
        imageCount:
          mainReport.images.length + detailReport.images.length + optionReport.images.length,
        productId: product.id,
        error: failures.length > 0 ? `일부 이미지 실패 ${failures.length}건` : null,
      },
    });

    return {
      ok: true,
      jobId: job.id,
      productId: product.id,
      message: `수집 완료: ${translation.name}`,
      detail: {
        koTitle: translation.name,
        translated: translation.translated,
        translateNote: translation.note,
        mainCount: mainReport.images.length,
        detailCount: detailReport.images.length,
        gifCount,
        failures,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.importJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: msg.slice(0, 500) },
    });
    return { ok: false, jobId: job.id, message: `수집 실패: ${msg}` };
  }
}
