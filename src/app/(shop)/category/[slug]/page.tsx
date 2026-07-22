import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { categories } from "@/lib/mock/categories";
import { ProductGrid } from "@/components/product/ProductGrid";
import { SortSelect } from "@/components/product/SortSelect";

const orderByFor = (sort?: string) => {
  if (sort === "priceAsc") return { basePrice: "asc" as const };
  if (sort === "priceDesc") return { basePrice: "desc" as const };
  return { createdAt: "desc" as const };
};

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { slug } = await params;
  const { sort } = await searchParams;
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const products = await db.product.findMany({
    where: { categorySlug: slug, status: "ACTIVE" },
    orderBy: orderByFor(sort),
    include: { priceTiers: true },
  });

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-[13px] font-semibold text-brand-500">CATEGORY</p>
          <h1 className="mt-1 text-[28px] font-extrabold text-ink">{category.name}</h1>
          <p className="mt-1 text-[13px] text-muted">{products.length}개 상품</p>
        </div>
        <SortSelect />
      </div>
      <ProductGrid products={products} />
    </div>
  );
}
