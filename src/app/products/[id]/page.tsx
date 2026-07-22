import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { categories } from "@/lib/mock/categories";
import { ProductThumb } from "@/components/product/ProductThumb";
import { PriceTierTable } from "@/components/product/PriceTierTable";
import { AddToCart } from "@/components/product/AddToCart";
import { getMoq } from "@/lib/pricing";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await db.product.findUnique({ where: { id }, include: { priceTiers: true } });
  if (!product || product.status !== "ACTIVE") notFound();

  const category = categories.find((c) => c.slug === product.categorySlug);
  const moq = getMoq(product.priceTiers);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-10">
      <div className="grid gap-10 lg:grid-cols-2">
        <ProductThumb id={product.id} brand={product.brand} className="aspect-square w-full rounded-2xl" />
        <div>
          <p className="text-[13px] font-semibold text-brand-500">
            {product.brand}{category ? ` · ${category.name}` : ""}
          </p>
          <h1 className="mt-2 text-[26px] font-extrabold leading-snug text-ink">{product.name}</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">{product.description}</p>

          <div className="mt-8">
            <h2 className="mb-3 text-[15px] font-bold text-ink">수량별 도매가</h2>
            <PriceTierTable tiers={product.priceTiers} />
          </div>

          <div className="mt-8">
            <AddToCart productId={product.id} tiers={product.priceTiers} moq={moq} />
          </div>
        </div>
      </div>
    </div>
  );
}
