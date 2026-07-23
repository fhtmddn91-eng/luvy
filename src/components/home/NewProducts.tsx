import Link from "next/link";
import { db } from "@/lib/db";
import { won } from "@/lib/format";
import { getMoq, resolveUnitPrice, type Tier } from "@/lib/pricing";
import { ProductThumb } from "@/components/product/ProductThumb";
import { Icon } from "@/components/ui/Icon";

/** 메인 "이번주 신상품" 가로 레일 */
export async function NewProducts() {
  const products = await db.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { priceTiers: true },
  });

  if (products.length === 0) return null;

  return (
    <section className="mx-auto max-w-[1280px] px-6 py-10">
      <div className="mb-4 flex items-end justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[22px] font-extrabold text-ink">이번주 신상품</h2>
          <p className="hidden text-[13px] text-muted sm:block">
            오늘 업데이트된 따끈따끈한 신상품
          </p>
        </div>
        <Link
          href="/new"
          className="flex items-center gap-0.5 text-[13px] font-semibold text-muted transition-colors hover:text-brand-500"
        >
          더보기
          <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2} />
        </Link>
      </div>

      <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {products.map((p) => {
          const tiers = p.priceTiers as Tier[];
          const price = resolveUnitPrice(tiers, getMoq(tiers));
          return (
            <Link
              key={p.id}
              href={`/products/${p.id}`}
              className="group w-[150px] shrink-0"
            >
              <div className="relative overflow-hidden rounded-xl border border-line">
                <ProductThumb id={p.id} brand={p.brand} image={p.image} alt={p.name} className="aspect-square w-full" />
                <span className="absolute left-2 top-2 rounded-pill bg-brand-500 px-2 py-0.5 text-[10px] font-extrabold text-white">
                  NEW
                </span>
              </div>
              <p className="mt-2 line-clamp-1 text-[13px] font-medium text-ink group-hover:text-brand-600">
                {p.name}
              </p>
              <p className="mt-0.5 text-[15px] font-extrabold text-ink">{won(price)}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
