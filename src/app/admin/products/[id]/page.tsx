import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ProductForm } from "@/components/admin/ProductForm";
import { updateProduct } from "@/lib/actions/admin-products";
import { PageHeader, Panel } from "@/components/ui/Panel";
import { getAllCategories } from "@/lib/categories";
import { ProductAssetsManager } from "@/components/admin/ProductAssetsManager";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const product = await db.product.findUnique({
    where: { id },
    include: {
      priceTiers: true,
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
          status: product.status,
          trackStock: product.trackStock,
          stock: product.stock,
          image: product.image || undefined,
          priceTiers: product.priceTiers.map((t) => ({ minQty: t.minQty, unitPrice: t.unitPrice })),
        }}
      />

      <div className="mt-6">
        <Panel title={`상세페이지 이미지 (${product.assets.length})`}>
          <ProductAssetsManager
            productId={product.id}
            assets={product.assets.map((a) => ({
              id: a.id,
              kind: a.kind,
              url: a.url,
              bytes: a.bytes,
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}
