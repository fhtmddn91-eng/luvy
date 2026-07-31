import Link from "next/link";
import { db } from "@/lib/db";
import { ProductGrid } from "@/components/product/ProductGrid";
import { Icon } from "@/components/ui/Icon";

/**
 * 메인 "신상품" 그리드.
 *
 * 예전에는 가로 레일(150px 카드)이었는데, 좁은 화면에서 스크롤 신호가 없어
 * 두세 개만 보이고 끝이었다. 시안대로 그리드로 바꿔 한눈에 들어오게 한다.
 */
export async function NewProducts() {
  const products = await db.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { priceTiers: true },
  });

  if (products.length === 0) return null;

  return (
    <section className="mx-auto max-w-[1280px] px-6 pb-10">
      <div className="mb-4 flex items-end justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[22px] font-extrabold text-ink">신상품</h2>
          <p className="hidden text-[13px] text-muted sm:block">새로 들어온 상품</p>
        </div>
        <Link
          href="/new"
          className="flex items-center gap-0.5 text-[13px] font-semibold text-muted transition-colors hover:text-brand-500"
        >
          더보기
          <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2} />
        </Link>
      </div>

      <ProductGrid products={products} />
    </section>
  );
}
