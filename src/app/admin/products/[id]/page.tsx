import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ProductForm } from "@/components/admin/ProductForm";
import { updateProduct } from "@/lib/actions/admin-products";
import { PageHeader, Panel } from "@/components/ui/Panel";
import { getAllCategories } from "@/lib/categories";
import { ProductAssetsManager } from "@/components/admin/ProductAssetsManager";
import { safeAdminReturnPath } from "@/lib/adminReturnPath";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /**
   * editAsset: 검수함 "문구 수정 열기" 딥링크 — 해당 이미지의 편집기를 바로 연다
   * back: 목록이 실어 보낸 "돌아갈 목록 주소" (페이지·검색 포함). 저장·취소 뒤 그리로 간다
   */
  searchParams: Promise<{ editAsset?: string; back?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { editAsset, back } = await searchParams;
  const backHref = safeAdminReturnPath(back, "/admin/products");
  const product = await db.product.findUnique({
    where: { id },
    include: {
      priceTiers: true,
      options: { orderBy: { sortOrder: "asc" } },
      assets: { orderBy: { sortOrder: "asc" } },
      categories: { select: { categorySlug: true } },
    },
  });
  if (!product) notFound();

  const boundAction = updateProduct.bind(null, id);

  return (
    <div>
      <PageHeader eyebrow="Catalog" title="상품 수정" description={product.name} />
      <ProductForm
        action={boundAction}
        backHref={backHref}
        categories={await getAllCategories()}
        product={{
          id: product.id,
          name: product.name,
          brand: product.brand,
          categorySlug: product.categorySlug,
          sku: product.sku,
          categorySlugs: product.categories.map((c) => c.categorySlug),
          description: product.description,
          basePrice: product.basePrice,
          options: product.options.map((o) => ({
            name: o.name,
            unitPrice: o.unitPrice,
            trackStock: o.trackStock,
            stock: o.stock,
          })),
          status: product.status,
          trackStock: product.trackStock,
          stock: product.stock,
          image: product.image || undefined,
          priceTiers: product.priceTiers.map((t) => ({ minQty: t.minQty, unitPrice: t.unitPrice })),
        }}
      />

      <div className="mt-6">
        <Panel
          title={`상품 이미지 (대표 ${product.assets.filter((a) => a.kind === "MAIN").length} · 상세 ${product.assets.filter((a) => a.kind !== "MAIN").length})`}
        >
          <ProductAssetsManager
            initialEditAssetId={editAsset ?? null}
            productId={product.id}
            assets={product.assets.map((a) => ({
              id: a.id,
              kind: a.kind,
              url: a.url,
              bytes: a.bytes,
              originalUrl: a.originalUrl,
              // 거부·검수 대기 장은 좌표가 candidateOcr 에 있다 — 문구 수정 편집기가
              // 그런 장도 열 수 있게 둘 중 있는 쪽을 넘긴다 (서버 액션도 같은 폴백)
              ocrData: a.ocrData ?? a.candidateOcr,
              translateStatus: a.translateStatus,
              reviewReasons: a.reviewReasons,
              candidateUrl: a.candidateUrl,
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}
