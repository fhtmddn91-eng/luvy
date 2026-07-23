import { db } from "@/lib/db";
import { ProductGrid } from "@/components/product/ProductGrid";

export default async function BestProductsPage() {
  // 주문된 수량 기준 인기 순위. 판매 데이터가 없으면 최신순으로 채운다.
  const sold = await db.orderItem.groupBy({
    by: ["productId"],
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 40,
  });
  const rankedIds = sold.map((s) => s.productId);

  const [ranked, latest] = await Promise.all([
    rankedIds.length
      ? db.product.findMany({
          where: { id: { in: rankedIds }, status: "ACTIVE" },
          include: { priceTiers: true },
        })
      : Promise.resolve([]),
    db.product.findMany({
      where: { status: "ACTIVE", ...(rankedIds.length ? { id: { notIn: rankedIds } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { priceTiers: true },
    }),
  ]);

  const byRank = new Map(rankedIds.map((id, i) => [id, i]));
  const products = [
    ...ranked.sort((a, b) => (byRank.get(a.id) ?? 0) - (byRank.get(b.id) ?? 0)),
    ...latest,
  ].slice(0, 40);

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10">
      <p className="text-[13px] font-semibold text-brand-500">BEST</p>
      <h1 className="mt-1 text-[28px] font-extrabold text-ink">인기상품</h1>
      <p className="mb-6 mt-1 text-[13px] text-muted">구매량 높은 인기 상품</p>
      <ProductGrid products={products} />
    </div>
  );
}
