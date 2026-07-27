import { db } from "@/lib/db";
import { ProductGrid } from "@/components/product/ProductGrid";

export default async function NewProductsPage() {
  const products = await db.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { priceTiers: true },
  });

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10">
      <p className="text-[13px] font-semibold text-brand-500">NEW ARRIVALS</p>
      <h1 className="mt-1 text-[28px] font-extrabold text-ink">신상품</h1>
      <p className="mb-6 mt-1 text-[13px] text-muted">{products.length}개 상품</p>
      <ProductGrid products={products} />
    </div>
  );
}
