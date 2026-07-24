import Link from "next/link";
import { db } from "@/lib/db";
import { ProductGrid } from "@/components/product/ProductGrid";
import { Icon } from "@/components/ui/Icon";

export default async function EventsPage() {
  const [newest, sold] = await Promise.all([
    db.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { priceTiers: true },
    }),
    db.orderItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 8,
    }),
  ]);

  const rankedIds = sold.map((s) => s.productId);
  const ranked = rankedIds.length
    ? await db.product.findMany({
        where: { id: { in: rankedIds }, status: "ACTIVE" },
        include: { priceTiers: true },
      })
    : [];
  const byRank = new Map(rankedIds.map((id, i) => [id, i]));
  const best = ranked.sort((a, b) => (byRank.get(a.id) ?? 0) - (byRank.get(b.id) ?? 0));

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6">
      <p className="text-[13px] font-semibold text-brand-500">EVENT</p>
      <h1 className="mt-1 text-[26px] font-extrabold text-ink sm:text-[28px]">기획전</h1>
      <p className="mb-8 mt-1 text-[14px] text-muted">지금 진행 중인 혜택과 테마 기획전을 확인하세요.</p>

      {/* 상시 혜택 배너 */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 p-6">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/80 text-brand-500">
            <Icon name="gift" className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-[16px] font-extrabold text-ink">신규 가입 시 10,000P 즉시 지급</p>
            <p className="mt-0.5 text-[13px] text-ink-soft">
              첫 주문부터 사용 가능한 웰컴 포인트 — 승인 완료 시 자동 지급됩니다.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-[#F3EFFB] to-[#E7DFF7] p-6">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/80 text-brand-500">
            <Icon name="download" className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-[16px] font-extrabold text-ink">판매자료 전 상품 무료 제공</p>
            <p className="mt-0.5 text-[13px] text-ink-soft">
              상세페이지·썸네일 원본 제공 —{" "}
              <Link href="/partner" className="font-semibold text-brand-600 underline">
                파트너센터에서 확인
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* 신상품 기획전 */}
      <section className="mt-12">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-[20px] font-extrabold text-ink">이번주 신상품 기획전</h2>
            <p className="mt-0.5 text-[13px] text-muted">새로 입고된 상품을 가장 먼저 만나보세요.</p>
          </div>
          <Link href="/new" className="flex items-center gap-0.5 text-[13px] font-semibold text-muted hover:text-brand-500">
            전체 보기
            <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>
        <ProductGrid products={newest} />
      </section>

      {/* 베스트 기획전 */}
      {best.length > 0 && (
        <section className="mt-12">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-[20px] font-extrabold text-ink">많이 팔리는 상품 기획전</h2>
              <p className="mt-0.5 text-[13px] text-muted">파트너들이 가장 많이 발주한 검증된 상품.</p>
            </div>
            <Link href="/best" className="flex items-center gap-0.5 text-[13px] font-semibold text-muted hover:text-brand-500">
              전체 보기
              <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2} />
            </Link>
          </div>
          <ProductGrid products={best} />
        </section>
      )}
    </div>
  );
}
