import { db } from "@/lib/db";
import { ProductGrid } from "@/components/product/ProductGrid";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const products = query
    ? await db.product.findMany({
        where: {
          status: "ACTIVE",
          OR: [{ name: { contains: query } }, { brand: { contains: query } }],
        },
        include: { priceTiers: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10">
      <h1 className="mb-1 text-[24px] font-extrabold text-ink">
        {query ? `‘${query}’ 검색 결과` : "검색어를 입력해주세요"}
      </h1>
      <p className="mb-6 text-[13px] text-muted">{products.length}개 상품</p>
      <ProductGrid products={products} />
    </div>
  );
}
