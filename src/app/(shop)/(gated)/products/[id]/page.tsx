import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getAllCategories } from "@/lib/categories";
import { PriceTierTable } from "@/components/product/PriceTierTable";
import { AddToCart } from "@/components/product/AddToCart";
import { getMoq, resolveUnitPrice } from "@/lib/pricing";
import { won } from "@/lib/format";
import { AssetDownloads } from "@/components/product/AssetDownloads";
import { ProductGallery } from "@/components/product/ProductGallery";
import { WishButton } from "@/components/product/WishButton";
import { RecentViewTracker } from "@/components/product/RecentViewTracker";
import { requireApprovedUser } from "@/lib/auth";
import { isWished } from "@/lib/wishlist";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await db.product.findUnique({
    where: { id },
    include: { priceTiers: true, assets: { orderBy: { sortOrder: "asc" } } },
  });
  if (!product || product.status !== "ACTIVE") notFound();

  const user = await requireApprovedUser();
  // 숨긴 카테고리의 기존 상품도 이름은 표시되어야 하므로 전체 목록에서 찾는다
  const category = (await getAllCategories()).find((c) => c.slug === product.categorySlug);
  const moq = getMoq(product.priceTiers);
  const wholesale = resolveUnitPrice(product.priceTiers, moq);
  // 상세 이미지가 하나도 없는(직접 등록한) 옛 상품은 있는 자료를 그대로 보여준다
  const onlyDetail = product.assets.filter((a) => a.kind === "DETAIL" || a.kind === "GIF");
  const detailAssets = onlyDetail.length > 0 ? onlyDetail : product.assets;
  // 대표이미지가 없으면 썸네일 한 장이라도 보여준다
  const mainImages = product.assets.filter((a) => a.kind === "MAIN").map((a) => a.url);
  const gallery = mainImages.length > 0 ? mainImages : product.image ? [product.image] : [];
  const wished = await isWished(user.id, product.id);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-10">
      <RecentViewTracker id={product.id} name={product.name} image={gallery[0] ?? ""} />
      <div className="grid gap-10 lg:grid-cols-2">
        <ProductGallery
          id={product.id}
          brand={product.brand}
          name={product.name}
          images={gallery}
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

          {/* 권장 판매가 ↔ 공급가. 거래처는 "얼마에 받아 얼마에 파는지"를 먼저 본다 */}
          <dl className="mt-6 space-y-1.5 border-t border-line pt-5 text-[15px]">
            {product.basePrice > 0 && (
              <div className="flex items-baseline gap-3">
                <dt className="w-[74px] shrink-0 text-[13px] text-muted">권장 판매가</dt>
                <dd className="font-semibold text-ink-soft">{won(product.basePrice)}</dd>
              </div>
            )}
            <div className="flex items-baseline gap-3">
              <dt className="w-[74px] shrink-0 text-[13px] text-muted">공급가</dt>
              <dd className="text-[20px] font-extrabold text-brand-600">
                {won(wholesale)}
                {product.priceTiers.length > 1 && (
                  <span className="ml-1 text-[13px] font-semibold text-muted">부터</span>
                )}
              </dd>
            </div>
          </dl>

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
            <div className="mt-3">
              <WishButton productId={product.id} initial={wished} />
            </div>
          </div>
        </div>
      </div>

      {/* 상세페이지 — 상세 이미지·GIF 만 순서대로 이어 붙인다.
          대표이미지까지 여기 깔면 관리자에서 본 썸네일과 화면이 어긋나 보인다
          (수집 상품은 대표만 10장이라 상세가 대표로 뒤덮였다). */}
      {detailAssets.length > 0 && (
        <section className="mx-auto mt-12 max-w-[860px]">
          <h2 className="mb-4 border-b border-line pb-3 text-[16px] font-bold text-ink">
            상품 상세
          </h2>
          <div>
            {detailAssets.map((a, i) => (
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
        productId={product.id}
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
