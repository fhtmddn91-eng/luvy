import Link from "next/link";
import { db } from "@/lib/db";
import { ProductThumb } from "@/components/product/ProductThumb";
import { Icon } from "@/components/ui/Icon";

export default async function BrandsPage() {
  const products = await db.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, brand: true, image: true },
  });

  // 브랜드별 그룹 (상품 많은 순)
  const byBrand = new Map<string, typeof products>();
  for (const p of products) {
    const list = byBrand.get(p.brand) ?? [];
    list.push(p);
    byBrand.set(p.brand, list);
  }
  const brands = [...byBrand.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6">
      <p className="text-[13px] font-semibold text-brand-500">BRAND</p>
      <h1 className="mt-1 text-[26px] font-extrabold text-ink sm:text-[28px]">브랜드관</h1>
      <p className="mb-8 mt-1 text-[14px] text-muted">
        LUVY가 취급하는 {brands.length}개 브랜드를 둘러보세요.
      </p>

      {brands.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line py-16 text-center text-[14px] text-muted">
          등록된 브랜드가 없습니다.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map(([brand, items]) => (
            <Link
              key={brand}
              href={`/search?q=${encodeURIComponent(brand)}`}
              className="group rounded-2xl border border-line bg-white p-5 transition-shadow hover:shadow-[var(--shadow-card)]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[18px] font-extrabold tracking-tight text-ink group-hover:text-brand-600">
                    {brand}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">{items.length}개 상품</p>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-500 transition-transform group-hover:translate-x-0.5">
                  <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2.2} />
                </span>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {items.slice(0, 4).map((p) => (
                  <ProductThumb
                    key={p.id}
                    id={p.id}
                    brand={p.brand}
                    image={p.image || undefined}
                    alt={p.name}
                    className="aspect-square w-full rounded-lg text-[8px]"
                  />
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
