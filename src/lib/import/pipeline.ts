import "server-only";
import { db } from "@/lib/db";
import { parse1688 } from "./parse1688";
import { parseDomestic } from "./parseDomestic";
import { mirrorImages } from "./mirror";
import { translateDraft, asIsDraft } from "./translate";
import { sourceById, sourceForUrl, type SourceSite } from "./sources";
import { PLACEHOLDER_BRAND } from "@/lib/productPublishGate";
import type { ImportPayload, ParseResult } from "./types";

/**
 * 수집 파이프라인: payload → 파싱 → 이미지 미러링 → AI 번역 → 상품 초안 생성.
 * 생성된 상품은 항상 HIDDEN — 가격은 사람이 확정해야 하므로 자동 판매 전환하지 않는다.
 */

/** 매입 단가는 참고용으로만 쓰고, 판매가는 관리자가 직접 넣는다. */
const PLACEHOLDER_TIER = { minQty: 1, unitPrice: 0 };

/** 설명 끝에 붙일 매입가 메모. 통화 기호와 안내 문구가 도매처마다 다르다. */
export function supplyPriceNote(
  tiers: { price: number }[],
  label: string,
  currency: "CNY" | "KRW",
): string {
  const prices = tiers.map((t) => t.price).filter((p) => p > 0);
  if (prices.length === 0) return "";
  const unit = currency === "KRW" ? "원" : "";
  const sign = currency === "KRW" ? "" : "¥";
  const fmt = (n: number) => `${sign}${n.toLocaleString("ko-KR")}${unit}`;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const range = hi > lo ? `${fmt(lo)} ~ ${fmt(hi)}` : fmt(lo);
  const memo = currency === "KRW" ? "매입가 — 도매가 산정용" : "위안화 원가 — 도매가 산정용";
  return `\n\n[${label} 참고가] ${range} (${memo})`;
}

export interface MirroredRow {
  url: string;
  bytes: number;
}

/**
 * 자산 행 생성 — sortOrder 를 **종류를 가로질러 하나의 연속 번호**로 매긴다.
 *
 * 예전에는 대표·상세·옵션이 각각 0번부터 시작해 번호가 서로 겹쳤다. 정렬이
 * sortOrder 하나뿐이라 같은 번호끼리는 순서가 매번 달라졌고, 1688 에서 1,2,3,4,5
 * 순이던 이미지가 어드민·상세페이지에서 1,4,3,2,5 처럼 뒤섞여 보였다(실제 발생).
 * 대표 → 상세 → 옵션 순으로 이어 붙여 원본 순서를 그대로 보존한다.
 */
export function buildAssetRows(
  main: MirroredRow[],
  detail: MirroredRow[],
  option: MirroredRow[],
): { kind: string; url: string; bytes: number; sortOrder: number }[] {
  const rows: { kind: string; url: string; bytes: number; sortOrder: number }[] = [];
  const push = (kind: string, list: MirroredRow[]) => {
    for (const i of list) {
      rows.push({
        kind: kind === "DETAIL" && i.url.endsWith(".gif") ? "GIF" : kind,
        url: i.url,
        bytes: i.bytes,
        sortOrder: rows.length,
      });
    }
  };
  push("MAIN", main);
  push("DETAIL", detail);
  push("OPTION", option);
  return rows;
}

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

/**
 * payload 가 어느 도매처 것인지 판별한다.
 *
 * URL 이 정본이고, 북마클릿이 함께 보낸 site 는 보조다 — 쿼리형 주소나
 * 서브도메인 때문에 URL 판별이 빗나갈 때를 위한 것. **등록된 목록과 대조한
 * 뒤에만 신뢰한다**: payload 는 외부에서 오므로 site 를 그대로 믿으면
 * 임의 문자열로 이미지 화이트리스트를 우회당한다.
 */
/** 리퍼러용 오리진. 주소가 깨져 있어도 미러링 자체를 멈추지 않는다. */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin + "/";
  } catch {
    return undefined;
  }
}

export function siteForPayload(payload: ImportPayload): SourceSite | null {
  return sourceForUrl(String(payload.url ?? "")) ?? sourceById(String(payload.site ?? ""));
}

/**
 * 도매처별 파서 선택.
 *
 * 판별 실패 시 1688 파서로 떨어뜨린다 — URL 없이 HTML 만 붙여넣는 기존
 * 폴백 경로(1688 전용)를 그대로 살리기 위해서다.
 */
function parseFor(payload: ImportPayload, site: SourceSite | null): ParseResult {
  return site && site.id !== "1688" ? parseDomestic(payload, site) : parse1688(payload);
}

