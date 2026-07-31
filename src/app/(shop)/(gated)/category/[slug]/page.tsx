import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCategories, selfAndDescendantSlugs } from "@/lib/categories";
import { categoryHref } from "@/lib/nav";
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

  const all = await getCategories();
  const category = all.find((c) => c.slug === slug);
  if (!category) notFound();

  // 세부 카테고리에 들어와 있어도 형제 목록을 보여줘야 옆으로 이동할 수 있다
  const parent = category.parentSlug
    ? all.find((c) => c.slug === category.parentSlug)
    : category;
  const siblings = parent ? all.filter((c) => c.parentSlug === parent.slug) : [];

  // 대분류를 열면 그 아래 세부 카테고리 상품까지 전부 나온다
  const slugs = await selfAndDescendantSlugs(slug);

  const products = await db.product.findMany({
    // 대표 카테고리가 아니라 조인 테이블 기준 — 한 상품이 여러 매대에 걸릴 수 있다
    where: { status: "ACTIVE", categories: { some: { categorySlug: { in: slugs } } } },
    orderBy: orderByFor(sort),
    include: { priceTiers: true },
  });

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-[13px] font-semibold text-brand-500">
            {parent && parent.slug !== slug ? parent.name : "CATEGORY"}
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold text-ink">{category.name}</h1>
          <p className="mt-1 text-[13px] text-muted">{products.length}개 상품</p>
        </div>
        <SortSelect />
      </div>

      {/* 세부 카테고리 이동 */}
      {parent && siblings.length > 0 && (
        <nav aria-label="세부 카테고리" className="mb-6 flex flex-wrap gap-2">
          {[parent, ...siblings].map((c) => {
            const current = c.slug === slug;
            return (
              <Link
                key={c.slug}
                href={categoryHref(c.slug)}
                aria-current={current ? "page" : undefined}
                className={
                  current
                    ? "rounded-pill bg-brand-500 px-4 py-1.5 text-[13px] font-bold text-white"
                    : "rounded-pill border border-line bg-white px-4 py-1.5 text-[13px] font-semibold text-ink-soft transition-colors hover:border-brand-300 hover:text-brand-600"
                }
              >
                {c.slug === parent.slug ? "전체" : c.name}
              </Link>
            );
          })}
        </nav>
      )}

      <ProductGrid products={products} />
    </div>
  );
}
