import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getAllCategories } from "@/lib/categories";
import { ProductThumb } from "@/components/product/ProductThumb";
import { PriceTierTable } from "@/components/product/PriceTierTable";
import { AddToCart } from "@/components/product/AddToCart";
import { getMoq } from "@/lib/pricing";
import { AssetDownloads } from "@/components/product/AssetDownloads";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await db.product.findUnique({
    where: { id },
    include: { priceTiers: true, assets: { orderBy: { sortOrder: "asc" } } },
  });
  if (!product || product.status !== "ACTIVE") notFound();

  // 숨긴 카테고리의 기존 상품도 이름은 표시되어야 하므로 전체 목록에서 찾는다
  const category = (await getAllCategories()).find((c) => c.slug === product.categorySlug);
  const moq = getMoq(product.priceTiers);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-10">
      <div className="grid gap-10 lg:grid-cols-2">
        <ProductThumb
          id={product.id}
          brand={product.brand}
          image={product.image}
          alt={product.name}
          className="aspect-square w-full rounded-2xl"
        />
        <div>
          <p className="text-[13px] font-semibold text-brand-500">
            {product.brand}{category ? ` · ${category.name}` : ""}
          </p>
          <h1 className="mt-2 text-[26px] font-extrabold leading-snug text-ink">{product.name}</h1>
          {/* 품번 — 거래처가 발주서에 적는 값이라 상세에 노출한다 */}
          {product.sku && (
            <p className="mt-1.5 text-[13px] text-muted">
              품번 <span className="font-semibold text-ink-soft">{product.sku}</span>
            </p>
          )}
          <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">{product.description}</p>

          <div className="mt-8">
            <h2 className="mb-3 text-[15px] font-bold text-ink">수량별 도매가</h2>
            <PriceTierTable tiers={product.priceTiers} />
          </div>

          <div className="mt-8">
            <AddToCart
              productId={product.id}
              tiers={product.priceTiers}
              moq={moq}
              stockInfo={{ trackStock: product.trackStock, stock: product.stock }}
            />
          </div>
        </div>
      </div>

      {/* 상세페이지 — 업로드된 이미지·GIF 를 순서대로 이어 붙인다 */}
      {product.assets.length > 0 && (
        <section className="mx-auto mt-12 max-w-[860px]">
          <h2 className="mb-4 border-b border-line pb-3 text-[16px] font-bold text-ink">
            상품 상세
          </h2>
          <div>
            {product.assets.map((a, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={a.id}
                src={a.url}
                alt={`${product.name} 상세 ${i + 1}`}
                loading={i < 2 ? "eager" : "lazy"}
                className="block w-full"
              />
            ))}
          </div>
        </section>
      )}

      <AssetDownloads
        assets={product.assets.map((a) => ({
          id: a.id,
          kind: a.kind,
          url: a.url,
          bytes: a.bytes,
        }))}
      />
    </div>
  );
}
