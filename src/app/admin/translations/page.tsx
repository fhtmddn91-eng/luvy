import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { REVIEWABLE_TRANSLATE_STATUSES } from "@/lib/productPublishGate";
import { PageHeader, Panel, EmptyState } from "@/components/ui/Panel";
import { TranslationReviewList } from "@/components/admin/TranslationReviewList";

/**
 * 번역 검수함 — 전 상품의 확인 대기 이미지를 한 페이지에 모은다.
 *
 * 실사례(2026-08-30 피드백): 검수 대상이 상품마다 흩어져 있어 운영자가 목록에서
 * 주황 글씨를 눈으로 찾고 → 상품 들어가고 → 스크롤하는 동선을 상품 수만큼
 * 반복했다. 초보 운영자 1명이 아침에 이 페이지 하나만 위에서부터 훑으면 끝나야 한다.
 *
 * 대상 상태는 REVIEWABLE_TRANSLATE_STATUSES — TRANSLATING 은 진행 중이라 뺀다.
 */

export default async function AdminTranslationsPage() {
  await requireAdmin();

  const rows = await db.productAsset.findMany({
    where: { translateStatus: { in: REVIEWABLE_TRANSLATE_STATUSES } },
    orderBy: [{ productId: "asc" }, { sortOrder: "asc" }],
    select: {
      id: true,
      kind: true,
      url: true,
      originalUrl: true,
      candidateUrl: true,
      translateStatus: true,
      reviewReasons: true,
      ocrData: true,
      candidateOcr: true,
      product: { select: { id: true, name: true } },
    },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="번역 검수"
        description={
          rows.length === 0
            ? "확인할 이미지가 없습니다."
            : `확인이 필요한 이미지 ${rows.length}장 — 원본과 번역본을 비교하고 괜찮으면 내보내세요.`
        }
      />
      <Panel title={`확인 대기 (${rows.length}장)`}>
        {rows.length === 0 ? (
          <EmptyState>지금은 확인할 이미지가 없습니다. 번역이 검수로 분류되면 여기에 모입니다.</EmptyState>
        ) : (
          <TranslationReviewList
            items={rows.map((r) => ({
              id: r.id,
              kind: r.kind,
              url: r.url,
              originalUrl: r.originalUrl,
              candidateUrl: r.candidateUrl,
              translateStatus: r.translateStatus,
              reviewReasons: r.reviewReasons,
              hasBoxes: Boolean(r.ocrData ?? r.candidateOcr),
              productId: r.product.id,
              productName: r.product.name,
            }))}
          />
        )}
      </Panel>
    </div>
  );
}