export async function runImport(payload: ImportPayload): Promise<ImportOutcome> {
  const parsed = parseFor(payload, siteForPayload(payload));

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
    // 국내 도매처는 원문이 이미 한국어라 번역기를 태우지 않는다
    const site = sourceById(draft.source);
    // 이미지 화이트리스트·리퍼러는 도매처마다 다르다.
    // 1688 과 미판별 건은 옵션을 비워 **기존 동작 그대로** 둔다 — 국내 도매처를
    // 붙이면서 이미 돌던 경로가 조용히 달라지는 일이 없어야 한다.
    const mirrorOpts =
      site && site.id !== "1688"
        ? { imageHost: site.imageHost, referer: originOf(draft.sourceUrl) }
        : {};
    const [mainReport, detailReport, optionReport, translation] = await Promise.all([
      mirrorImages(draft.mainImages, mirrorOpts),
      mirrorImages(draft.detailImages, mirrorOpts),
      mirrorImages(draft.optionImages, mirrorOpts),
      site?.translate === false ? Promise.resolve(asIsDraft(draft)) : translateDraft(draft),
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

    // 매입가를 설명 끝에 참고로 남긴다 — 도매가를 정할 때 원본 사이트를
    // 다시 열어보지 않아도 되게. 판매가 자동 책정에는 쓰지 않는다.
    const refPrice = supplyPriceNote(draft.tiers, site?.label ?? draft.source, site?.currency ?? "CNY");
    const description = (translation.description + refPrice).slice(0, 4000);

    // 번역이 찍어준 카테고리가 실제로 있는 것인지 확인한다.
    // 없는 slug 를 그대로 쓰면 조인 테이블 저장이 FK 로 터져 수집 전체가 실패한다.
    const guessed = translation.categorySlug || "idea";
    const known = await db.category.findUnique({ where: { slug: guessed }, select: { slug: true } });
    const categorySlug = known?.slug ?? (await db.category.findFirst({ orderBy: { sortOrder: "asc" }, select: { slug: true } }))?.slug;

    const product = await db.product.create({
      data: {
        name: translation.name,
        // 수집 시점엔 브랜드를 모른다. 자리표시자로 들어가지만 그대로는 판매
        // 전환도 노출도 안 된다 (productPublishGate·브랜드관·상품 상세가 걸러낸다)
        brand: PLACEHOLDER_BRAND,
        categorySlug: categorySlug ?? guessed,
        // 카테고리를 못 찾으면 링크 없이 만든다 — 상품은 어차피 HIDDEN 이고
        // 운영자가 가격을 넣을 때 카테고리도 함께 고르게 된다
        ...(categorySlug ? { categories: { create: [{ categorySlug }] } } : {}),
        description,
        image: mainReport.images[0]?.url ?? detailReport.images[0]?.url ?? "",
        basePrice: 0,
        status: "HIDDEN", // 가격 확정 전까지 노출 금지
        sourceUrl: draft.sourceUrl,
        sourceId: draft.sourceId,
        priceTiers: { create: [PLACEHOLDER_TIER] },
        assets: { create: buildAssetRows(mainReport.images, detailReport.images, optionReport.images) },
      },
    });

    // 부분 실패(번역 안 됨·이미지 일부 실패)의 사유를 기록에 남긴다 —
    // 안 남기면 "왜 번역이 안 됐지?"를 나중에 추적할 방법이 없다(실제 겪음)
    const partialIssues = [
      translation.translated ? null : `번역 실패: ${translation.note ?? "사유 미상"}`,
      failures.length > 0 ? `일부 이미지 실패 ${failures.length}건` : null,
    ].filter(Boolean);

    await db.importJob.update({
      where: { id: job.id },
      data: {
        status: "DONE",
        koTitle: translation.name,
        imageCount:
          mainReport.images.length + detailReport.images.length + optionReport.images.length,
        productId: product.id,
        error: partialIssues.length > 0 ? partialIssues.join(" / ").slice(0, 500) : null,
      },
    });

    // 이미지 속 중국어 번역은 여기서 돌리지 않는다 — 수집 상품은 숨김으로
    // 들어오고 상당수는 판매까지 가지 않는데, 수집 시점에 다 번역하면 안 파는
    // 상품 번역비까지 나간다(장당 ~$0.05, 실제 크레딧 소진 사고). "판매" 전환
    // 시점(setProductStatus)에 자동으로 돌린다.
    return {
      ok: true,
      jobId: job.id,
      productId: product.id,
      message:
        site?.translate === false
          ? `수집 완료: ${translation.name}`
          : `수집 완료: ${translation.name} — 이미지 번역은 판매 전환 시 자동 실행됩니다.`,
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
